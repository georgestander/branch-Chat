import { chmodSync, mkdirSync } from "node:fs";
import { isAbsolute, dirname, resolve } from "node:path";
import {
  DatabaseSync,
  type SQLOutputValue,
  type StatementSync,
} from "node:sqlite";
import {
  isIsoDate,
  validateConversationGraphSnapshot,
  type Branch,
  type BranchId,
  type ConversationCanvasState,
  type ConversationGraphSnapshot,
  type ConversationModelId,
  type Message,
  type MessageId,
} from "@branchy/conversation-core";
import { applyPersistenceSchema } from "./schema.ts";

const MAX_ID_LENGTH = 512;
const MAX_TITLE_LENGTH = 512;
const MAX_DRAFT_CHARACTERS = 120_000;
const MAX_DRAFT_BYTES = 256 * 1024;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const DRAFT_CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

type SqlRow = Record<string, SQLOutputValue>;

export interface ConversationDirectoryEntry {
  id: ConversationModelId;
  ownerId: string | null;
  title: string;
  createdAt: string;
  lastActiveAt: string;
  branchCount: number;
  archivedAt: string | null;
}

export interface ConversationListOptions {
  includeArchived?: boolean;
  ownerId?: string | null;
}

export interface ConversationWriteOptions {
  title?: string;
  lastActiveAt?: string;
}

export interface ConversationSaveOptions extends ConversationWriteOptions {
  clearDraftBranchId?: string;
}

export interface ComposerDraftRecord {
  conversationId: ConversationModelId;
  branchId: BranchId;
  content: string;
  updatedAt: string;
}

export interface ConversationBatchCreateInput {
  snapshot: unknown;
  options?: ConversationWriteOptions;
}

export interface BranchLoadResult {
  conversationId: ConversationModelId;
  branch: Branch;
  messages: Message[];
}

export interface ConversationRepositoryOptions {
  clock?: () => string;
}

export class ConversationNotFoundError extends Error {
  readonly conversationId: string;

  constructor(conversationId: string) {
    super(`Conversation ${conversationId} was not found`);
    this.name = "ConversationNotFoundError";
    this.conversationId = conversationId;
  }
}

export class ConversationConflictError extends Error {
  readonly conversationId: string;

  constructor(conversationId: string) {
    super(`Conversation ${conversationId} already exists`);
    this.name = "ConversationConflictError";
    this.conversationId = conversationId;
  }
}

export class PersistenceInvariantError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PersistenceInvariantError";
  }
}

interface ConversationRow {
  id: string;
  ownerId: string | null;
  rootBranchId: string;
  createdAt: string;
  settingsJson: string;
  canvasJson: string;
  title: string;
  lastActiveAt: string;
  archivedAt: string | null;
  updatedAt: string;
  branchCount: number;
}

interface SerializedBranchRow {
  conversationId: string;
  id: string;
  parentId: string | null;
  title: string;
  createdFromMessageId: string;
  createdFromSpanStart: number | null;
  createdFromSpanEnd: number | null;
  createdFromExcerpt: string | null;
  createdAt: string;
  archivedAt: string | null;
  inferenceContextJson: string | null;
}

interface SerializedMessageRow {
  conversationId: string;
  id: string;
  branchId: string;
  role: string;
  content: string;
  createdAt: string;
  tokenUsageJson: string | null;
  attachmentsJson: string | null;
  toolInvocationsJson: string | null;
  inferenceContextJson: string | null;
}

interface SerializedMessageOrderRow {
  conversationId: string;
  branchId: string;
  ordinal: number;
  messageId: string;
}

interface SerializedDraftRow {
  conversationId: string;
  branchId: string;
  content: string;
  updatedAt: string;
}

interface SerializedSnapshot {
  conversation: Omit<
    ConversationRow,
    "title" | "lastActiveAt" | "archivedAt" | "updatedAt" | "branchCount"
  >;
  branches: SerializedBranchRow[];
  messages: SerializedMessageRow[];
  messageOrder: SerializedMessageOrderRow[];
}

function expectString(
  row: SqlRow,
  column: string,
  context: string,
): string {
  const value = row[column];
  if (typeof value !== "string") {
    throw new PersistenceInvariantError(
      `${context}.${column} must be a string`,
    );
  }
  return value;
}

function expectNullableString(
  row: SqlRow,
  column: string,
  context: string,
): string | null {
  const value = row[column];
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new PersistenceInvariantError(
      `${context}.${column} must be a string or null`,
    );
  }
  return value;
}

function expectInteger(
  row: SqlRow,
  column: string,
  context: string,
): number {
  const value = row[column];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new PersistenceInvariantError(
      `${context}.${column} must be an integer`,
    );
  }
  return value;
}

function parseJson<T>(value: string, context: string): T {
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    throw new PersistenceInvariantError(
      `${context} contains invalid JSON`,
      { cause: error },
    );
  }
}

function parseOptionalJson<T>(
  row: SqlRow,
  column: string,
  context: string,
): T | undefined {
  const value = row[column];
  if (value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new PersistenceInvariantError(
      `${context}.${column} must be JSON text or null`,
    );
  }
  return parseJson<T>(value, `${context}.${column}`);
}

function encodeJson(value: unknown, context: string): string {
  try {
    const encoded = JSON.stringify(value);
    if (typeof encoded !== "string") {
      throw new TypeError("value is not JSON serializable");
    }
    return encoded;
  } catch (error) {
    throw new TypeError(`${context} is not JSON serializable`, {
      cause: error,
    });
  }
}

