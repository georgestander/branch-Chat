import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  validateConversationGraphSnapshot,
  type ConversationGraphSnapshot,
  type Message,
} from "@branchy/conversation-core";
import {
  ConversationConflictError,
  ConversationNotFoundError,
  ConversationRepository,
  LATEST_SCHEMA_VERSION,
  applyPersistenceSchema,
  openBranchyDatabase,
} from "./index.ts";

const CREATED_AT = "2026-07-23T08:00:00.000Z";
const LAST_ACTIVE_AT = "2026-07-23T08:30:00.000Z";
const RENAMED_AT = "2026-07-23T09:00:00.000Z";
const ARCHIVED_AT = "2026-07-23T09:30:00.000Z";
const UNARCHIVED_AT = "2026-07-23T10:00:00.000Z";

function createTempDatabasePath(t: test.TestContext): string {
  const directory = mkdtempSync(join(tmpdir(), "branchy-sqlite-"));
  t.after(() => {
    rmSync(directory, { recursive: true, force: true });
  });
  return join(directory, "branchy.sqlite3");
}

function createDeepSnapshot(): ConversationGraphSnapshot {
  return validateConversationGraphSnapshot({
    conversation: {
      id: "conversation-deep",
      ownerId: "local-user",
      rootBranchId: "root",
      createdAt: CREATED_AT,
      settings: {
        model: "gpt-5.6-terra",
        temperature: 0.35,
        systemPrompt: "Be exact and concise.",
        reasoningEffort: "high",
        composerDefaults: {
          preset: "study",
          tools: ["study-and-learn", "web-search", "file-upload"],
        },
      },
    },
    branches: {
      root: {
        id: "root",
        parentId: null,
        title: "Root investigation",
        createdFrom: {
          messageId: "root-user",
          excerpt: null,
          span: null,
        },
        messageIds: ["root-user", "root-assistant"],
        createdAt: CREATED_AT,
        archivedAt: null,
        inferenceContext: {
          provider: "codex",
          threadId: "thread-root",
          lastTurnId: "turn-root",
        },
      },
      child: {
        id: "child",
        parentId: "root",
        title: "Counterfactual",
        createdFrom: {
          messageId: "root-assistant",
          span: { start: 5, end: 18 },
          excerpt: "source excerpt",
        },
        messageIds: ["child-user", "child-assistant"],
        createdAt: "2026-07-23T08:05:00.000Z",
        inferenceContext: {
          provider: "codex",
          threadId: "thread-child",
          lastTurnId: "turn-child",
        },
      },
      grandchild: {
        id: "grandchild",
        parentId: "child",
        title: "Deep follow-up",
        createdFrom: {
          messageId: "child-assistant",
          span: { start: 0, end: 4 },
          excerpt: "More",
        },
        messageIds: ["grandchild-user", "grandchild-assistant"],
        createdAt: "2026-07-23T08:10:00.000Z",
        inferenceContext: {
          provider: "codex",
          threadId: "thread-grandchild",
          lastTurnId: null,
        },
      },
    },
    messages: {
      "root-user": {
        id: "root-user",
        branchId: "root",
        role: "user",
        content: "Read the attached evidence.",
        createdAt: "2026-07-23T08:01:00.000Z",
        tokenUsage: null,
        attachments: [
          {
            id: "attachment-1",
            kind: "file",
            name: "evidence.pdf",
            contentType: "application/pdf",
            size: 42_000,
            storageKey: "attachments/attachment-1/source.pdf",
            openAIFileId: "file-provider-1",
            description: "Primary evidence",
            uploadedAt: "2026-07-23T08:00:30.000Z",
          },
        ],
        toolInvocations: null,
      },
      "root-assistant": {
        id: "root-assistant",
        branchId: "root",
        role: "assistant",
        content: "The evidence supports the first conclusion.",
        createdAt: "2026-07-23T08:02:00.000Z",
        tokenUsage: { prompt: 120, completion: 35, cost: 0.0042 },
        attachments: null,
        toolInvocations: [
          {
            id: "tool-search-1",
            toolType: "web_search",
            toolName: "web.search",
            callId: "call-1",
            input: { query: "source material", domains: ["example.com"] },
            output: {
              results: [
                {
                  title: "Source",
                  url: "https://example.com/source",
                },
              ],
            },
            status: "succeeded",
            startedAt: "2026-07-23T08:01:30.000Z",
            completedAt: "2026-07-23T08:01:50.000Z",
            error: null,
          },
        ],
        inferenceContext: {
          provider: "codex",
          threadId: "thread-root",
          turnId: "turn-root",
        },
      },
      "child-user": {
        id: "child-user",
        branchId: "child",
        role: "user",
        content: "What if the premise is reversed?",
        createdAt: "2026-07-23T08:06:00.000Z",
      },
      "child-assistant": {
        id: "child-assistant",
        branchId: "child",
        role: "assistant",
        content: "Then the second conclusion follows.",
        createdAt: "2026-07-23T08:07:00.000Z",
        tokenUsage: { prompt: 80, completion: 24, cost: 0.0021 },
        toolInvocations: [
          {
            id: "tool-code-1",
            toolType: "local_tool",
            toolName: "calculator",
            callId: null,
            input: { expression: "12 / 0" },
            output: null,
            status: "failed",
            startedAt: "2026-07-23T08:06:30.000Z",
            completedAt: "2026-07-23T08:06:31.000Z",
            error: {
              message: "Division by zero",
              code: "INVALID_EXPRESSION",
            },
          },
        ],
        inferenceContext: {
          provider: "codex",
          threadId: "thread-child",
          turnId: "turn-child",
        },
      },
      "grandchild-user": {
        id: "grandchild-user",
        branchId: "grandchild",
        role: "user",
        content: "Take that one step further.",
        createdAt: "2026-07-23T08:11:00.000Z",
        attachments: [],
        toolInvocations: [],
      },
      "grandchild-assistant": {
        id: "grandchild-assistant",
        branchId: "grandchild",
        role: "assistant",
        content: "The third-order effect is bounded.",
        createdAt: "2026-07-23T08:12:00.000Z",
        inferenceContext: {
          provider: "codex",
          threadId: "thread-grandchild",
          turnId: "turn-grandchild",
        },
      },
    },
    canvas: {
      version: 2,
      viewport: { x: -145.25, y: 80.5, zoom: 0.82 },
      focusedBranchId: "grandchild",
      nodes: {
        root: {
          branchId: "root",
          x: 10,
          y: 20,
          width: 720,
          height: 480,
          folded: false,
          expanded: true,
        },
        child: {
          branchId: "child",
          x: 840,
          y: 20,
          width: 680,
          height: 410,
          folded: true,
          expanded: false,
        },
        grandchild: {
          branchId: "grandchild",
          x: 1630,
          y: 20,
          folded: false,
          expanded: true,
        },
      },
    },
  });
}

