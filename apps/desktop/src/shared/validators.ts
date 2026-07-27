import type {
  BootstrapConversationInput,
  BranchDraftInput,
  BranchIdentityInput,
  BranchyStreamEvent,
  CancelChatGptLoginInput,
  CancelMessageInput,
  CreateAttachmentInput,
  CreateConversationInput,
  DesktopCommandRequestMap,
  EmptyPayload,
  ExportArchiveInput,
  GeneratedImageIdentityInput,
  ImportArchiveInput,
  ListConversationsInput,
  LoadConversationInput,
  Message,
  OpenExternalInput,
  RemoveAttachmentInput,
  RenameBranchInput,
  RenameConversationInput,
  RetryGeneratedImageInput,
  SaveBranchNoteInput,
  SaveComposerDraftInput,
  SaveGeneratedImageInput,
  SendMessageInput,
  StreamCloseInput,
  StreamConversationDelta,
  StreamOpenInput,
  StreamPortMessage,
  TranscribeAudioInput,
  UpdateConversationCanvasInput,
  UpdateConversationSettingsInput,
  UpdateBranchNoteInput,
} from "./contracts.ts";
import { IPC_CHANNELS, STREAM_PROTOCOL_VERSION } from "./contracts.ts";

export const PAYLOAD_LIMITS = {
  idCharacters: 128,
  idBytes: 256,
  modelCharacters: 128,
  modelBytes: 256,
  titleCharacters: 120,
  titleBytes: 256,
  messageCharacters: 120_000,
  messageBytes: 256 * 1024,
  systemPromptCharacters: 32_000,
  systemPromptBytes: 64 * 1024,
  excerptCharacters: 32_000,
  excerptBytes: 64 * 1024,
  fileNameCharacters: 255,
  fileNameBytes: 1_024,
  mimeTypeCharacters: 127,
  mimeTypeBytes: 256,
  urlCharacters: 2_048,
  urlBytes: 8 * 1024,
  attachmentBytes: 20 * 1024 * 1024,
  dictationBytes: 6 * 1024 * 1024,
  attachmentsPerMessage: 8,
  canvasNodes: 500,
  archiveConversations: 1_000,
  streamDeltaCharacters: 64_000,
  streamDeltaBytes: 128 * 1024,
  streamContentCharacters: 500_000,
  streamContentBytes: 1024 * 1024,
} as const;

export class PayloadValidationError extends TypeError {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "PayloadValidationError";
    this.path = path;
  }
}

type UnknownRecord = Record<string, unknown>;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_:-]*$/;
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const MIME_TYPE_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const WINDOWS_DRIVE_PATTERN = /^[A-Za-z]:/;
const ALLOWED_TOOLS = new Set([
  "study-and-learn",
  "web-search",
  "file-upload",
]);
const ALLOWED_PRESETS = new Set(["fast", "reasoning", "study", "custom"]);
const ALLOWED_REASONING_EFFORTS = new Set([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
]);
const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function fail(path: string, message: string): never {
  throw new PayloadValidationError(path, message);
}

function readRecord(
  value: unknown,
  path: string,
  allowedKeys: readonly string[],
): UnknownRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(path, "must be an object");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(path, "must be a plain object");
  }
  const record = value as UnknownRecord;
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      fail(`${path}.${key}`, "is not allowed");
    }
  }
  return record;
}

function readOpenRecord(value: unknown, path: string): UnknownRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(path, "must be an object");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(path, "must be a plain object");
  }
  return value as UnknownRecord;
}

function optionalRecord(
  value: unknown,
  path: string,
  allowedKeys: readonly string[],
): UnknownRecord {
  return readRecord(value ?? {}, path, allowedKeys);
}

function hasOwn(record: UnknownRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function readString(
  value: unknown,
  path: string,
  options: {
    maxCharacters: number;
    maxBytes: number;
    allowEmpty?: boolean;
    allowControlCharacters?: boolean;
  },
): string {
  if (typeof value !== "string") {
    fail(path, "must be a string");
  }
  if (!options.allowEmpty && value.trim().length === 0) {
    fail(path, "must not be empty");
  }
  if (value.length > options.maxCharacters) {
    fail(path, `must be at most ${options.maxCharacters} characters`);
  }
  if (utf8ByteLength(value) > options.maxBytes) {
    fail(path, `must be at most ${options.maxBytes} UTF-8 bytes`);
  }
  if (
    !options.allowControlCharacters &&
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    fail(path, "contains a control character");
  }
  return value;
}

function readId(value: unknown, path: string): string {
  const id = readString(value, path, {
    maxCharacters: PAYLOAD_LIMITS.idCharacters,
    maxBytes: PAYLOAD_LIMITS.idBytes,
  });
  if (!ID_PATTERN.test(id)) {
    fail(
      path,
      "must contain only letters, numbers, underscores, hyphens, or colons",
    );
  }
  return id;
}

function readOptionalId(
  record: UnknownRecord,
  key: string,
  path: string,
): string | undefined {
  return hasOwn(record, key) ? readId(record[key], `${path}.${key}`) : undefined;
}

function readTitle(value: unknown, path: string): string {
  return readString(value, path, {
    maxCharacters: PAYLOAD_LIMITS.titleCharacters,
    maxBytes: PAYLOAD_LIMITS.titleBytes,
  });
}

function readMessage(value: unknown, path: string): string {
  return readString(value, path, {
    maxCharacters: PAYLOAD_LIMITS.messageCharacters,
    maxBytes: PAYLOAD_LIMITS.messageBytes,
  });
}

function readNullableString(
  value: unknown,
  path: string,
  options: {
    maxCharacters: number;
    maxBytes: number;
    allowControlCharacters?: boolean;
  },
): string | null {
  if (value === null) {
    return null;
  }
  return readString(value, path, {
    ...options,
    allowEmpty: true,
  });
}

function readBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    fail(path, "must be a boolean");
  }
  return value;
}

function readFiniteNumber(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    fail(path, `must be a finite number from ${minimum} to ${maximum}`);
  }
  return value;
}