function encodeOptionalJson(value: unknown, context: string): string | null {
  return value === undefined ? null : encodeJson(value, context);
}

function normalizeIdentifier(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_ID_LENGTH ||
    value.trim() !== value ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    throw new TypeError(
      `${label} must be a non-empty, trimmed identifier of at most ${MAX_ID_LENGTH} characters`,
    );
  }
  return value;
}

function normalizeTitle(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("title must be a string");
  }
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > MAX_TITLE_LENGTH ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    throw new TypeError(
      `title must contain 1-${MAX_TITLE_LENGTH} printable characters`,
    );
  }
  return normalized;
}

function normalizeDraftContent(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > MAX_DRAFT_CHARACTERS ||
    new TextEncoder().encode(value).byteLength > MAX_DRAFT_BYTES ||
    DRAFT_CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    throw new TypeError(
      `draft content must be at most ${MAX_DRAFT_CHARACTERS} characters and ${MAX_DRAFT_BYTES} UTF-8 bytes`,
    );
  }
  return value;
}

function validateStoredBranchTitle(value: string, branchId: string): void {
  if (
    value.length > MAX_TITLE_LENGTH ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    throw new TypeError(
      `branch ${branchId} title must contain at most ${MAX_TITLE_LENGTH} printable characters`,
    );
  }
}

function normalizeTimestamp(value: unknown, label: string): string {
  if (!isIsoDate(value)) {
    throw new TypeError(`${label} must be an ISO-8601 UTC timestamp`);
  }
  return value;
}

function validateSnapshotForPersistence(
  value: unknown,
): ConversationGraphSnapshot {
  const snapshot = validateConversationGraphSnapshot(value);
  normalizeIdentifier(snapshot.conversation.id, "conversation.id");
  normalizeIdentifier(
    snapshot.conversation.rootBranchId,
    "conversation.rootBranchId",
  );
  if (snapshot.conversation.ownerId) {
    normalizeIdentifier(snapshot.conversation.ownerId, "conversation.ownerId");
  }

  if (!Number.isFinite(snapshot.conversation.settings.temperature)) {
    throw new TypeError("conversation.settings.temperature must be finite");
  }

  const rootBranch = snapshot.branches[snapshot.conversation.rootBranchId];
  if (!rootBranch) {
    throw new TypeError("conversation root branch is missing");
  }
  if (rootBranch.parentId) {
    throw new TypeError("conversation root branch cannot have a parent");
  }

  const referencedMessages = new Set<MessageId>();
  for (const branch of Object.values(snapshot.branches)) {
    normalizeIdentifier(branch.id, "branch.id");
    validateStoredBranchTitle(branch.title, branch.id);
    normalizeIdentifier(
      branch.createdFrom.messageId,
      `branch ${branch.id} createdFrom.messageId`,
    );

    if (branch.parentId) {
      normalizeIdentifier(branch.parentId, `branch ${branch.id} parentId`);
      if (branch.parentId === branch.id) {
        throw new TypeError(`branch ${branch.id} cannot parent itself`);
      }
      if (!snapshot.branches[branch.parentId]) {
        throw new TypeError(
          `branch ${branch.id} references missing parent ${branch.parentId}`,
        );
      }
    } else if (branch.id !== snapshot.conversation.rootBranchId) {
      throw new TypeError(`non-root branch ${branch.id} must have a parent`);
    }

    const branchMessageIds = new Set<MessageId>();
    for (const messageId of branch.messageIds) {
      normalizeIdentifier(
        messageId,
        `branch ${branch.id} message identifier`,
      );
      if (branchMessageIds.has(messageId)) {
        throw new TypeError(
          `branch ${branch.id} contains duplicate message ${messageId}`,
        );
      }
      if (referencedMessages.has(messageId)) {
        throw new TypeError(`message ${messageId} appears in multiple branches`);
      }
      branchMessageIds.add(messageId);
      referencedMessages.add(messageId);
    }
  }

  const visitState = new Map<BranchId, "visiting" | "visited">();
  const visitBranch = (branchId: BranchId): void => {
    const state = visitState.get(branchId);
    if (state === "visiting") {
      throw new TypeError(`branch parent cycle detected at ${branchId}`);
    }
    if (state === "visited") {
      return;
    }
    visitState.set(branchId, "visiting");
    const parentId = snapshot.branches[branchId]?.parentId;
    if (parentId) {
      visitBranch(parentId);
    }
    visitState.set(branchId, "visited");
  };
  for (const branchId of Object.keys(snapshot.branches) as BranchId[]) {
    visitBranch(branchId);
  }

  for (const message of Object.values(snapshot.messages)) {
    normalizeIdentifier(message.id, "message.id");
    normalizeIdentifier(message.branchId, `message ${message.id} branchId`);
    if (!snapshot.branches[message.branchId]) {
      throw new TypeError(
        `message ${message.id} references missing branch ${message.branchId}`,
      );
    }
    if (!referencedMessages.has(message.id)) {
      throw new TypeError(
        `message ${message.id} is not ordered in branch ${message.branchId}`,
      );
    }
    if (message.tokenUsage) {
      const { prompt, completion, cost } = message.tokenUsage;
      if (
        !Number.isFinite(prompt) ||
        !Number.isFinite(completion) ||
        !Number.isFinite(cost)
      ) {
        throw new TypeError(`message ${message.id} tokenUsage must be finite`);
      }
    }
  }

  return snapshot;
}