function createLargeSnapshot(messageCount = 500): ConversationGraphSnapshot {
  const messages: Record<string, Message> = {};
  const messageIds: string[] = [];

  for (let index = 0; index < messageCount; index += 1) {
    const id = `message-${index.toString().padStart(4, "0")}`;
    messageIds.push(id);
    messages[id] = {
      id,
      branchId: "root",
      role: index % 2 === 0 ? "user" : "assistant",
      content: `Representative message ${index}: ${"x".repeat(120)}`,
      createdAt: new Date(
        Date.parse(CREATED_AT) + index * 1_000,
      ).toISOString(),
      tokenUsage:
        index % 2 === 0
          ? null
          : { prompt: index + 1, completion: 24, cost: 0.001 },
      attachments: index === 0 ? [] : undefined,
      toolInvocations: index === 1 ? [] : undefined,
      inferenceContext:
        index % 2 === 1
          ? {
              provider: "codex",
              threadId: "thread-performance",
              turnId: `turn-${index}`,
            }
          : undefined,
    };
  }

  return validateConversationGraphSnapshot({
    conversation: {
      id: "conversation-performance",
      ownerId: "local-user",
      rootBranchId: "root",
      createdAt: CREATED_AT,
      settings: {
        model: "gpt-5.6-terra",
        temperature: 0,
        reasoningEffort: "medium",
        composerDefaults: { preset: "reasoning", tools: [] },
      },
    },
    branches: {
      root: {
        id: "root",
        parentId: null,
        title: "Performance fixture",
        createdFrom: { messageId: messageIds[0] },
        messageIds,
        createdAt: CREATED_AT,
        inferenceContext: {
          provider: "codex",
          threadId: "thread-performance",
          lastTurnId: `turn-${messageCount - 1}`,
        },
      },
    },
    messages,
    canvas: {
      version: 2,
      viewport: { x: 0, y: 0, zoom: 1 },
      focusedBranchId: "root",
      nodes: {
        root: {
          branchId: "root",
          x: 0,
          y: 0,
          folded: false,
          expanded: true,
        },
      },
    },
  });
}