function readSafeInteger(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    fail(path, `must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function readEnum<T extends string>(
  value: unknown,
  path: string,
  allowed: ReadonlySet<string>,
): T {
  if (typeof value !== "string" || !allowed.has(value)) {
    fail(path, `has an unsupported value`);
  }
  return value as T;
}

function readTools(value: unknown, path: string): CreateConversationInput["tools"] {
  if (!Array.isArray(value) || value.length > ALLOWED_TOOLS.size) {
    fail(path, `must be an array with at most ${ALLOWED_TOOLS.size} tools`);
  }
  const tools = value.map((tool, index) =>
    readEnum<NonNullable<CreateConversationInput["tools"]>[number]>(
      tool,
      `${path}[${index}]`,
      ALLOWED_TOOLS,
    ),
  );
  if (new Set(tools).size !== tools.length) {
    fail(path, "must not contain duplicate tools");
  }
  return tools;
}

function readIdArray(
  value: unknown,
  path: string,
  maximum: number,
): string[] {
  if (!Array.isArray(value) || value.length > maximum) {
    fail(path, `must be an array with at most ${maximum} identifiers`);
  }
  const ids = value.map((id, index) => readId(id, `${path}[${index}]`));
  if (new Set(ids).size !== ids.length) {
    fail(path, "must not contain duplicate identifiers");
  }
  return ids;
}

function readBytes(
  value: unknown,
  path: string,
  maximum: number,
): Uint8Array | ArrayBuffer {
  const isUint8Array = value instanceof Uint8Array;
  const isArrayBuffer = value instanceof ArrayBuffer;
  if (!isUint8Array && !isArrayBuffer) {
    fail(path, "must be an ArrayBuffer or Uint8Array");
  }
  const byteLength = value.byteLength;
  if (byteLength === 0) {
    fail(path, "must not be empty");
  }
  if (byteLength > maximum) {
    fail(path, `must be at most ${maximum} bytes`);
  }
  return value;
}

function decodeForPathCheck(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function readSafeFileName(value: unknown, path: string): string {
  const fileName = readString(value, path, {
    maxCharacters: PAYLOAD_LIMITS.fileNameCharacters,
    maxBytes: PAYLOAD_LIMITS.fileNameBytes,
  });
  const decoded = decodeForPathCheck(fileName);
  if (
    fileName !== fileName.trim() ||
    decoded === "." ||
    decoded === ".." ||
    decoded.startsWith(".") ||
    decoded.startsWith("~") ||
    decoded.includes("/") ||
    decoded.includes("\\") ||
    decoded.includes(":") ||
    WINDOWS_DRIVE_PATTERN.test(decoded)
  ) {
    fail(path, "must be a file name, not a path");
  }
  return fileName;
}

function readMimeType(value: unknown, path: string): string {
  const contentType = readString(value, path, {
    maxCharacters: PAYLOAD_LIMITS.mimeTypeCharacters,
    maxBytes: PAYLOAD_LIMITS.mimeTypeBytes,
  });
  if (!MIME_TYPE_PATTERN.test(contentType)) {
    fail(path, "must be a valid MIME type without parameters");
  }
  return contentType;
}

function readHttpsUrl(value: unknown, path: string): string {
  const source = readString(value, path, {
    maxCharacters: PAYLOAD_LIMITS.urlCharacters,
    maxBytes: PAYLOAD_LIMITS.urlBytes,
  });
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    fail(path, "must be a valid URL");
  }
  if (
    url.protocol !== "https:" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    !url.hostname
  ) {
    fail(path, "must be an HTTPS URL without embedded credentials");
  }
  return url.toString();
}

function readConversationIdentity(
  value: unknown,
  path: string,
): { conversationId: string } {
  const record = readRecord(value, path, ["conversationId"]);
  return {
    conversationId: readId(record.conversationId, `${path}.conversationId`),
  };
}

function readBranchIdentity(
  value: unknown,
  path: string,
): BranchIdentityInput {
  const record = readRecord(value, path, ["conversationId", "branchId"]);
  return {
    conversationId: readId(record.conversationId, `${path}.conversationId`),
    branchId: readId(record.branchId, `${path}.branchId`),
  };
}

function readBranchDraft(value: unknown, path: string): BranchDraftInput {
  const record = readRecord(value, path, [
    "parentBranchId",
    "messageId",
    "span",
    "title",
    "excerpt",
  ]);
  const span = hasOwn(record, "span")
    ? record.span === null
      ? null
      : readBranchSpan(record.span, `${path}.span`)
    : undefined;
  return {
    parentBranchId: readId(
      record.parentBranchId,
      `${path}.parentBranchId`,
    ),
    messageId: readId(record.messageId, `${path}.messageId`),
    ...(span !== undefined ? { span } : {}),
    ...(hasOwn(record, "title")
      ? { title: readTitle(record.title, `${path}.title`) }
      : {}),
    ...(hasOwn(record, "excerpt")
      ? {
          excerpt: readNullableString(record.excerpt, `${path}.excerpt`, {
            maxCharacters: PAYLOAD_LIMITS.excerptCharacters,
            maxBytes: PAYLOAD_LIMITS.excerptBytes,
          }),
        }
      : {}),
  };
}

function readBranchSpan(
  value: unknown,
  path: string,
): { start: number; end: number } {
  const record = readRecord(value, path, ["start", "end"]);
  const start = readSafeInteger(
    record.start,
    `${path}.start`,
    0,
    PAYLOAD_LIMITS.messageCharacters,
  );
  const end = readSafeInteger(
    record.end,
    `${path}.end`,
    1,
    PAYLOAD_LIMITS.messageCharacters,
  );
  if (end <= start) {
    fail(path, "end must be greater than start");
  }
  return { start, end };
}

export function validateEmptyPayload(value: unknown): EmptyPayload {
  optionalRecord(value, "payload", []);
  return {};
}

export function validateBootstrapConversationInput(
  value: unknown,
): BootstrapConversationInput {
  const record = optionalRecord(value, "payload", [
    "conversationId",
    "branchId",
  ]);
  return {
    ...(readOptionalId(record, "conversationId", "payload")
      ? {
          conversationId: readOptionalId(
            record,
            "conversationId",
            "payload",
          ),
        }
      : {}),
    ...(readOptionalId(record, "branchId", "payload")
      ? { branchId: readOptionalId(record, "branchId", "payload") }
      : {}),
  };
}

export function validateListConversationsInput(
  value: unknown,
): ListConversationsInput {
  const record = optionalRecord(value, "payload", ["includeArchived"]);
  return hasOwn(record, "includeArchived")
    ? {
        includeArchived: readBoolean(
          record.includeArchived,
          "payload.includeArchived",
        ),
      }
    : {};
}

export function validateCreateConversationInput(
  value: unknown,
): CreateConversationInput {
  const record = optionalRecord(value, "payload", [
    "title",
    "initialMessage",
    "preset",
    "model",
    "reasoningEffort",
    "tools",
  ]);
  const result: CreateConversationInput = {};
  if (hasOwn(record, "title")) {
    result.title = readTitle(record.title, "payload.title");
  }
  if (hasOwn(record, "initialMessage")) {
    result.initialMessage = readMessage(
      record.initialMessage,
      "payload.initialMessage",
    );
  }
  if (hasOwn(record, "preset")) {
    result.preset = readEnum<NonNullable<CreateConversationInput["preset"]>>(
      record.preset,
      "payload.preset",
      ALLOWED_PRESETS,
    );
  }
  if (hasOwn(record, "model")) {
    const model = readString(record.model, "payload.model", {
      maxCharacters: PAYLOAD_LIMITS.modelCharacters,
      maxBytes: PAYLOAD_LIMITS.modelBytes,
    });
    if (!MODEL_PATTERN.test(model)) {
      fail("payload.model", "has an invalid model identifier");
    }
    result.model = model;
  }
  if (hasOwn(record, "reasoningEffort")) {
    result.reasoningEffort =
      record.reasoningEffort === null
        ? null
        : readEnum<
            Exclude<CreateConversationInput["reasoningEffort"], null | undefined>
          >(
            record.reasoningEffort,
            "payload.reasoningEffort",
            ALLOWED_REASONING_EFFORTS,
          );
  }
  if (hasOwn(record, "tools")) {
    result.tools = readTools(record.tools, "payload.tools");
  }
  return result;
}

export function validateLoadConversationInput(
  value: unknown,
): LoadConversationInput {
  return readConversationIdentity(value, "payload");
}

export function validateRenameConversationInput(
  value: unknown,
): RenameConversationInput {
  const record = readRecord(value, "payload", ["conversationId", "title"]);
  return {
    conversationId: readId(
      record.conversationId,
      "payload.conversationId",
    ),
    title: readTitle(record.title, "payload.title"),
  };
}

export const validateConversationIdentityInput =
  validateLoadConversationInput;

export function validateUpdateConversationSettingsInput(
  value: unknown,
): UpdateConversationSettingsInput {
  const record = readRecord(value, "payload", [
    "conversationId",
    "model",
    "temperature",
    "systemPrompt",
    "reasoningEffort",
    "preset",
    "tools",
  ]);
  const result: UpdateConversationSettingsInput = {
    conversationId: readId(
      record.conversationId,
      "payload.conversationId",
    ),
  };
  let updateCount = 0;
  if (hasOwn(record, "model")) {
    const model = readString(record.model, "payload.model", {
      maxCharacters: PAYLOAD_LIMITS.modelCharacters,
      maxBytes: PAYLOAD_LIMITS.modelBytes,
    });
    if (!MODEL_PATTERN.test(model)) {
      fail("payload.model", "has an invalid model identifier");
    }
    result.model = model;
    updateCount += 1;
  }
  if (hasOwn(record, "temperature")) {
    result.temperature = readFiniteNumber(
      record.temperature,
      "payload.temperature",
      0,
      2,
    );
    updateCount += 1;
  }
  if (hasOwn(record, "systemPrompt")) {
    result.systemPrompt = readNullableString(
      record.systemPrompt,
      "payload.systemPrompt",
      {
        maxCharacters: PAYLOAD_LIMITS.systemPromptCharacters,
        maxBytes: PAYLOAD_LIMITS.systemPromptBytes,
      },
    );
    updateCount += 1;
  }
  if (hasOwn(record, "reasoningEffort")) {
    result.reasoningEffort =
      record.reasoningEffort === null
        ? null
        : readEnum<
            Exclude<
              UpdateConversationSettingsInput["reasoningEffort"],
              null | undefined
            >
          >(
            record.reasoningEffort,
            "payload.reasoningEffort",
            ALLOWED_REASONING_EFFORTS,
          );
    updateCount += 1;
  }
  if (hasOwn(record, "preset")) {
    result.preset = readEnum<
      NonNullable<UpdateConversationSettingsInput["preset"]>
    >(
      record.preset,
      "payload.preset",
      ALLOWED_PRESETS,
    );
    updateCount += 1;
  }
  if (hasOwn(record, "tools")) {
    result.tools = readTools(record.tools, "payload.tools");
    updateCount += 1;
  }
  if (updateCount === 0) {
    fail("payload", "must include at least one settings change");
  }
  return result;
}

function readCanvasViewport(
  value: unknown,
  path: string,
): NonNullable<UpdateConversationCanvasInput["viewport"]> {
  const record = readRecord(value, path, ["x", "y", "zoom"]);
  if (Object.keys(record).length === 0) {
    fail(path, "must include at least one viewport field");
  }
  return {
    ...(hasOwn(record, "x")
      ? {
          x: readFiniteNumber(
            record.x,
            `${path}.x`,
            -1_000_000,
            1_000_000,
          ),
        }
      : {}),
    ...(hasOwn(record, "y")
      ? {
          y: readFiniteNumber(
            record.y,
            `${path}.y`,
            -1_000_000,
            1_000_000,
          ),
        }
      : {}),
    ...(hasOwn(record, "zoom")
      ? { zoom: readFiniteNumber(record.zoom, `${path}.zoom`, 0.05, 4) }
      : {}),
  };
}

function readCanvasNodes(
  value: unknown,
  path: string,
): NonNullable<UpdateConversationCanvasInput["nodes"]> {
  const record = readOpenRecord(value, path);
  const entries = Object.entries(record);
  if (entries.length > PAYLOAD_LIMITS.canvasNodes) {
    fail(path, `must contain at most ${PAYLOAD_LIMITS.canvasNodes} nodes`);
  }
  const result: NonNullable<UpdateConversationCanvasInput["nodes"]> = {};
  for (const [branchIdSource, nodeSource] of entries) {
    const branchId = readId(branchIdSource, `${path} key`);
    if (nodeSource === null) {
      result[branchId] = null;
      continue;
    }
    const node = readRecord(nodeSource, `${path}.${branchId}`, [
      "x",
      "y",
      "width",
      "height",
      "folded",
      "expanded",
    ]);
    if (Object.keys(node).length === 0) {
      fail(`${path}.${branchId}`, "must include at least one node field");
    }
    result[branchId] = {
      ...(hasOwn(node, "x")
        ? {
            x: readFiniteNumber(
              node.x,
              `${path}.${branchId}.x`,
              -1_000_000,
              1_000_000,
            ),
          }
        : {}),
      ...(hasOwn(node, "y")
        ? {
            y: readFiniteNumber(
              node.y,
              `${path}.${branchId}.y`,
              -1_000_000,
              1_000_000,
            ),
          }
        : {}),
      ...(hasOwn(node, "width")
        ? {
            width: readFiniteNumber(
              node.width,
              `${path}.${branchId}.width`,
              80,
              4_000,
            ),
          }
        : {}),
      ...(hasOwn(node, "height")
        ? {
            height: readFiniteNumber(
              node.height,
              `${path}.${branchId}.height`,
              40,
              20_000,
            ),
          }
        : {}),
      ...(hasOwn(node, "folded")
        ? {
            folded: readBoolean(
              node.folded,
              `${path}.${branchId}.folded`,
            ),
          }
        : {}),
      ...(hasOwn(node, "expanded")
        ? {
            expanded: readBoolean(
              node.expanded,
              `${path}.${branchId}.expanded`,
            ),
          }
        : {}),
    };
  }
  return result;
}

export function validateUpdateConversationCanvasInput(
  value: unknown,
): UpdateConversationCanvasInput {
  const record = readRecord(value, "payload", [
    "conversationId",
    "viewport",
    "focusedBranchId",
    "nodes",
  ]);
  const result: UpdateConversationCanvasInput = {
    conversationId: readId(
      record.conversationId,
      "payload.conversationId",
    ),
  };
  let updateCount = 0;
  if (hasOwn(record, "viewport")) {
    result.viewport =
      record.viewport === null
        ? null
        : readCanvasViewport(record.viewport, "payload.viewport");
    updateCount += 1;
  }
  if (hasOwn(record, "focusedBranchId")) {
    result.focusedBranchId =
      record.focusedBranchId === null
        ? null
        : readId(record.focusedBranchId, "payload.focusedBranchId");
    updateCount += 1;
  }
  if (hasOwn(record, "nodes")) {
    result.nodes = readCanvasNodes(record.nodes, "payload.nodes");
    updateCount += 1;
  }
  if (updateCount === 0) {
    fail("payload", "must include at least one canvas change");
  }
  return result;
}

export function validateBranchIdentityInput(
  value: unknown,
): BranchIdentityInput {
  return readBranchIdentity(value, "payload");
}

export function validateRenameBranchInput(
  value: unknown,
): RenameBranchInput {
  const record = readRecord(value, "payload", [
    "conversationId",
    "branchId",
    "title",
  ]);
  return {
    conversationId: readId(
      record.conversationId,
      "payload.conversationId",
    ),
    branchId: readId(record.branchId, "payload.branchId"),
    title: readTitle(record.title, "payload.title"),
  };
}

export function validateSaveBranchNoteInput(
  value: unknown,
): SaveBranchNoteInput {
  const record = readRecord(value, "payload", [
    "conversationId",
    "parentBranchId",
    "messageId",
    "span",
    "title",
    "excerpt",
    "content",
    "attachmentIds",
  ]);
  const draft = readBranchDraft(
    {
      parentBranchId: record.parentBranchId,
      messageId: record.messageId,
      ...(hasOwn(record, "span") ? { span: record.span } : {}),
      ...(hasOwn(record, "title") ? { title: record.title } : {}),
      ...(hasOwn(record, "excerpt") ? { excerpt: record.excerpt } : {}),
    },
    "payload",
  );
  return {
    conversationId: readId(
      record.conversationId,
      "payload.conversationId",
    ),
    ...draft,
    content: readMessage(record.content, "payload.content"),
    ...(hasOwn(record, "attachmentIds")
      ? {
          attachmentIds: readIdArray(
            record.attachmentIds,
            "payload.attachmentIds",
            PAYLOAD_LIMITS.attachmentsPerMessage,
          ),
        }
      : {}),
  };
}

export function validateUpdateBranchNoteInput(
  value: unknown,
): UpdateBranchNoteInput {
  const record = readRecord(value, "payload", [
    "conversationId",
    "branchId",
    "content",
  ]);
  return {
    conversationId: readId(
      record.conversationId,
      "payload.conversationId",
    ),
    branchId: readId(record.branchId, "payload.branchId"),
    content: readMessage(record.content, "payload.content"),
  };
}

export function validateSaveComposerDraftInput(
  value: unknown,
): SaveComposerDraftInput {
  const record = readRecord(value, "payload", [
    "conversationId",
    "branchId",
    "content",
  ]);
  return {
    conversationId: readId(
      record.conversationId,
      "payload.conversationId",
    ),
    branchId: readId(record.branchId, "payload.branchId"),
    content: readString(record.content, "payload.content", {
      maxCharacters: PAYLOAD_LIMITS.messageCharacters,
      maxBytes: PAYLOAD_LIMITS.messageBytes,
      allowEmpty: true,
    }),
  };
}

export function validateSendMessageInput(value: unknown): SendMessageInput {
  const record = readRecord(value, "payload", [
    "conversationId",
    "branchId",
    "branchDraft",
    "content",
    "streamId",
    "tools",
    "attachmentIds",
  ]);
  const hasBranchId = hasOwn(record, "branchId");
  const hasBranchDraft = hasOwn(record, "branchDraft");
  if (hasBranchId === hasBranchDraft) {
    fail("payload", "must include exactly one of branchId or branchDraft");
  }
  const common = {
    conversationId: readId(
      record.conversationId,
      "payload.conversationId",
    ),
    content: readMessage(record.content, "payload.content"),
    streamId: readId(record.streamId, "payload.streamId"),
    ...(hasOwn(record, "tools")
      ? { tools: readTools(record.tools, "payload.tools") }
      : {}),
    ...(hasOwn(record, "attachmentIds")
      ? {
          attachmentIds: readIdArray(
            record.attachmentIds,
            "payload.attachmentIds",
            PAYLOAD_LIMITS.attachmentsPerMessage,
          ),
        }
      : {}),
  };
  return hasBranchId
    ? {
        ...common,
        branchId: readId(record.branchId, "payload.branchId"),
      }
    : {
        ...common,
        branchDraft: readBranchDraft(
          record.branchDraft,
          "payload.branchDraft",
        ),
      };
}

export function validateCancelMessageInput(
  value: unknown,
): CancelMessageInput {
  const record = readRecord(value, "payload", [
    "conversationId",
    "streamId",
  ]);
  return {
    conversationId: readId(
      record.conversationId,
      "payload.conversationId",
    ),
    streamId: readId(record.streamId, "payload.streamId"),
  };
}

export function validateCreateAttachmentInput(
  value: unknown,
): CreateAttachmentInput {
  const record = readRecord(value, "payload", [
    "conversationId",
    "fileName",
    "contentType",
    "bytes",
    "lastModified",
  ]);
  const contentType = readMimeType(
    record.contentType,
    "payload.contentType",
  );
  if (
    !contentType.startsWith("image/") &&
    !ALLOWED_ATTACHMENT_MIME_TYPES.has(contentType)
  ) {
    fail("payload.contentType", "is not an allowed attachment type");
  }
  return {
    conversationId: readId(
      record.conversationId,
      "payload.conversationId",
    ),
    fileName: readSafeFileName(record.fileName, "payload.fileName"),
    contentType,
    bytes: readBytes(
      record.bytes,
      "payload.bytes",
      PAYLOAD_LIMITS.attachmentBytes,
    ),
    ...(hasOwn(record, "lastModified")
      ? {
          lastModified: readSafeInteger(
            record.lastModified,
            "payload.lastModified",
            0,
            9_999_999_999_999,
          ),
        }
      : {}),
  };
}

export function validateRemoveAttachmentInput(
  value: unknown,
): RemoveAttachmentInput {
  const record = readRecord(value, "payload", [
    "conversationId",
    "attachmentId",
  ]);
  return {
    conversationId: readId(
      record.conversationId,
      "payload.conversationId",
    ),
    attachmentId: readId(record.attachmentId, "payload.attachmentId"),
  };
}

export function validateTranscribeAudioInput(
  value: unknown,
): TranscribeAudioInput {
  const record = readRecord(value, "payload", ["contentType", "bytes"]);
  if (record.contentType !== "audio/wav") {
    fail("payload.contentType", "must be audio/wav");
  }
  return {
    contentType: "audio/wav",
    bytes: readBytes(
      record.bytes,
      "payload.bytes",
      PAYLOAD_LIMITS.dictationBytes,
    ),
  };
}

function readGeneratedImageIdentity(
  value: unknown,
  path: string,
  extraKeys: readonly string[] = [],
): UnknownRecord & GeneratedImageIdentityInput {
  const record = readRecord(value, path, [
    "conversationId",
    "messageId",
    "imageId",
    ...extraKeys,
  ]);
  return {
    ...record,
    conversationId: readId(record.conversationId, `${path}.conversationId`),
    messageId: readId(record.messageId, `${path}.messageId`),
    imageId: readId(record.imageId, `${path}.imageId`),
  };
}

export function validateGeneratedImageIdentityInput(
  value: unknown,
): GeneratedImageIdentityInput {
  const record = readGeneratedImageIdentity(value, "payload");
  return {
    conversationId: record.conversationId,
    messageId: record.messageId,
    imageId: record.imageId,
  };
}

export function validateSaveGeneratedImageInput(
  value: unknown,
): SaveGeneratedImageInput {
  const record = readGeneratedImageIdentity(value, "payload", [
    "suggestedFileName",
  ]);
  return {
    conversationId: record.conversationId,
    messageId: record.messageId,
    imageId: record.imageId,
    ...(hasOwn(record, "suggestedFileName")
      ? {
          suggestedFileName: readSafeFileName(
            record.suggestedFileName,
            "payload.suggestedFileName",
          ),
        }
      : {}),
  };
}

export function validateRetryGeneratedImageInput(
  value: unknown,
): RetryGeneratedImageInput {
  const record = readGeneratedImageIdentity(value, "payload", [
    "branchId",
    "prompt",
    "streamId",
  ]);
  return {
    conversationId: record.conversationId,
    messageId: record.messageId,
    imageId: record.imageId,
    branchId: readId(record.branchId, "payload.branchId"),
    prompt: readMessage(record.prompt, "payload.prompt"),
    streamId: readId(record.streamId, "payload.streamId"),
  };
}

export function validateCancelChatGptLoginInput(
  value: unknown,
): CancelChatGptLoginInput {
  const record = readRecord(value, "payload", ["loginId"]);
  return { loginId: readId(record.loginId, "payload.loginId") };
}

export function validateExportArchiveInput(
  value: unknown,
): ExportArchiveInput {
  const record = optionalRecord(value, "payload", ["conversationIds"]);
  return hasOwn(record, "conversationIds")
    ? {
        conversationIds: readIdArray(
          record.conversationIds,
          "payload.conversationIds",
          PAYLOAD_LIMITS.archiveConversations,
        ),
      }
    : {};
}

export function validateImportArchiveInput(
  value: unknown,
): ImportArchiveInput {
  const record = readRecord(value, "payload", ["conflictPolicy"]);
  return {
    conflictPolicy: readEnum(
      record.conflictPolicy,
      "payload.conflictPolicy",
      new Set(["duplicate", "skip"]),
    ),
  };
}

export function validateOpenExternalInput(
  value: unknown,
): OpenExternalInput {
  const record = readRecord(value, "payload", ["url"]);
  return { url: readHttpsUrl(record.url, "payload.url") };
}

export function validateStreamOpenInput(value: unknown): StreamOpenInput {
  const record = readRecord(value, "payload", [
    "streamId",
    "subscriptionId",
  ]);
  return {
    streamId: readId(record.streamId, "payload.streamId"),
    subscriptionId: readId(
      record.subscriptionId,
      "payload.subscriptionId",
    ),
  };
}

export function validateStreamCloseInput(value: unknown): StreamCloseInput {
  return validateStreamOpenInput(value);
}

function readOptionalBoundedString(
  record: UnknownRecord,
  key: string,
  path: string,
  maxCharacters: number,
  maxBytes: number,
): string | undefined {
  return hasOwn(record, key)
    ? readString(record[key], `${path}.${key}`, {
      maxCharacters,
      maxBytes,
      allowEmpty: true,
      })
    : undefined;
}

function readIsoDate(value: unknown, path: string): string {
  const source = readString(value, path, {
    maxCharacters: 64,
    maxBytes: 128,
  });
  if (!Number.isFinite(Date.parse(source))) {
    fail(path, "must be an ISO date-time string");
  }
  return source;
}

function readCanonicalMessage(value: unknown, path: string): Message {
  const record = readRecord(value, path, [
    "id",
    "branchId",
    "role",
    "content",
    "createdAt",
    "tokenUsage",
    "attachments",
    "toolInvocations",
    "inferenceContext",
  ]);
  if (!["user", "assistant", "system"].includes(String(record.role))) {
    fail(`${path}.role`, "has an unsupported value");
  }
  if (
    hasOwn(record, "attachments") &&
    record.attachments !== null &&
    (!Array.isArray(record.attachments) ||
      record.attachments.length > PAYLOAD_LIMITS.attachmentsPerMessage)
  ) {
    fail(
      `${path}.attachments`,
      `must contain at most ${PAYLOAD_LIMITS.attachmentsPerMessage} attachments`,
    );
  }
  if (
    hasOwn(record, "toolInvocations") &&
    record.toolInvocations !== null &&
    (!Array.isArray(record.toolInvocations) ||
      record.toolInvocations.length > 100)
  ) {
    fail(`${path}.toolInvocations`, "must contain at most 100 invocations");
  }
  if (hasOwn(record, "tokenUsage") && record.tokenUsage !== null) {
    const usage = readRecord(record.tokenUsage, `${path}.tokenUsage`, [
      "prompt",
      "completion",
      "cost",
    ]);
    readSafeInteger(
      usage.prompt,
      `${path}.tokenUsage.prompt`,
      0,
      Number.MAX_SAFE_INTEGER,
    );
    readSafeInteger(
      usage.completion,
      `${path}.tokenUsage.completion`,
      0,
      Number.MAX_SAFE_INTEGER,
    );
    readFiniteNumber(
      usage.cost,
      `${path}.tokenUsage.cost`,
      0,
      Number.MAX_VALUE,
    );
  }
  return {
    id: readId(record.id, `${path}.id`),
    branchId: readId(record.branchId, `${path}.branchId`),
    role: record.role as Message["role"],
    content: readString(record.content, `${path}.content`, {
      maxCharacters: PAYLOAD_LIMITS.streamContentCharacters,
      maxBytes: PAYLOAD_LIMITS.streamContentBytes,
      allowEmpty: true,
    }),
    createdAt: readIsoDate(record.createdAt, `${path}.createdAt`),
    ...(hasOwn(record, "tokenUsage")
      ? { tokenUsage: record.tokenUsage as Message["tokenUsage"] }
      : {}),
    ...(hasOwn(record, "attachments")
      ? { attachments: record.attachments as Message["attachments"] }
      : {}),
    ...(hasOwn(record, "toolInvocations")
      ? {
          toolInvocations:
            record.toolInvocations as Message["toolInvocations"],
        }
      : {}),
    ...(hasOwn(record, "inferenceContext")
      ? {
          inferenceContext:
            record.inferenceContext as Message["inferenceContext"],
        }
      : {}),
  };
}

function readStreamConversationDelta(
  value: unknown,
  path: string,
): StreamConversationDelta {
  const record = readRecord(value, path, [
    "conversationId",
    "branchId",
    "version",
    "assistantMessage",
    "assistantRenderedHtml",
  ]);
  const assistantMessage = readCanonicalMessage(
    record.assistantMessage,
    `${path}.assistantMessage`,
  );
  if (assistantMessage.role !== "assistant") {
    fail(`${path}.assistantMessage.role`, "must be assistant");
  }
  const branchId = readId(record.branchId, `${path}.branchId`);
  if (assistantMessage.branchId !== branchId) {
    fail(
      `${path}.assistantMessage.branchId`,
      "must match canonical branchId",
    );
  }
  return {
    conversationId: readId(
      record.conversationId,
      `${path}.conversationId`,
    ),
    branchId,
    version: readSafeInteger(
      record.version,
      `${path}.version`,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    assistantMessage,
    assistantRenderedHtml: readString(
      record.assistantRenderedHtml,
      `${path}.assistantRenderedHtml`,
      {
        maxCharacters: PAYLOAD_LIMITS.streamContentCharacters * 2,
        maxBytes: PAYLOAD_LIMITS.streamContentBytes * 2,
        allowEmpty: true,
      },
    ),
  };
}

export function validateBranchyStreamEvent(
  value: unknown,
): BranchyStreamEvent {
  const base = readRecord(value, "event", [
    "type",
    "threadId",
    "turnId",
    "contextMode",
    "recovered",
    "delta",
    "content",
    "canonical",
    "tool",
    "callId",
    "status",
    "query",
    "imageId",
    "revisedPrompt",
    "reasoningSummary",
    "promptTokens",
    "completionTokens",
    "historyTruncated",
    "message",
    "recoverable",
  ]);
  if (typeof base.type !== "string") {
    fail("event.type", "must be a string");
  }

  switch (base.type) {
    case "start": {
      const record = readRecord(value, "event", [
        "type",
        "threadId",
        "turnId",
        "contextMode",
        "recovered",
      ]);
      return {
        type: "start",
        ...(readOptionalId(record, "threadId", "event")
          ? { threadId: readOptionalId(record, "threadId", "event") }
          : {}),
        ...(readOptionalId(record, "turnId", "event")
          ? { turnId: readOptionalId(record, "turnId", "event") }
          : {}),
        ...(hasOwn(record, "contextMode")
          ? {
              contextMode: readEnum<
                Extract<
                  BranchyStreamEvent,
                  { type: "start" }
                >["contextMode"] & string
              >(
                record.contextMode,
                "event.contextMode",
                new Set(["start", "resume", "fork", "recovery"]),
              ),
            }
          : {}),
        ...(hasOwn(record, "recovered")
          ? {
              recovered: readBoolean(
                record.recovered,
                "event.recovered",
              ),
            }
          : {}),
      };
    }
    case "delta":
      return {
        type: "delta",
        delta: readString(base.delta, "event.delta", {
          maxCharacters: PAYLOAD_LIMITS.streamDeltaCharacters,
          maxBytes: PAYLOAD_LIMITS.streamDeltaBytes,
          allowEmpty: true,
        }),
      };
    case "reasoning_summary":
      return {
        type: "reasoning_summary",
        delta: readString(base.delta, "event.delta", {
          maxCharacters: PAYLOAD_LIMITS.streamDeltaCharacters,
          maxBytes: PAYLOAD_LIMITS.streamDeltaBytes,
          allowEmpty: true,
        }),
        ...(readOptionalBoundedString(
          base,
          "content",
          "event",
          PAYLOAD_LIMITS.streamContentCharacters,
          PAYLOAD_LIMITS.streamContentBytes,
        ) !== undefined
          ? {
              content: readOptionalBoundedString(
                base,
                "content",
                "event",
                PAYLOAD_LIMITS.streamContentCharacters,
                PAYLOAD_LIMITS.streamContentBytes,
              ),
            }
          : {}),
      };
    case "tool_progress": {
      const record = readRecord(value, "event", [
        "type",
        "tool",
        "callId",
        "status",
        "query",
      ]);
      return {
        type: "tool_progress",
        tool: readEnum(
          record.tool,
          "event.tool",
          new Set(["web_search", "image_generation"]),
        ),
        callId: readId(record.callId, "event.callId"),
        status: readEnum(
          record.status,
          "event.status",
          new Set(["running", "succeeded", "failed"]),
        ),
        ...(hasOwn(record, "query")
          ? {
              query: readString(record.query, "event.query", {
                maxCharacters: 4_000,
                maxBytes: 16 * 1024,
                allowEmpty: true,
              }),
            }
          : {}),
      };
    }
    case "image_ready": {
      const record = readRecord(value, "event", [
        "type",
        "imageId",
        "revisedPrompt",
      ]);
      return {
        type: "image_ready",
        imageId: readId(record.imageId, "event.imageId"),
        ...(hasOwn(record, "revisedPrompt")
          ? {
              revisedPrompt: readNullableString(
                record.revisedPrompt,
                "event.revisedPrompt",
                {
                  maxCharacters: PAYLOAD_LIMITS.messageCharacters,
                  maxBytes: PAYLOAD_LIMITS.messageBytes,
                },
              ),
            }
          : {}),
      };
    }
    case "complete": {
      const record = readRecord(value, "event", [
        "type",
        "content",
        "canonical",
        "reasoningSummary",
        "promptTokens",
        "completionTokens",
        "threadId",
        "turnId",
        "recovered",
        "historyTruncated",
      ]);
      return {
        type: "complete",
        content: readString(record.content, "event.content", {
          maxCharacters: PAYLOAD_LIMITS.streamContentCharacters,
          maxBytes: PAYLOAD_LIMITS.streamContentBytes,
          allowEmpty: true,
        }),
        canonical: readStreamConversationDelta(
          record.canonical,
          "event.canonical",
        ),
        ...(hasOwn(record, "reasoningSummary")
          ? {
              reasoningSummary: readNullableString(
                record.reasoningSummary,
                "event.reasoningSummary",
                {
                  maxCharacters: PAYLOAD_LIMITS.streamContentCharacters,
                  maxBytes: PAYLOAD_LIMITS.streamContentBytes,
                },
              ),
            }
          : {}),
        ...(hasOwn(record, "promptTokens")
          ? {
              promptTokens: readSafeInteger(
                record.promptTokens,
                "event.promptTokens",
                0,
                Number.MAX_SAFE_INTEGER,
              ),
            }
          : {}),
        ...(hasOwn(record, "completionTokens")
          ? {
              completionTokens: readSafeInteger(
                record.completionTokens,
                "event.completionTokens",
                0,
                Number.MAX_SAFE_INTEGER,
              ),
            }
          : {}),
        ...(readOptionalId(record, "threadId", "event")
          ? { threadId: readOptionalId(record, "threadId", "event") }
          : {}),
        ...(readOptionalId(record, "turnId", "event")
          ? { turnId: readOptionalId(record, "turnId", "event") }
          : {}),
        ...(hasOwn(record, "recovered")
          ? {
              recovered: readBoolean(
                record.recovered,
                "event.recovered",
              ),
            }
          : {}),
        ...(hasOwn(record, "historyTruncated")
          ? {
              historyTruncated: readBoolean(
                record.historyTruncated,
                "event.historyTruncated",
              ),
            }
          : {}),
      };
    }
    case "cancelled":
      readRecord(value, "event", ["type"]);
      return { type: "cancelled" };
    case "error": {
      const record = readRecord(value, "event", [
        "type",
        "message",
        "recoverable",
      ]);
      return {
        type: "error",
        message: readString(record.message, "event.message", {
          maxCharacters: 4_000,
          maxBytes: 16 * 1024,
        }),
        recoverable: readBoolean(
          record.recoverable,
          "event.recoverable",
        ),
      };
    }
    default:
      fail("event.type", "has an unsupported value");
  }
}

export function validateStreamPortMessage(
  value: unknown,
): StreamPortMessage {
  const base = readRecord(value, "message", [
    "kind",
    "protocolVersion",
    "streamId",
    "subscriptionId",
    "event",
  ]);
  if (base.protocolVersion !== STREAM_PROTOCOL_VERSION) {
    fail(
      "message.protocolVersion",
      `must be ${STREAM_PROTOCOL_VERSION}`,
    );
  }
  if (base.kind === "opened") {
    const record = readRecord(value, "message", [
      "kind",
      "protocolVersion",
      "streamId",
      "subscriptionId",
    ]);
    return {
      kind: "opened",
      protocolVersion: STREAM_PROTOCOL_VERSION,
      streamId: readId(record.streamId, "message.streamId"),
      subscriptionId: readId(
        record.subscriptionId,
        "message.subscriptionId",
      ),
    };
  }
  if (base.kind === "event") {
    const record = readRecord(value, "message", [
      "kind",
      "protocolVersion",
      "streamId",
      "event",
    ]);
    return {
      kind: "event",
      protocolVersion: STREAM_PROTOCOL_VERSION,
      streamId: readId(record.streamId, "message.streamId"),
      event: validateBranchyStreamEvent(record.event),
    };
  }
  fail("message.kind", "must be opened or event");
}

type PayloadValidator<T> = (value: unknown) => T;

/**
 * Exhaustive, exact-channel validator registry for main-process registration.
 *
 * This is an allowlist, not a renderer-exposed generic dispatch mechanism.
 * Adding an IPC channel to the request contract cannot compile until it has a
 * corresponding validator here.
 */
export const IPC_PAYLOAD_VALIDATORS = {
  [IPC_CHANNELS.bootstrap]: validateBootstrapConversationInput,
  [IPC_CHANNELS.listConversations]: validateListConversationsInput,
  [IPC_CHANNELS.createConversation]: validateCreateConversationInput,
  [IPC_CHANNELS.loadConversation]: validateLoadConversationInput,
  [IPC_CHANNELS.renameConversation]: validateRenameConversationInput,
  [IPC_CHANNELS.deleteConversation]: validateConversationIdentityInput,
  [IPC_CHANNELS.archiveConversation]: validateConversationIdentityInput,
  [IPC_CHANNELS.unarchiveConversation]: validateConversationIdentityInput,
  [IPC_CHANNELS.updateConversationSettings]:
    validateUpdateConversationSettingsInput,
  [IPC_CHANNELS.updateConversationCanvas]:
    validateUpdateConversationCanvasInput,
  [IPC_CHANNELS.openCanvasBranchCard]: validateBranchIdentityInput,
  [IPC_CHANNELS.loadCanvasBranchCard]: validateBranchIdentityInput,
  [IPC_CHANNELS.renameBranch]: validateRenameBranchInput,
  [IPC_CHANNELS.deleteBranch]: validateBranchIdentityInput,
  [IPC_CHANNELS.saveBranchNote]: validateSaveBranchNoteInput,
  [IPC_CHANNELS.updateBranchNote]: validateUpdateBranchNoteInput,
  [IPC_CHANNELS.saveComposerDraft]: validateSaveComposerDraftInput,
  [IPC_CHANNELS.sendMessage]: validateSendMessageInput,
  [IPC_CHANNELS.cancelMessage]: validateCancelMessageInput,
  [IPC_CHANNELS.getAttachmentConstraints]: validateEmptyPayload,
  [IPC_CHANNELS.createAttachment]: validateCreateAttachmentInput,
  [IPC_CHANNELS.removeAttachment]: validateRemoveAttachmentInput,
  [IPC_CHANNELS.requestMicrophonePermission]: validateEmptyPayload,
  [IPC_CHANNELS.transcribeAudio]: validateTranscribeAudioInput,
  [IPC_CHANNELS.getGeneratedImageUrl]:
    validateGeneratedImageIdentityInput,
  [IPC_CHANNELS.saveGeneratedImage]: validateSaveGeneratedImageInput,
  [IPC_CHANNELS.retryGeneratedImage]: validateRetryGeneratedImageInput,
  [IPC_CHANNELS.getAccountState]: validateEmptyPayload,
  [IPC_CHANNELS.startChatGptLogin]: validateEmptyPayload,
  [IPC_CHANNELS.cancelChatGptLogin]: validateCancelChatGptLoginInput,
  [IPC_CHANNELS.logoutChatGpt]: validateEmptyPayload,
  [IPC_CHANNELS.exportArchive]: validateExportArchiveInput,
  [IPC_CHANNELS.importArchive]: validateImportArchiveInput,
  [IPC_CHANNELS.openExternal]: validateOpenExternalInput,
  [IPC_CHANNELS.streamOpen]: validateStreamOpenInput,
  [IPC_CHANNELS.streamClose]: validateStreamCloseInput,
} satisfies {
  [Channel in keyof DesktopCommandRequestMap]: PayloadValidator<
    DesktopCommandRequestMap[Channel]
  >;
};