function serializeSnapshot(
  snapshot: ConversationGraphSnapshot,
): SerializedSnapshot {
  const conversationId = snapshot.conversation.id;
  const branches: SerializedBranchRow[] = [];
  const messages: SerializedMessageRow[] = [];
  const messageOrder: SerializedMessageOrderRow[] = [];

  for (const branch of Object.values(snapshot.branches)) {
    branches.push({
      conversationId,
      id: branch.id,
      parentId: branch.parentId ?? null,
      title: branch.title,
      createdFromMessageId: branch.createdFrom.messageId,
      createdFromSpanStart: branch.createdFrom.span?.start ?? null,
      createdFromSpanEnd: branch.createdFrom.span?.end ?? null,
      createdFromExcerpt: branch.createdFrom.excerpt ?? null,
      createdAt: branch.createdAt,
      archivedAt: branch.archivedAt ?? null,
      inferenceContextJson: encodeOptionalJson(
        branch.inferenceContext,
        `branch ${branch.id} inferenceContext`,
      ),
    });

    branch.messageIds.forEach((messageId, ordinal) => {
      messageOrder.push({
        conversationId,
        branchId: branch.id,
        ordinal,
        messageId,
      });
    });
  }

  for (const message of Object.values(snapshot.messages)) {
    messages.push({
      conversationId,
      id: message.id,
      branchId: message.branchId,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
      tokenUsageJson: encodeOptionalJson(
        message.tokenUsage,
        `message ${message.id} tokenUsage`,
      ),
      attachmentsJson: encodeOptionalJson(
        message.attachments,
        `message ${message.id} attachments`,
      ),
      toolInvocationsJson: encodeOptionalJson(
        message.toolInvocations,
        `message ${message.id} toolInvocations`,
      ),
      inferenceContextJson: encodeOptionalJson(
        message.inferenceContext,
        `message ${message.id} inferenceContext`,
      ),
    });
  }

  return {
    conversation: {
      id: conversationId,
      ownerId: snapshot.conversation.ownerId ?? null,
      rootBranchId: snapshot.conversation.rootBranchId,
      createdAt: snapshot.conversation.createdAt,
      settingsJson: encodeJson(
        snapshot.conversation.settings,
        "conversation.settings",
      ),
      canvasJson: encodeJson(snapshot.canvas, "conversation.canvas"),
    },
    branches,
    messages,
    messageOrder,
  };
}

function parseConversationRow(row: SqlRow): ConversationRow {
  const context = "conversations row";
  const id = normalizeIdentifier(
    expectString(row, "id", context),
    "conversation.id",
  );
  const ownerId = expectNullableString(row, "owner_id", context);
  if (ownerId) {
    normalizeIdentifier(ownerId, "conversation.ownerId");
  }
  const archivedAt = expectNullableString(row, "archived_at", context);
  if (archivedAt) {
    normalizeTimestamp(archivedAt, "conversation archived_at");
  }
  const branchCount = expectInteger(row, "branch_count", context);
  if (branchCount < 1) {
    throw new PersistenceInvariantError(
      "conversations row.branch_count must be positive",
    );
  }

  return {
    id,
    ownerId,
    rootBranchId: normalizeIdentifier(
      expectString(row, "root_branch_id", context),
      "conversation.rootBranchId",
    ),
    createdAt: normalizeTimestamp(
      expectString(row, "created_at", context),
      "conversation created_at",
    ),
    settingsJson: expectString(row, "settings_json", context),
    canvasJson: expectString(row, "canvas_json", context),
    title: normalizeTitle(expectString(row, "title", context)),
    lastActiveAt: normalizeTimestamp(
      expectString(row, "last_active_at", context),
      "conversation last_active_at",
    ),
    archivedAt,
    updatedAt: normalizeTimestamp(
      expectString(row, "updated_at", context),
      "conversation updated_at",
    ),
    branchCount,
  };
}

function parseBranchRow(row: SqlRow): Branch {
  const context = "branches row";
  const spanStart = row.created_from_span_start;
  const spanEnd = row.created_from_span_end;
  if (
    !(
      (spanStart === null && spanEnd === null) ||
      (typeof spanStart === "number" &&
        Number.isInteger(spanStart) &&
        typeof spanEnd === "number" &&
        Number.isInteger(spanEnd))
    )
  ) {
    throw new PersistenceInvariantError(
      "branches row contains an invalid source span",
    );
  }

  return {
    id: expectString(row, "id", context) as BranchId,
    parentId: expectNullableString(row, "parent_id", context),
    title: expectString(row, "title", context),
    createdFrom: {
      messageId: expectString(
        row,
        "created_from_message_id",
        context,
      ) as MessageId,
      ...(typeof spanStart === "number" && typeof spanEnd === "number"
        ? { span: { start: spanStart, end: spanEnd } }
        : {}),
      excerpt:
        expectNullableString(row, "created_from_excerpt", context) ?? undefined,
    },
    messageIds: [],
    createdAt: expectString(row, "created_at", context),
    archivedAt: expectNullableString(row, "archived_at", context),
    inferenceContext: parseOptionalJson(
      row,
      "inference_context_json",
      context,
    ),
  };
}

function parseMessageRow(row: SqlRow): Message {
  const context = "messages row";
  return {
    id: expectString(row, "id", context) as MessageId,
    branchId: expectString(row, "branch_id", context) as BranchId,
    role: expectString(row, "role", context) as Message["role"],
    content: expectString(row, "content", context),
    createdAt: expectString(row, "created_at", context),
    tokenUsage: parseOptionalJson(row, "token_usage_json", context),
    attachments: parseOptionalJson(row, "attachments_json", context),
    toolInvocations: parseOptionalJson(
      row,
      "tool_invocations_json",
      context,
    ),
    inferenceContext: parseOptionalJson(
      row,
      "inference_context_json",
      context,
    ),
  };
}