function percentile(samples: number[], quantile: number): number {
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.max(
    0,
    Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1),
  );
  return sorted[index];
}

test("schema migration creates the normalized versioned database", () => {
  const database = openBranchyDatabase(":memory:");
  try {
    const version = database.prepare("PRAGMA user_version").get() as {
      user_version: number;
    };
    assert.equal(version.user_version, LATEST_SCHEMA_VERSION);

    const tables = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all()
      .map((row) => row.name);
    assert.deepEqual(tables, [
      "branch_message_order",
      "branches",
      "conversations",
      "messages",
    ]);
    assert.equal(
      database.prepare("PRAGMA foreign_keys").get()?.foreign_keys,
      1,
    );
  } finally {
    database.close();
  }
});

test("schema migration refuses a database created by a newer app", () => {
  const database = openBranchyDatabase(":memory:");
  try {
    database.exec(`PRAGMA user_version = ${LATEST_SCHEMA_VERSION + 1}`);
    assert.throws(() => applyPersistenceSchema(database), {
      message: `Branchy database schema ${LATEST_SCHEMA_VERSION + 1} is newer than supported schema ${LATEST_SCHEMA_VERSION}`,
    });
  } finally {
    database.close();
  }
});

test("deep graph data round-trips after closing and reopening SQLite", (t) => {
  const databasePath = createTempDatabasePath(t);
  const expected = createDeepSnapshot();

  let repository = ConversationRepository.open(databasePath, {
    clock: () => LAST_ACTIVE_AT,
  });
  const created = repository.create(expected, {
    title: "Deep graph",
    lastActiveAt: LAST_ACTIVE_AT,
  });
  assert.deepEqual(created, {
    id: "conversation-deep",
    ownerId: "local-user",
    title: "Deep graph",
    createdAt: CREATED_AT,
    lastActiveAt: LAST_ACTIVE_AT,
    branchCount: 3,
    archivedAt: null,
  });
  repository.close();

  repository = ConversationRepository.open(databasePath, {
    clock: () => LAST_ACTIVE_AT,
  });
  t.after(() => repository.close());

  assert.deepEqual(repository.require("conversation-deep"), expected);
  assert.deepEqual(repository.list(), [created]);
  assert.deepEqual(repository.list({ ownerId: "local-user" }), [created]);
  assert.deepEqual(repository.list({ ownerId: null }), []);

  const loadedBranch = repository.loadBranch(
    "conversation-deep",
    "grandchild",
  );
  assert.equal(loadedBranch?.conversationId, "conversation-deep");
  assert.deepEqual(loadedBranch?.branch, expected.branches.grandchild);
  assert.deepEqual(
    loadedBranch?.messages,
    expected.branches.grandchild.messageIds.map(
      (messageId) => expected.messages[messageId],
    ),
  );
});

