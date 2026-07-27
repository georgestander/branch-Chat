import type { DatabaseSync } from "node:sqlite";

export const LATEST_SCHEMA_VERSION = 4;

interface SchemaVersionRow {
  user_version: number;
}

function readSchemaVersion(database: DatabaseSync): number {
  const row = database
    .prepare("PRAGMA user_version")
    .get() as unknown as SchemaVersionRow | undefined;

  if (!row || !Number.isInteger(row.user_version) || row.user_version < 0) {
    throw new Error("Branchy database returned an invalid schema version");
  }

  return row.user_version;
}

function migrateToVersionOne(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT,
      root_branch_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      settings_json TEXT NOT NULL CHECK (json_valid(settings_json)),
      canvas_json TEXT NOT NULL CHECK (json_valid(canvas_json)),
      title TEXT NOT NULL,
      last_active_at TEXT NOT NULL,
      archived_at TEXT,
      updated_at TEXT NOT NULL,
      branch_count INTEGER NOT NULL CHECK (branch_count >= 1)
    ) STRICT;

    CREATE TABLE branches (
      conversation_id TEXT NOT NULL,
      id TEXT NOT NULL,
      parent_id TEXT,
      title TEXT NOT NULL,
      created_from_message_id TEXT NOT NULL,
      created_from_span_start INTEGER,
      created_from_span_end INTEGER,
      created_from_excerpt TEXT,
      created_at TEXT NOT NULL,
      archived_at TEXT,
      inference_context_json TEXT
        CHECK (
          inference_context_json IS NULL
          OR json_valid(inference_context_json)
        ),
      PRIMARY KEY (conversation_id, id),
      FOREIGN KEY (conversation_id)
        REFERENCES conversations(id)
        ON DELETE CASCADE,
      CHECK (
        (created_from_span_start IS NULL AND created_from_span_end IS NULL)
        OR (
          created_from_span_start >= 0
          AND created_from_span_end >= created_from_span_start
        )
      )
    ) STRICT;

    CREATE TABLE messages (
      conversation_id TEXT NOT NULL,
      id TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      token_usage_json TEXT
        CHECK (token_usage_json IS NULL OR json_valid(token_usage_json)),
      attachments_json TEXT
        CHECK (attachments_json IS NULL OR json_valid(attachments_json)),
      tool_invocations_json TEXT
        CHECK (
          tool_invocations_json IS NULL
          OR json_valid(tool_invocations_json)
        ),
      inference_context_json TEXT
        CHECK (
          inference_context_json IS NULL
          OR json_valid(inference_context_json)
        ),
      PRIMARY KEY (conversation_id, id),
      FOREIGN KEY (conversation_id, branch_id)
        REFERENCES branches(conversation_id, id)
        ON DELETE CASCADE
    ) STRICT;

    CREATE TABLE branch_message_order (
      conversation_id TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
      message_id TEXT NOT NULL,
      PRIMARY KEY (conversation_id, branch_id, ordinal),
      FOREIGN KEY (conversation_id, branch_id)
        REFERENCES branches(conversation_id, id)
        ON DELETE CASCADE,
      FOREIGN KEY (conversation_id, message_id)
        REFERENCES messages(conversation_id, id)
        ON DELETE CASCADE
    ) STRICT;

    CREATE INDEX conversations_last_active_idx
      ON conversations(last_active_at DESC, id ASC);
    CREATE INDEX conversations_archived_last_active_idx
      ON conversations(archived_at, last_active_at DESC, id ASC);
    CREATE INDEX branches_parent_idx
      ON branches(conversation_id, parent_id);
    CREATE INDEX messages_branch_created_idx
      ON messages(conversation_id, branch_id, created_at, id);
    CREATE INDEX branch_message_lookup_idx
      ON branch_message_order(conversation_id, branch_id, ordinal);

    PRAGMA user_version = 1;
  `);
}

function migrateToVersionTwo(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE drafts (
      conversation_id TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      content TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (conversation_id, branch_id),
      FOREIGN KEY (conversation_id, branch_id)
        REFERENCES branches(conversation_id, id)
        ON DELETE CASCADE
    ) STRICT;

    PRAGMA user_version = 2;
  `);
}

function migrateToVersionThree(database: DatabaseSync): void {
  const hasKindColumn = database
    .prepare("PRAGMA table_info(branches)")
    .all()
    .some((row) => row.name === "kind");
  if (!hasKindColumn) {
    database.exec(`
      ALTER TABLE branches
        ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat'
        CHECK (kind IN ('chat', 'note'));
    `);
  }
  database.exec("PRAGMA user_version = 3");
}

function migrateToVersionFour(database: DatabaseSync): void {
  database.exec(`
    UPDATE branches
    SET kind = 'note'
    WHERE kind = 'chat'
      AND parent_id IS NOT NULL
      AND inference_context_json IS NULL
      AND (
        SELECT COUNT(*)
        FROM branch_message_order
        WHERE branch_message_order.conversation_id = branches.conversation_id
          AND branch_message_order.branch_id = branches.id
      ) = 1
      AND EXISTS (
        SELECT 1
        FROM branch_message_order
        JOIN messages
          ON messages.conversation_id = branch_message_order.conversation_id
          AND messages.id = branch_message_order.message_id
        WHERE branch_message_order.conversation_id = branches.conversation_id
          AND branch_message_order.branch_id = branches.id
          AND messages.role = 'user'
      );

    PRAGMA user_version = 4;
  `);
}

export function applyPersistenceSchema(database: DatabaseSync): void {
  database.exec("PRAGMA foreign_keys = ON");

  const currentVersion = readSchemaVersion(database);
  if (currentVersion > LATEST_SCHEMA_VERSION) {
    throw new Error(
      `Branchy database schema ${currentVersion} is newer than supported schema ${LATEST_SCHEMA_VERSION}`,
    );
  }

  if (currentVersion === LATEST_SCHEMA_VERSION) {
    return;
  }

  database.exec("BEGIN IMMEDIATE");
  try {
    if (currentVersion === 0) {
      migrateToVersionOne(database);
    }
    if (readSchemaVersion(database) === 1) {
      migrateToVersionTwo(database);
    }
    if (readSchemaVersion(database) === 2) {
      migrateToVersionThree(database);
    }
    if (readSchemaVersion(database) === 3) {
      migrateToVersionFour(database);
    }

    const migratedVersion = readSchemaVersion(database);
    if (migratedVersion !== LATEST_SCHEMA_VERSION) {
      throw new Error(
        `Branchy database migration stopped at schema ${migratedVersion}; expected ${LATEST_SCHEMA_VERSION}`,
      );
    }

    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) {
      database.exec("ROLLBACK");
    }
    throw error;
  }
}