function parseDraftRow(
  row: SqlRow,
  conversationId: string,
): SerializedDraftRow {
  try {
    const context = "drafts row";
    const storedConversationId = normalizeIdentifier(
      expectString(row, "conversation_id", context),
      "draft.conversationId",
    );
    if (storedConversationId !== conversationId) {
      throw new PersistenceInvariantError(
        `drafts row belongs to unexpected conversation ${storedConversationId}`,
      );
    }
    return {
      conversationId: storedConversationId,
      branchId: normalizeIdentifier(
        expectString(row, "branch_id", context),
        "draft.branchId",
      ),
      content: normalizeDraftContent(
        expectString(row, "content", context),
      ),
      updatedAt: normalizeTimestamp(
        expectString(row, "updated_at", context),
        "draft updated_at",
      ),
    };
  } catch (error) {
    if (error instanceof PersistenceInvariantError) {
      throw error;
    }
    throw new PersistenceInvariantError(
      `conversation ${conversationId} contains an invalid composer draft`,
      { cause: error },
    );
  }
}

function directoryEntryFromRow(row: ConversationRow): ConversationDirectoryEntry {
  return {
    id: row.id as ConversationModelId,
    ownerId: row.ownerId,
    title: row.title,
    createdAt: row.createdAt,
    lastActiveAt: row.lastActiveAt,
    branchCount: row.branchCount,
    archivedAt: row.archivedAt,
  };
}