test("save replaces graph rows atomically and preserves directory archive state", (t) => {
  const repository = ConversationRepository.open(createTempDatabasePath(t), {
    clock: () => LAST_ACTIVE_AT,
  });
  t.after(() => repository.close());

  const initial = createDeepSnapshot();
  repository.create(initial, { lastActiveAt: LAST_ACTIVE_AT });
  repository.archive("conversation-deep", ARCHIVED_AT);

  const updated = structuredClone(initial);
  updated.conversation.settings = {
    ...updated.conversation.settings,
    model: "gpt-5.6-sol",
    temperature: 0.1,
    reasoningEffort: "ultra",
  };
  updated.canvas.viewport = { x: 99, y: -42, zoom: 1.25 };
  updated.canvas.nodes.child = {
    ...updated.canvas.nodes.child,
    folded: false,
    expanded: true,
  };
  updated.branches.child.inferenceContext = {
    provider: "codex",
    threadId: "thread-child-replaced",
    lastTurnId: "turn-child-replaced",
  };
  updated.messages["child-assistant"].attachments = [
    {
      id: "attachment-2",
      kind: "file",
      name: "notes.txt",
      contentType: "text/plain",
      size: 18,
      storageKey: "attachments/attachment-2/notes.txt",
      openAIFileId: null,
      description: null,
      uploadedAt: "2026-07-23T08:06:45.000Z",
    },
  ];
  updated.messages["child-assistant"].toolInvocations = [
    {
      id: "tool-replaced",
      toolType: "image_generation",
      toolName: "image_generation",
      callId: "call-replaced",
      input: { prompt: "A branching tree" },
      output: { imageId: "image-1", status: "completed" },
      status: "succeeded",
      startedAt: "2026-07-23T08:06:30.000Z",
      completedAt: "2026-07-23T08:06:50.000Z",
      error: null,
    },
  ];
  const expected = validateConversationGraphSnapshot(updated);

  const savedEntry = repository.save(expected, {
    lastActiveAt: RENAMED_AT,
  });
  assert.equal(savedEntry.archivedAt, ARCHIVED_AT);
  assert.equal(savedEntry.lastActiveAt, RENAMED_AT);
  assert.deepEqual(repository.require("conversation-deep"), expected);

  const cyclicInput: Record<string, unknown> = {};
  cyclicInput.self = cyclicInput;
  const invalid = structuredClone(expected);
  invalid.messages["child-assistant"].toolInvocations![0].input = cyclicInput;

  assert.throws(
    () => repository.save(invalid, { lastActiveAt: UNARCHIVED_AT }),
    /not JSON serializable/,
  );
  assert.deepEqual(repository.require("conversation-deep"), expected);
  assert.equal(
    repository.getDirectoryEntry("conversation-deep")?.lastActiveAt,
    RENAMED_AT,
  );
});

test("rename, archive, unarchive, and delete update canonical and directory state", (t) => {
  const repository = ConversationRepository.open(createTempDatabasePath(t), {
    clock: () => LAST_ACTIVE_AT,
  });
  t.after(() => repository.close());
  repository.create(createDeepSnapshot(), {
    title: "Initial directory title",
    lastActiveAt: LAST_ACTIVE_AT,
  });

  const renamed = repository.rename(
    "conversation-deep",
    "  Renamed conversation  ",
    RENAMED_AT,
  );
  assert.equal(renamed.title, "Renamed conversation");
  assert.equal(renamed.lastActiveAt, RENAMED_AT);
  assert.equal(
    repository.require("conversation-deep").branches.root.title,
    "Renamed conversation",
  );

  const archived = repository.archive("conversation-deep", ARCHIVED_AT);
  assert.equal(archived.archivedAt, ARCHIVED_AT);
  assert.deepEqual(repository.list({ includeArchived: false }), []);
  assert.equal(repository.list()[0].archivedAt, ARCHIVED_AT);

  const unarchived = repository.unarchive(
    "conversation-deep",
    UNARCHIVED_AT,
  );
  assert.equal(unarchived.archivedAt, null);
  assert.equal(repository.list({ includeArchived: false }).length, 1);

  assert.equal(repository.delete("conversation-deep"), true);
  assert.equal(repository.delete("conversation-deep"), false);
  assert.equal(repository.load("conversation-deep"), null);
  assert.equal(repository.loadBranch("conversation-deep", "root"), null);
  assert.throws(
    () => repository.require("conversation-deep"),
    ConversationNotFoundError,
  );

  for (const table of [
    "conversations",
    "branches",
    "messages",
    "branch_message_order",
  ]) {
    const row = repository.database
      .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
      .get() as { count: number };
    assert.equal(row.count, 0, `${table} should be empty after deletion`);
  }
});

test("repository rejects invalid graph and lifecycle input without mutating data", (t) => {
  const repository = ConversationRepository.open(createTempDatabasePath(t), {
    clock: () => LAST_ACTIVE_AT,
  });
  t.after(() => repository.close());
  const snapshot = createDeepSnapshot();
  repository.create(snapshot);

  assert.throws(
    () => repository.create(snapshot),
    ConversationConflictError,
  );
  assert.throws(
    () => repository.save({ ...snapshot, conversation: { id: "missing" } }),
    /conversation/,
  );
  assert.throws(
    () => repository.rename("conversation-deep", "   "),
    /title must contain/,
  );
  assert.throws(
    () => repository.archive("missing-conversation", ARCHIVED_AT),
    ConversationNotFoundError,
  );

  const duplicateMessage = structuredClone(snapshot);
  duplicateMessage.branches.root.messageIds.push("root-user");
  assert.throws(
    () => repository.save(duplicateMessage),
    /duplicate message root-user/,
  );
  assert.deepEqual(repository.require("conversation-deep"), snapshot);
});

test("createMany commits a validated conversation set atomically", (t) => {
  const repository = ConversationRepository.open(createTempDatabasePath(t), {
    clock: () => LAST_ACTIVE_AT,
  });
  t.after(() => repository.close());
  const first = createDeepSnapshot();
  const second = structuredClone(first);
  second.conversation.id = "conversation-second";

  assert.deepEqual(
    repository
      .createMany([
        { snapshot: first },
        { snapshot: second, options: { title: "Second import" } },
      ])
      .map((entry) => entry.id),
    ["conversation-deep", "conversation-second"],
  );

  const third = structuredClone(first);
  third.conversation.id = "conversation-third";
  assert.throws(
    () =>
      repository.createMany([
        { snapshot: third },
        { snapshot: first },
      ]),
    ConversationConflictError,
  );
  assert.equal(repository.load("conversation-third"), null);
  assert.equal(repository.list().length, 2);

  assert.throws(
    () =>
      repository.createMany([
        { snapshot: third },
        { snapshot: structuredClone(third) },
      ]),
    ConversationConflictError,
  );
  assert.equal(repository.load("conversation-third"), null);
});

test("a failed BEGIN IMMEDIATE does not poison later serialized writes", (t) => {
  const databasePath = createTempDatabasePath(t);
  const lockOwner = ConversationRepository.open(databasePath, {
    clock: () => LAST_ACTIVE_AT,
  });
  lockOwner.create(createDeepSnapshot());

  const competingDatabase = new DatabaseSync(databasePath, {
    allowExtension: false,
    enableForeignKeyConstraints: true,
    timeout: 0,
  });
  const competitor = new ConversationRepository(competingDatabase, {
    clock: () => RENAMED_AT,
  });
  t.after(() => {
    competitor.close();
    lockOwner.close();
  });

  lockOwner.database.exec("BEGIN IMMEDIATE");
  try {
    assert.throws(
      () => competitor.touch("conversation-deep", RENAMED_AT),
      /database is locked/,
    );
  } finally {
    lockOwner.database.exec("ROLLBACK");
  }

  assert.equal(
    competitor.touch("conversation-deep", RENAMED_AT).lastActiveAt,
    RENAMED_AT,
  );
});

test("500-message branch loads stay below the 120ms p95 budget", (t) => {
  const repository = ConversationRepository.open(createTempDatabasePath(t), {
    clock: () => LAST_ACTIVE_AT,
  });
  t.after(() => repository.close());
  repository.create(createLargeSnapshot(500), {
    lastActiveAt: LAST_ACTIVE_AT,
  });

  for (let warmup = 0; warmup < 10; warmup += 1) {
    assert.equal(
      repository.loadBranch("conversation-performance", "root")?.messages
        .length,
      500,
    );
  }

  const samples: number[] = [];
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const startedAt = performance.now();
    const loaded = repository.loadBranch(
      "conversation-performance",
      "root",
    );
    samples.push(performance.now() - startedAt);
    assert.equal(loaded?.messages.length, 500);
  }

  const p50 = percentile(samples, 0.5);
  const p95 = percentile(samples, 0.95);
  t.diagnostic(
    `500-message branch load: p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms (${samples.length} runs)`,
  );
  assert.ok(
    p95 < 120,
    `500-message branch-load p95 ${p95.toFixed(2)}ms exceeded 120ms`,
  );
});