export function openBranchyDatabase(path: string): DatabaseSync {
  if (typeof path !== "string" || path.trim().length === 0) {
    throw new TypeError("database path is required");
  }

  const memoryDatabase = path === ":memory:";
  if (!memoryDatabase && !isAbsolute(path)) {
    throw new TypeError("database path must be absolute");
  }

  const resolvedPath = memoryDatabase ? path : resolve(path);
  if (!memoryDatabase) {
    mkdirSync(dirname(resolvedPath), { recursive: true, mode: 0o700 });
  }

  const database = new DatabaseSync(resolvedPath, {
    allowExtension: false,
    enableDoubleQuotedStringLiterals: false,
    enableForeignKeyConstraints: true,
    timeout: 5_000,
  });

  try {
    database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA temp_store = MEMORY;
    `);
    applyPersistenceSchema(database);
    if (!memoryDatabase) {
      chmodSync(resolvedPath, 0o600);
    }
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

export class ConversationRepository {
  readonly database: DatabaseSync;

  private readonly clock: () => string;
  private writing = false;

  private readonly selectConversation: StatementSync;
  private readonly selectBranches: StatementSync;
  private readonly selectBranch: StatementSync;
  private readonly selectMessages: StatementSync;
  private readonly selectMessageOrder: StatementSync;
  private readonly selectBranchMessages: StatementSync;
  private readonly selectDrafts: StatementSync;
  private readonly selectAllDirectory: StatementSync;
  private readonly selectActiveDirectory: StatementSync;
  private readonly selectDirectoryByOwner: StatementSync;
  private readonly selectActiveDirectoryByOwner: StatementSync;
  private readonly selectDirectoryWithoutOwner: StatementSync;
  private readonly selectActiveDirectoryWithoutOwner: StatementSync;
  private readonly insertConversation: StatementSync;
  private readonly updateConversation: StatementSync;
  private readonly insertBranch: StatementSync;
  private readonly insertMessage: StatementSync;
  private readonly insertMessageOrder: StatementSync;
  private readonly deleteMessages: StatementSync;
  private readonly deleteBranches: StatementSync;
  private readonly renameConversationRow: StatementSync;
  private readonly renameRootBranchRow: StatementSync;
  private readonly archiveConversationRow: StatementSync;
  private readonly unarchiveConversationRow: StatementSync;
  private readonly touchConversationRow: StatementSync;
  private readonly deleteConversationRow: StatementSync;
  private readonly upsertDraftRow: StatementSync;
  private readonly deleteDraftRow: StatementSync;

  constructor(
    database: DatabaseSync,
    options: ConversationRepositoryOptions = {},
  ) {
    this.database = database;
    this.clock = options.clock ?? (() => new Date().toISOString());
    applyPersistenceSchema(database);

    this.selectConversation = database.prepare(
      "SELECT * FROM conversations WHERE id = ?",
    );
    this.selectBranches = database.prepare(
      "SELECT * FROM branches WHERE conversation_id = ? ORDER BY created_at, id",
    );
    this.selectBranch = database.prepare(
      "SELECT * FROM branches WHERE conversation_id = ? AND id = ?",
    );
    this.selectMessages = database.prepare(
      "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at, id",
    );
    this.selectMessageOrder = database.prepare(`
      SELECT branch_id, ordinal, message_id
      FROM branch_message_order
      WHERE conversation_id = ?
      ORDER BY branch_id, ordinal
    `);
    this.selectBranchMessages = database.prepare(`
      SELECT messages.*
      FROM branch_message_order
      INNER JOIN messages
        ON messages.conversation_id = branch_message_order.conversation_id
        AND messages.id = branch_message_order.message_id
      WHERE branch_message_order.conversation_id = ?
        AND branch_message_order.branch_id = ?
      ORDER BY branch_message_order.ordinal
    `);
    this.selectDrafts = database.prepare(`
      SELECT conversation_id, branch_id, content, updated_at
      FROM drafts
      WHERE conversation_id = ?
      ORDER BY branch_id
    `);
    this.selectAllDirectory = database.prepare(
      "SELECT * FROM conversations ORDER BY last_active_at DESC, id ASC",
    );
    this.selectActiveDirectory = database.prepare(`
      SELECT * FROM conversations
      WHERE archived_at IS NULL
      ORDER BY last_active_at DESC, id ASC
    `);
    this.selectDirectoryByOwner = database.prepare(`
      SELECT * FROM conversations
      WHERE owner_id = ?
      ORDER BY last_active_at DESC, id ASC
    `);
    this.selectActiveDirectoryByOwner = database.prepare(`
      SELECT * FROM conversations
      WHERE owner_id = ? AND archived_at IS NULL
      ORDER BY last_active_at DESC, id ASC
    `);
    this.selectDirectoryWithoutOwner = database.prepare(`
      SELECT * FROM conversations
      WHERE owner_id IS NULL
      ORDER BY last_active_at DESC, id ASC
    `);
    this.selectActiveDirectoryWithoutOwner = database.prepare(`
      SELECT * FROM conversations
      WHERE owner_id IS NULL AND archived_at IS NULL
      ORDER BY last_active_at DESC, id ASC
    `);
    this.insertConversation = database.prepare(`
      INSERT INTO conversations (
        id, owner_id, root_branch_id, created_at, settings_json, canvas_json,
        title, last_active_at, archived_at, updated_at, branch_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    `);
    this.updateConversation = database.prepare(`
      UPDATE conversations
      SET owner_id = ?,
          root_branch_id = ?,
          created_at = ?,
          settings_json = ?,
          canvas_json = ?,
          title = ?,
          last_active_at = ?,
          updated_at = ?,
          branch_count = ?
      WHERE id = ?
    `);
    this.insertBranch = database.prepare(`
      INSERT INTO branches (
        conversation_id, id, parent_id, title, created_from_message_id,
        created_from_span_start, created_from_span_end,
        created_from_excerpt, created_at, archived_at, inference_context_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.insertMessage = database.prepare(`
      INSERT INTO messages (
        conversation_id, id, branch_id, role, content, created_at,
        token_usage_json, attachments_json, tool_invocations_json,
        inference_context_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.insertMessageOrder = database.prepare(`
      INSERT INTO branch_message_order (
        conversation_id, branch_id, ordinal, message_id
      ) VALUES (?, ?, ?, ?)
    `);
    this.deleteMessages = database.prepare(
      "DELETE FROM messages WHERE conversation_id = ?",
    );
    this.deleteBranches = database.prepare(
      "DELETE FROM branches WHERE conversation_id = ?",
    );
    this.renameConversationRow = database.prepare(`
      UPDATE conversations
      SET title = ?, last_active_at = ?, updated_at = ?
      WHERE id = ?
    `);
    this.renameRootBranchRow = database.prepare(`
      UPDATE branches
      SET title = ?
      WHERE conversation_id = ?
        AND id = (SELECT root_branch_id FROM conversations WHERE id = ?)
    `);
    this.archiveConversationRow = database.prepare(`
      UPDATE conversations SET archived_at = ?, updated_at = ? WHERE id = ?
    `);
    this.unarchiveConversationRow = database.prepare(`
      UPDATE conversations SET archived_at = NULL, updated_at = ? WHERE id = ?
    `);
    this.touchConversationRow = database.prepare(`
      UPDATE conversations SET last_active_at = ?, updated_at = ? WHERE id = ?
    `);
    this.deleteConversationRow = database.prepare(
      "DELETE FROM conversations WHERE id = ?",
    );
    this.upsertDraftRow = database.prepare(`
      INSERT INTO drafts (
        conversation_id, branch_id, content, updated_at
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT (conversation_id, branch_id) DO UPDATE SET
        content = excluded.content,
        updated_at = excluded.updated_at
    `);
    this.deleteDraftRow = database.prepare(`
      DELETE FROM drafts WHERE conversation_id = ? AND branch_id = ?
    `);
  }

  static open(
    path: string,
    options: ConversationRepositoryOptions = {},
  ): ConversationRepository {
    return new ConversationRepository(openBranchyDatabase(path), options);
  }

  close(): void {
    if (this.database.isOpen) {
      this.database.close();
    }
  }

  create(
    value: unknown,
    options: ConversationWriteOptions = {},
  ): ConversationDirectoryEntry {
    const snapshot = validateSnapshotForPersistence(value);
    const serialized = serializeSnapshot(snapshot);
    const timestamp = this.resolveTimestamp(options.lastActiveAt, "lastActiveAt");
    const title = this.resolveTitle(snapshot, options.title);

    return this.write(() => {
      if (this.selectConversation.get(snapshot.conversation.id)) {
        throw new ConversationConflictError(snapshot.conversation.id);
      }

      this.insertConversation.run(
        serialized.conversation.id,
        serialized.conversation.ownerId,
        serialized.conversation.rootBranchId,
        serialized.conversation.createdAt,
        serialized.conversation.settingsJson,
        serialized.conversation.canvasJson,
        title,
        timestamp,
        timestamp,
        serialized.branches.length,
      );
      this.writeChildRows(serialized);
      return this.requireDirectoryEntry(snapshot.conversation.id);
    });
  }

  createMany(
    values: readonly ConversationBatchCreateInput[],
  ): ConversationDirectoryEntry[] {
    if (!Array.isArray(values) || values.length === 0 || values.length > 256) {
      throw new TypeError("createMany requires 1-256 conversations");
    }
    const prepared = values.map(({ snapshot: value, options = {} }) => {
      const snapshot = validateSnapshotForPersistence(value);
      return {
        snapshot,
        serialized: serializeSnapshot(snapshot),
        timestamp: this.resolveTimestamp(
          options.lastActiveAt,
          "lastActiveAt",
        ),
        title: this.resolveTitle(snapshot, options.title),
      };
    });
    const ids = new Set<string>();
    for (const { snapshot } of prepared) {
      if (ids.has(snapshot.conversation.id)) {
        throw new ConversationConflictError(snapshot.conversation.id);
      }
      ids.add(snapshot.conversation.id);
    }

    return this.write(() => {
      for (const { snapshot } of prepared) {
        if (this.selectConversation.get(snapshot.conversation.id)) {
          throw new ConversationConflictError(snapshot.conversation.id);
        }
      }
      for (const {
        serialized,
        snapshot,
        timestamp,
        title,
      } of prepared) {
        this.insertConversation.run(
          serialized.conversation.id,
          serialized.conversation.ownerId,
          serialized.conversation.rootBranchId,
          serialized.conversation.createdAt,
          serialized.conversation.settingsJson,
          serialized.conversation.canvasJson,
          title,
          timestamp,
          timestamp,
          serialized.branches.length,
        );
        this.writeChildRows(serialized);
      }
      return prepared.map(({ snapshot }) =>
        this.requireDirectoryEntry(snapshot.conversation.id),
      );
    });
  }

  save(
    value: unknown,
    options: ConversationSaveOptions = {},
  ): ConversationDirectoryEntry {
    const snapshot = validateSnapshotForPersistence(value);
    const serialized = serializeSnapshot(snapshot);
    const timestamp = this.resolveTimestamp(options.lastActiveAt, "lastActiveAt");
    const title = this.resolveTitle(snapshot, options.title);
    const clearDraftBranchId =
      options.clearDraftBranchId === undefined
        ? null
        : normalizeIdentifier(
            options.clearDraftBranchId,
            "clearDraftBranchId",
          );
    if (
      clearDraftBranchId &&
      !snapshot.branches[clearDraftBranchId]
    ) {
      throw new TypeError(
        `clearDraftBranchId ${clearDraftBranchId} is not part of the conversation`,
      );
    }

    return this.write(() => {
      if (!this.selectConversation.get(snapshot.conversation.id)) {
        throw new ConversationNotFoundError(snapshot.conversation.id);
      }
      const drafts = (
        this.selectDrafts.all(snapshot.conversation.id) as SqlRow[]
      ).map((row) => parseDraftRow(row, snapshot.conversation.id));

      this.deleteMessages.run(snapshot.conversation.id);
      this.deleteBranches.run(snapshot.conversation.id);
      this.updateConversation.run(
        serialized.conversation.ownerId,
        serialized.conversation.rootBranchId,
        serialized.conversation.createdAt,
        serialized.conversation.settingsJson,
        serialized.conversation.canvasJson,
        title,
        timestamp,
        timestamp,
        serialized.branches.length,
        serialized.conversation.id,
      );
      this.writeChildRows(serialized);
      for (const draft of drafts) {
        if (
          draft.branchId !== clearDraftBranchId &&
          snapshot.branches[draft.branchId]
        ) {
          this.upsertDraftRow.run(
            draft.conversationId,
            draft.branchId,
            draft.content,
            draft.updatedAt,
          );
        }
      }
      return this.requireDirectoryEntry(snapshot.conversation.id);
    });
  }

  load(conversationId: string): ConversationGraphSnapshot | null {
    const id = normalizeIdentifier(conversationId, "conversationId");
    const conversationSqlRow = this.selectConversation.get(id) as
      | SqlRow
      | undefined;
    if (!conversationSqlRow) {
      return null;
    }

    try {
      const conversationRow = parseConversationRow(conversationSqlRow);
      const branchRows = this.selectBranches.all(id) as SqlRow[];
      const messageRows = this.selectMessages.all(id) as SqlRow[];
      const orderRows = this.selectMessageOrder.all(id) as SqlRow[];

      const branches = Object.fromEntries(
        branchRows.map((row) => {
          const branch = parseBranchRow(row);
          return [branch.id, branch];
        }),
      ) as Record<BranchId, Branch>;
      const messages = Object.fromEntries(
        messageRows.map((row) => {
          const message = parseMessageRow(row);
          return [message.id, message];
        }),
      ) as Record<MessageId, Message>;

      for (const orderRow of orderRows) {
        const branchId = expectString(
          orderRow,
          "branch_id",
          "branch_message_order row",
        ) as BranchId;
        const messageId = expectString(
          orderRow,
          "message_id",
          "branch_message_order row",
        ) as MessageId;
        expectInteger(orderRow, "ordinal", "branch_message_order row");
        const branch = branches[branchId];
        if (!branch || !messages[messageId]) {
          throw new PersistenceInvariantError(
            `conversation ${id} contains a broken branch/message ordering reference`,
          );
        }
        branch.messageIds.push(messageId);
      }

      if (conversationRow.branchCount !== branchRows.length) {
        throw new PersistenceInvariantError(
          `conversation ${id} branch count metadata is inconsistent`,
        );
      }

      return validateSnapshotForPersistence({
        conversation: {
          id: conversationRow.id,
          ownerId: conversationRow.ownerId,
          rootBranchId: conversationRow.rootBranchId,
          createdAt: conversationRow.createdAt,
          settings: parseJson(
            conversationRow.settingsJson,
            `conversation ${id} settings_json`,
          ),
        },
        branches,
        messages,
        canvas: parseJson<ConversationCanvasState>(
          conversationRow.canvasJson,
          `conversation ${id} canvas_json`,
        ),
      });
    } catch (error) {
      if (error instanceof PersistenceInvariantError) {
        throw error;
      }
      throw new PersistenceInvariantError(
        `conversation ${id} could not be loaded from SQLite`,
        { cause: error },
      );
    }
  }

  require(conversationId: string): ConversationGraphSnapshot {
    const snapshot = this.load(conversationId);
    if (!snapshot) {
      throw new ConversationNotFoundError(conversationId);
    }
    return snapshot;
  }

  loadDrafts(conversationId: string): Record<BranchId, string> {
    const id = normalizeIdentifier(conversationId, "conversationId");
    this.assertConversationExists(id);
    const drafts: Record<BranchId, string> = {};
    for (const row of this.selectDrafts.all(id) as SqlRow[]) {
      const draft = parseDraftRow(row, id);
      drafts[draft.branchId as BranchId] = draft.content;
    }
    return drafts;
  }

  saveDraft(
    conversationId: string,
    branchId: string,
    content: string,
    at?: string,
  ): ComposerDraftRecord | null {
    const id = normalizeIdentifier(conversationId, "conversationId");
    const normalizedBranchId = normalizeIdentifier(branchId, "branchId");
    const normalizedContent = normalizeDraftContent(content);
    const timestamp = this.resolveTimestamp(at, "draft updatedAt");

    return this.write(() => {
      this.assertConversationExists(id);
      if (!this.selectBranch.get(id, normalizedBranchId)) {
        throw new Error(
          `Branch ${normalizedBranchId} was not found in conversation ${id}`,
        );
      }
      if (normalizedContent.length === 0) {
        this.deleteDraftRow.run(id, normalizedBranchId);
        return null;
      }
      this.upsertDraftRow.run(
        id,
        normalizedBranchId,
        normalizedContent,
        timestamp,
      );
      return {
        conversationId: id as ConversationModelId,
        branchId: normalizedBranchId as BranchId,
        content: normalizedContent,
        updatedAt: timestamp,
      };
    });
  }

  deleteDraft(conversationId: string, branchId: string): boolean {
    const id = normalizeIdentifier(conversationId, "conversationId");
    const normalizedBranchId = normalizeIdentifier(branchId, "branchId");
    return this.write(() => {
      this.assertConversationExists(id);
      if (!this.selectBranch.get(id, normalizedBranchId)) {
        throw new Error(
          `Branch ${normalizedBranchId} was not found in conversation ${id}`,
        );
      }
      return (
        Number(this.deleteDraftRow.run(id, normalizedBranchId).changes) === 1
      );
    });
  }

  loadBranch(
    conversationId: string,
    branchId: string,
  ): BranchLoadResult | null {
    const id = normalizeIdentifier(conversationId, "conversationId");
    const normalizedBranchId = normalizeIdentifier(branchId, "branchId");
    const conversationSqlRow = this.selectConversation.get(id) as
      | SqlRow
      | undefined;
    if (!conversationSqlRow) {
      return null;
    }
    const branchSqlRow = this.selectBranch.get(id, normalizedBranchId) as
      | SqlRow
      | undefined;
    if (!branchSqlRow) {
      return null;
    }

    try {
      const conversationRow = parseConversationRow(conversationSqlRow);
      const branch = parseBranchRow(branchSqlRow);
      const messageRows = this.selectBranchMessages.all(
        id,
        normalizedBranchId,
      ) as SqlRow[];
      const messages = messageRows.map(parseMessageRow);
      branch.messageIds = messages.map((message) => message.id);

      const storedCanvas = parseJson<ConversationCanvasState>(
        conversationRow.canvasJson,
        `conversation ${id} canvas_json`,
      );
      const branchCanvasNode = storedCanvas.nodes?.[branch.id];
      const validated = validateConversationGraphSnapshot({
        conversation: {
          id: conversationRow.id,
          ownerId: conversationRow.ownerId,
          rootBranchId: branch.id,
          createdAt: conversationRow.createdAt,
          settings: parseJson(
            conversationRow.settingsJson,
            `conversation ${id} settings_json`,
          ),
        },
        branches: { [branch.id]: branch },
        messages: Object.fromEntries(
          messages.map((message) => [message.id, message]),
        ),
        canvas: {
          version: 2,
          viewport: storedCanvas.viewport,
          focusedBranchId: branch.id,
          nodes: branchCanvasNode
            ? { [branch.id]: branchCanvasNode }
            : {
                [branch.id]: {
                  branchId: branch.id,
                  x: 0,
                  y: 0,
                  folded: false,
                  expanded: true,
                },
              },
        },
      });

      return {
        conversationId: id as ConversationModelId,
        branch: validated.branches[branch.id],
        messages: validated.branches[branch.id].messageIds.map(
          (messageId) => validated.messages[messageId],
        ),
      };
    } catch (error) {
      if (error instanceof PersistenceInvariantError) {
        throw error;
      }
      throw new PersistenceInvariantError(
        `branch ${normalizedBranchId} for conversation ${id} could not be loaded from SQLite`,
        { cause: error },
      );
    }
  }

  list(options: ConversationListOptions = {}): ConversationDirectoryEntry[] {
    const includeArchived = options.includeArchived ?? true;
    let rows: SqlRow[];

    if (options.ownerId === undefined) {
      rows = (
        includeArchived
          ? this.selectAllDirectory.all()
          : this.selectActiveDirectory.all()
      ) as SqlRow[];
    } else if (options.ownerId === null) {
      rows = (
        includeArchived
          ? this.selectDirectoryWithoutOwner.all()
          : this.selectActiveDirectoryWithoutOwner.all()
      ) as SqlRow[];
    } else {
      const ownerId = normalizeIdentifier(options.ownerId, "ownerId");
      rows = (
        includeArchived
          ? this.selectDirectoryByOwner.all(ownerId)
          : this.selectActiveDirectoryByOwner.all(ownerId)
      ) as SqlRow[];
    }

    return rows.map((row) => directoryEntryFromRow(parseConversationRow(row)));
  }

  getDirectoryEntry(
    conversationId: string,
  ): ConversationDirectoryEntry | null {
    const id = normalizeIdentifier(conversationId, "conversationId");
    const row = this.selectConversation.get(id) as SqlRow | undefined;
    return row ? directoryEntryFromRow(parseConversationRow(row)) : null;
  }

  rename(
    conversationId: string,
    title: string,
    at?: string,
  ): ConversationDirectoryEntry {
    const id = normalizeIdentifier(conversationId, "conversationId");
    const normalizedTitle = normalizeTitle(title);
    const timestamp = this.resolveTimestamp(at, "rename timestamp");

    return this.write(() => {
      this.assertConversationExists(id);
      const branchResult = this.renameRootBranchRow.run(
        normalizedTitle,
        id,
        id,
      );
      if (Number(branchResult.changes) !== 1) {
        throw new PersistenceInvariantError(
          `conversation ${id} is missing its root branch`,
        );
      }
      this.renameConversationRow.run(
        normalizedTitle,
        timestamp,
        timestamp,
        id,
      );
      return this.requireDirectoryEntry(id);
    });
  }

  archive(
    conversationId: string,
    at?: string,
  ): ConversationDirectoryEntry {
    const id = normalizeIdentifier(conversationId, "conversationId");
    const timestamp = this.resolveTimestamp(at, "archive timestamp");
    return this.write(() => {
      this.assertConversationExists(id);
      this.archiveConversationRow.run(timestamp, timestamp, id);
      return this.requireDirectoryEntry(id);
    });
  }

  unarchive(
    conversationId: string,
    at?: string,
  ): ConversationDirectoryEntry {
    const id = normalizeIdentifier(conversationId, "conversationId");
    const timestamp = this.resolveTimestamp(at, "unarchive timestamp");
    return this.write(() => {
      this.assertConversationExists(id);
      this.unarchiveConversationRow.run(timestamp, id);
      return this.requireDirectoryEntry(id);
    });
  }

  touch(conversationId: string, at?: string): ConversationDirectoryEntry {
    const id = normalizeIdentifier(conversationId, "conversationId");
    const timestamp = this.resolveTimestamp(at, "lastActiveAt");
    return this.write(() => {
      this.assertConversationExists(id);
      this.touchConversationRow.run(timestamp, timestamp, id);
      return this.requireDirectoryEntry(id);
    });
  }

  delete(conversationId: string): boolean {
    const id = normalizeIdentifier(conversationId, "conversationId");
    return this.write(
      () => Number(this.deleteConversationRow.run(id).changes) === 1,
    );
  }

  private resolveTitle(
    snapshot: ConversationGraphSnapshot,
    title: string | undefined,
  ): string {
    const rootTitle =
      snapshot.branches[snapshot.conversation.rootBranchId]?.title;
    return normalizeTitle(
      title ?? (rootTitle?.trim() || snapshot.conversation.id),
    );
  }

  private resolveTimestamp(
    timestamp: string | undefined,
    label: string,
  ): string {
    return normalizeTimestamp(timestamp ?? this.clock(), label);
  }

  private writeChildRows(serialized: SerializedSnapshot): void {
    for (const branch of serialized.branches) {
      this.insertBranch.run(
        branch.conversationId,
        branch.id,
        branch.parentId,
        branch.title,
        branch.createdFromMessageId,
        branch.createdFromSpanStart,
        branch.createdFromSpanEnd,
        branch.createdFromExcerpt,
        branch.createdAt,
        branch.archivedAt,
        branch.inferenceContextJson,
      );
    }
    for (const message of serialized.messages) {
      this.insertMessage.run(
        message.conversationId,
        message.id,
        message.branchId,
        message.role,
        message.content,
        message.createdAt,
        message.tokenUsageJson,
        message.attachmentsJson,
        message.toolInvocationsJson,
        message.inferenceContextJson,
      );
    }
    for (const order of serialized.messageOrder) {
      this.insertMessageOrder.run(
        order.conversationId,
        order.branchId,
        order.ordinal,
        order.messageId,
      );
    }
  }

  private assertConversationExists(conversationId: string): void {
    if (!this.selectConversation.get(conversationId)) {
      throw new ConversationNotFoundError(conversationId);
    }
  }

  private requireDirectoryEntry(
    conversationId: string,
  ): ConversationDirectoryEntry {
    const row = this.selectConversation.get(conversationId) as
      | SqlRow
      | undefined;
    if (!row) {
      throw new ConversationNotFoundError(conversationId);
    }
    return directoryEntryFromRow(parseConversationRow(row));
  }

  private write<T>(operation: () => T): T {
    if (this.writing || this.database.isTransaction) {
      throw new Error("Nested Branchy persistence writes are not allowed");
    }

    this.writing = true;
    try {
      this.database.exec("BEGIN IMMEDIATE");
      try {
        const result = operation();
        this.database.exec("COMMIT");
        return result;
      } catch (error) {
        if (this.database.isTransaction) {
          this.database.exec("ROLLBACK");
        }
        throw error;
      }
    } finally {
      this.writing = false;
    }
  }
}
