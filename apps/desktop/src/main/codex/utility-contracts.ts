import { isAbsolute } from "node:path";

import type {
  CancelTurnResult,
} from "./client.ts";
import type {
  AdditionalContextEntry,
  CodexAccountState,
  CodexTurnEvent,
  DeleteThreadsResult,
  DeviceCodeLoginCompletion,
  DictationResult,
  StartCodexTurnInput,
} from "./types.ts";

const MAX_AUDIO_BYTES = 64 * 1024 * 1024;
const MAX_ID_CHARACTERS = 512;
const MAX_TEXT_CHARACTERS = 2 * 1024 * 1024;

export interface CodexUtilityInitializeInput {
  userDataPath: string;
  isPackaged: boolean;
  resourcesPath: string;
  transcriptionUserAgent: string;
  developmentExecutablePath?: string;
}

export interface CodexUtilityLoginChallenge {
  loginId: string;
  verificationUrl: string;
  userCode: string;
}

export interface CodexUtilityTurnSession {
  streamId: string;
  threadId: string;
}

export interface CodexUtilityRequestMap {
  initialize: CodexUtilityInitializeInput;
  readAccount: Record<string, never>;
  startDeviceCodeLogin: Record<string, never>;
  cancelDeviceCodeLogin: { loginId: string };
  logoutChatGpt: Record<string, never>;
  startTurn: StartCodexTurnInput;
  cancelTurn: { streamId: string };
  deleteThreads: { threadIds: string[] };
  transcribeWav: { bytes: Uint8Array };
  stop: Record<string, never>;
}

export interface CodexUtilityResponseMap {
  initialize: { ready: true };
  readAccount: CodexAccountState;
  startDeviceCodeLogin: CodexUtilityLoginChallenge;
  cancelDeviceCodeLogin: boolean;
  logoutChatGpt: CodexAccountState;
  startTurn: CodexUtilityTurnSession;
  cancelTurn: CancelTurnResult;
  deleteThreads: DeleteThreadsResult;
  transcribeWav: DictationResult;
  stop: { stopped: true };
}

export type CodexUtilityMethod = keyof CodexUtilityRequestMap;

export type CodexUtilityRequest = {
  [Method in CodexUtilityMethod]: {
    kind: "request";
    id: string;
    method: Method;
    input: CodexUtilityRequestMap[Method];
  };
}[CodexUtilityMethod];

export type CodexUtilityWorkerMessage =
  | {
      kind: "response";
      id: string;
      ok: true;
      result: unknown;
    }
  | {
      kind: "response";
      id: string;
      ok: false;
      error: {
        name: string;
        message: string;
      };
    }
  | {
      kind: "turn-event";
      event: CodexTurnEvent;
    }
  | {
      kind: "login-completion";
      completion: DeviceCodeLoginCompletion;
    }
  | {
      kind: "diagnostic";
      message: string;
    };

export function recoverCodexUtilityRequestId(
  value: unknown,
): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const id = (value as Record<string, unknown>).id;
  return typeof id === "string" &&
    id.length > 0 &&
    id.length <= MAX_ID_CHARACTERS
    ? id
    : null;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function onlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const allowed = new Set(keys);
  const unexpected = Object.keys(value).find((key) => !allowed.has(key));
  if (unexpected) {
    throw new TypeError(`${label} contains unexpected field ${unexpected}`);
  }
}

function string(
  value: unknown,
  label: string,
  {
    allowEmpty = false,
    maxCharacters = MAX_TEXT_CHARACTERS,
  }: {
    allowEmpty?: boolean;
    maxCharacters?: number;
  } = {},
): string {
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.length === 0) ||
    value.length > maxCharacters
  ) {
    throw new TypeError(`${label} must be a valid string`);
  }
  return value;
}

function optionalString(
  value: unknown,
  label: string,
): string | undefined {
  return value === undefined ? undefined : string(value, label);
}

function nullableString(
  value: unknown,
  label: string,
): string | null {
  return value === null ? null : string(value, label);
}

function identifier(value: unknown, label: string): string {
  return string(value, label, { maxCharacters: MAX_ID_CHARACTERS });
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean`);
  }
  return value;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
  return value;
}

function emptyInput(value: unknown, label: string): Record<string, never> {
  const input = record(value, label);
  onlyKeys(input, [], label);
  return {};
}

function absolutePath(value: unknown, label: string): string {
  const path = string(value, label);
  if (!isAbsolute(path)) {
    throw new TypeError(`${label} must be absolute`);
  }
  return path;
}

function userAgent(value: unknown): string {
  const result = string(value, "transcriptionUserAgent", {
    maxCharacters: 1024,
  });
  if (/[\u0000-\u001f\u007f]/u.test(result)) {
    throw new TypeError(
      "transcriptionUserAgent must not contain control characters",
    );
  }
  return result;
}

function initializeInput(value: unknown): CodexUtilityInitializeInput {
  const input = record(value, "initialize input");
  onlyKeys(
    input,
    [
      "userDataPath",
      "isPackaged",
      "resourcesPath",
      "transcriptionUserAgent",
      "developmentExecutablePath",
    ],
    "initialize input",
  );
  return {
    userDataPath: absolutePath(input.userDataPath, "userDataPath"),
    isPackaged: boolean(input.isPackaged, "isPackaged"),
    resourcesPath: absolutePath(input.resourcesPath, "resourcesPath"),
    transcriptionUserAgent: userAgent(input.transcriptionUserAgent),
    ...(input.developmentExecutablePath === undefined
      ? {}
      : {
          developmentExecutablePath: absolutePath(
            input.developmentExecutablePath,
            "developmentExecutablePath",
          ),
        }),
  };
}

function startTurnInput(value: unknown): StartCodexTurnInput {
  const input = record(value, "startTurn input");
  onlyKeys(
    input,
    [
      "streamId",
      "content",
      "clientUserMessageId",
      "threadId",
      "forkFrom",
      "messages",
      "localImagePaths",
      "additionalContext",
      "model",
      "effort",
      "serviceTier",
      "webSearch",
      "baseInstructions",
      "developerInstructions",
    ],
    "startTurn input",
  );

  const clientUserMessageId =
    input.clientUserMessageId === undefined
      ? undefined
      : nullableString(input.clientUserMessageId, "clientUserMessageId");
  const threadId =
    input.threadId === undefined
      ? undefined
      : nullableString(input.threadId, "threadId");
  const forkFrom =
    input.forkFrom === undefined || input.forkFrom === null
      ? input.forkFrom
      : (() => {
          const fork = record(input.forkFrom, "forkFrom");
          onlyKeys(fork, ["threadId", "turnId"], "forkFrom");
          return {
            threadId: identifier(fork.threadId, "forkFrom.threadId"),
            turnId: identifier(fork.turnId, "forkFrom.turnId"),
          };
        })();
  const messages =
    input.messages === undefined
      ? undefined
      : (() => {
          if (!Array.isArray(input.messages) || input.messages.length > 1_000) {
            throw new TypeError("messages must be a bounded array");
          }
          return input.messages.map((rawMessage, index) => {
            const message = record(rawMessage, `messages[${index}]`);
            onlyKeys(message, ["role", "content"], `messages[${index}]`);
            if (message.role !== "user" && message.role !== "assistant") {
              throw new TypeError(`messages[${index}].role is invalid`);
            }
            const role: "user" | "assistant" =
              message.role === "user" ? "user" : "assistant";
            return {
              role,
              content: string(
                message.content,
                `messages[${index}].content`,
                { allowEmpty: true },
              ),
            };
          });
        })();
  const localImagePaths =
    input.localImagePaths === undefined
      ? undefined
      : (() => {
          if (
            !Array.isArray(input.localImagePaths) ||
            input.localImagePaths.length > 8
          ) {
            throw new TypeError("localImagePaths must be a bounded array");
          }
          return input.localImagePaths.map((path, index) =>
            absolutePath(path, `localImagePaths[${index}]`),
          );
        })();
  const additionalContext =
    input.additionalContext === undefined || input.additionalContext === null
      ? input.additionalContext
      : (() => {
          const context = record(input.additionalContext, "additionalContext");
          if (Object.keys(context).length > 16) {
            throw new TypeError("additionalContext is too large");
          }
          const parsed: Record<string, AdditionalContextEntry> = {};
          for (const [key, rawEntry] of Object.entries(context)) {
            const entry = record(rawEntry, `additionalContext.${key}`);
            onlyKeys(
              entry,
              ["value", "kind"],
              `additionalContext.${key}`,
            );
            if (
              entry.kind !== undefined &&
              entry.kind !== "application" &&
              entry.kind !== "untrusted"
            ) {
              throw new TypeError(`additionalContext.${key}.kind is invalid`);
            }
            const parsedKey = string(key, "additionalContext key", {
              maxCharacters: MAX_ID_CHARACTERS,
            });
            const kind: AdditionalContextEntry["kind"] =
              entry.kind === "application"
                ? "application"
                : entry.kind === "untrusted"
                  ? "untrusted"
                  : undefined;
            parsed[parsedKey] = {
              value: string(
                entry.value,
                `additionalContext.${key}.value`,
                { allowEmpty: true },
              ),
              ...(kind === undefined ? {} : { kind }),
            };
          }
          return parsed;
        })();
  const serviceTier =
    input.serviceTier === undefined
      ? undefined
      : input.serviceTier === null || input.serviceTier === "priority"
        ? input.serviceTier
        : (() => {
            throw new TypeError("serviceTier is invalid");
          })();
  const baseInstructions =
    input.baseInstructions === undefined
      ? undefined
      : nullableString(input.baseInstructions, "baseInstructions");
  const developerInstructions =
    input.developerInstructions === undefined
      ? undefined
      : nullableString(input.developerInstructions, "developerInstructions");

  return {
    streamId: identifier(input.streamId, "streamId"),
    content: string(input.content, "content", { allowEmpty: true }),
    ...(clientUserMessageId === undefined ? {} : { clientUserMessageId }),
    ...(threadId === undefined ? {} : { threadId }),
    ...(forkFrom === undefined ? {} : { forkFrom }),
    ...(messages === undefined ? {} : { messages }),
    ...(localImagePaths === undefined ? {} : { localImagePaths }),
    ...(additionalContext === undefined ? {} : { additionalContext }),
    ...(input.model === undefined
      ? {}
      : { model: optionalString(input.model, "model") }),
    ...(input.effort === undefined
      ? {}
      : { effort: optionalString(input.effort, "effort") }),
    ...(serviceTier === undefined ? {} : { serviceTier }),
    ...(input.webSearch === undefined
      ? {}
      : { webSearch: boolean(input.webSearch, "webSearch") }),
    ...(baseInstructions === undefined ? {} : { baseInstructions }),
    ...(developerInstructions === undefined
      ? {}
      : { developerInstructions }),
  };
}

function idInput(
  value: unknown,
  field: "loginId" | "streamId",
): { loginId: string } | { streamId: string } {
  const input = record(value, `${field} input`);
  onlyKeys(input, [field], `${field} input`);
  return { [field]: identifier(input[field], field) } as
    | { loginId: string }
    | { streamId: string };
}

function deleteThreadsInput(value: unknown): { threadIds: string[] } {
  const input = record(value, "deleteThreads input");
  onlyKeys(input, ["threadIds"], "deleteThreads input");
  if (!Array.isArray(input.threadIds) || input.threadIds.length > 100) {
    throw new TypeError("threadIds must be a bounded array");
  }
  return {
    threadIds: input.threadIds.map((threadId, index) =>
      identifier(threadId, `threadIds[${index}]`),
    ),
  };
}

function transcribeInput(value: unknown): { bytes: Uint8Array } {
  const input = record(value, "transcribeWav input");
  onlyKeys(input, ["bytes"], "transcribeWav input");
  if (
    !(input.bytes instanceof Uint8Array) ||
    input.bytes.byteLength === 0 ||
    input.bytes.byteLength > MAX_AUDIO_BYTES
  ) {
    throw new TypeError("bytes must be a non-empty bounded Uint8Array");
  }
  return { bytes: input.bytes };
}

export function parseCodexUtilityRequest(
  value: unknown,
): CodexUtilityRequest {
  const request = record(value, "utility request");
  onlyKeys(request, ["kind", "id", "method", "input"], "utility request");
  if (request.kind !== "request") {
    throw new TypeError("utility request kind is invalid");
  }
  const id = identifier(request.id, "request id");
  switch (request.method) {
    case "initialize":
      return {
        kind: "request",
        id,
        method: request.method,
        input: initializeInput(request.input),
      };
    case "readAccount":
    case "startDeviceCodeLogin":
    case "logoutChatGpt":
    case "stop":
      return {
        kind: "request",
        id,
        method: request.method,
        input: emptyInput(request.input, `${request.method} input`),
      };
    case "cancelDeviceCodeLogin":
      return {
        kind: "request",
        id,
        method: request.method,
        input: idInput(request.input, "loginId") as { loginId: string },
      };
    case "startTurn":
      return {
        kind: "request",
        id,
        method: request.method,
        input: startTurnInput(request.input),
      };
    case "cancelTurn":
      return {
        kind: "request",
        id,
        method: request.method,
        input: idInput(request.input, "streamId") as { streamId: string },
      };
    case "deleteThreads":
      return {
        kind: "request",
        id,
        method: request.method,
        input: deleteThreadsInput(request.input),
      };
    case "transcribeWav":
      return {
        kind: "request",
        id,
        method: request.method,
        input: transcribeInput(request.input),
      };
    default:
      throw new TypeError("utility request method is invalid");
  }
}

function accountState(value: unknown): CodexAccountState {
  const state = record(value, "account state");
  if (state.status === "signed-out") {
    return {
      status: "signed-out",
      requiresOpenaiAuth: boolean(
        state.requiresOpenaiAuth,
        "requiresOpenaiAuth",
      ),
    };
  }
  if (state.status === "chatgpt") {
    return {
      status: "chatgpt",
      email:
        state.email === null ? null : string(state.email, "account email"),
      planType: string(state.planType, "planType"),
      requiresOpenaiAuth: boolean(
        state.requiresOpenaiAuth,
        "requiresOpenaiAuth",
      ),
    };
  }
  if (state.status === "unsupported") {
    return {
      status: "unsupported",
      accountType: string(state.accountType, "accountType"),
      requiresOpenaiAuth: boolean(
        state.requiresOpenaiAuth,
        "requiresOpenaiAuth",
      ),
    };
  }
  throw new TypeError("account state status is invalid");
}

function loginCompletion(value: unknown): DeviceCodeLoginCompletion {
  const completion = record(value, "login completion");
  return {
    loginId: identifier(completion.loginId, "loginId"),
    success: boolean(completion.success, "success"),
    cancelled: boolean(completion.cancelled, "cancelled"),
    error:
      completion.error === null
        ? null
        : string(completion.error, "login error"),
  };
}

function turnEvent(value: unknown): CodexTurnEvent {
  const event = record(value, "turn event");
  const type = string(event.type, "turn event type");
  const streamId = identifier(event.streamId, "streamId");
  const threadId =
    event.threadId === null ? null : identifier(event.threadId, "threadId");
  const turnId =
    event.turnId === undefined || event.turnId === null
      ? null
      : identifier(event.turnId, "turnId");
  const contextMode = event.contextMode;
  const validContextMode =
    contextMode === "start" ||
    contextMode === "resume" ||
    contextMode === "fork" ||
    contextMode === "recovery";

  switch (type) {
    case "context":
      if (!threadId || !validContextMode) {
        throw new TypeError("context event is invalid");
      }
      return {
        type,
        streamId,
        threadId,
        contextMode,
        recovered: boolean(event.recovered, "recovered"),
        historyTruncated: boolean(
          event.historyTruncated,
          "historyTruncated",
        ),
      };
    case "start":
      if (!threadId || !validContextMode) {
        throw new TypeError("start event is invalid");
      }
      return {
        type,
        streamId,
        threadId,
        turnId,
        contextMode,
        recovered: boolean(event.recovered, "recovered"),
      };
    case "delta":
      if (!threadId) {
        throw new TypeError("delta event is invalid");
      }
      return {
        type,
        streamId,
        threadId,
        turnId,
        delta: string(event.delta, "delta", { allowEmpty: true }),
      };
    case "reasoning_summary":
      if (!threadId) {
        throw new TypeError("reasoning event is invalid");
      }
      return {
        type,
        streamId,
        threadId,
        turnId,
        delta: string(event.delta, "reasoning delta", { allowEmpty: true }),
        content: string(event.content, "reasoning content", {
          allowEmpty: true,
        }),
      };
    case "tool_progress":
      if (
        !threadId ||
        (event.tool !== "web_search" &&
          event.tool !== "image_generation") ||
        (event.status !== "running" &&
          event.status !== "succeeded" &&
          event.status !== "failed")
      ) {
        throw new TypeError("tool progress event is invalid");
      }
      return {
        type,
        streamId,
        threadId,
        turnId,
        tool: event.tool,
        callId: identifier(event.callId, "callId"),
        status: event.status,
        ...(event.query === undefined
          ? {}
          : {
              query: string(event.query, "query", { allowEmpty: true }),
            }),
      };
    case "image_ready":
      if (!threadId) {
        throw new TypeError("image event is invalid");
      }
      return {
        type,
        streamId,
        threadId,
        turnId,
        imageId: identifier(event.imageId, "imageId"),
        savedPath: absolutePath(event.savedPath, "savedPath"),
        revisedPrompt:
          event.revisedPrompt === null
            ? null
            : string(event.revisedPrompt, "revisedPrompt", {
                allowEmpty: true,
              }),
      };
    case "complete":
      if (!threadId || !validContextMode) {
        throw new TypeError("complete event is invalid");
      }
      return {
        type,
        streamId,
        threadId,
        turnId,
        content: string(event.content, "content", { allowEmpty: true }),
        reasoningSummary:
          event.reasoningSummary === null
            ? null
            : string(event.reasoningSummary, "reasoningSummary", {
                allowEmpty: true,
              }),
        promptTokens: finiteNumber(event.promptTokens, "promptTokens"),
        completionTokens: finiteNumber(
          event.completionTokens,
          "completionTokens",
        ),
        contextMode,
        recovered: boolean(event.recovered, "recovered"),
        historyTruncated: boolean(
          event.historyTruncated,
          "historyTruncated",
        ),
      };
    case "cancelled":
      if (!threadId) {
        throw new TypeError("cancelled event is invalid");
      }
      return { type, streamId, threadId, turnId };
    case "error":
      return {
        type,
        streamId,
        threadId,
        turnId,
        message: string(event.message, "error message"),
      };
    default:
      throw new TypeError("turn event type is invalid");
  }
}

export function parseCodexUtilityWorkerMessage(
  value: unknown,
): CodexUtilityWorkerMessage {
  const message = record(value, "utility worker message");
  switch (message.kind) {
    case "response": {
      const id = identifier(message.id, "response id");
      if (message.ok === true) {
        onlyKeys(message, ["kind", "id", "ok", "result"], "utility response");
        return { kind: "response", id, ok: true, result: message.result };
      }
      if (message.ok === false) {
        onlyKeys(message, ["kind", "id", "ok", "error"], "utility response");
        const error = record(message.error, "utility response error");
        onlyKeys(error, ["name", "message"], "utility response error");
        return {
          kind: "response",
          id,
          ok: false,
          error: {
            name: string(error.name, "error name"),
            message: string(error.message, "error message"),
          },
        };
      }
      throw new TypeError("utility response ok is invalid");
    }
    case "turn-event":
      onlyKeys(message, ["kind", "event"], "turn event message");
      return { kind: "turn-event", event: turnEvent(message.event) };
    case "login-completion":
      onlyKeys(message, ["kind", "completion"], "login completion message");
      return {
        kind: "login-completion",
        completion: loginCompletion(message.completion),
      };
    case "diagnostic":
      onlyKeys(message, ["kind", "message"], "diagnostic message");
      return {
        kind: "diagnostic",
        message: string(message.message, "diagnostic", {
          maxCharacters: 16 * 1024,
        }),
      };
    default:
      throw new TypeError("utility worker message kind is invalid");
  }
}

export function parseCodexUtilityResponse<Method extends CodexUtilityMethod>(
  method: Method,
  value: unknown,
): CodexUtilityResponseMap[Method] {
  switch (method) {
    case "initialize": {
      const result = record(value, "initialize result");
      if (result.ready !== true) {
        throw new TypeError("initialize result is invalid");
      }
      return { ready: true } as CodexUtilityResponseMap[Method];
    }
    case "readAccount":
    case "logoutChatGpt":
      return accountState(value) as CodexUtilityResponseMap[Method];
    case "startDeviceCodeLogin": {
      const result = record(value, "login challenge");
      return {
        loginId: identifier(result.loginId, "loginId"),
        verificationUrl: string(result.verificationUrl, "verificationUrl"),
        userCode: string(result.userCode, "userCode"),
      } as CodexUtilityResponseMap[Method];
    }
    case "cancelDeviceCodeLogin":
      return boolean(value, "cancel login result") as CodexUtilityResponseMap[Method];
    case "startTurn": {
      const result = record(value, "start turn result");
      return {
        streamId: identifier(result.streamId, "streamId"),
        threadId: identifier(result.threadId, "threadId"),
      } as CodexUtilityResponseMap[Method];
    }
    case "cancelTurn": {
      const result = record(value, "cancel turn result");
      if (result.settled !== false) {
        throw new TypeError("cancel turn result is invalid");
      }
      return {
        interrupted: boolean(result.interrupted, "interrupted"),
        settled: false,
        ...(result.queued === true ? { queued: true } : {}),
      } as CodexUtilityResponseMap[Method];
    }
    case "deleteThreads": {
      const result = record(value, "delete threads result");
      if (!Array.isArray(result.deleted) || !Array.isArray(result.failed)) {
        throw new TypeError("delete threads result is invalid");
      }
      return {
        deleted: result.deleted.map((id, index) =>
          identifier(id, `deleted[${index}]`),
        ),
        failed: result.failed.map((rawFailure, index) => {
          const failure = record(rawFailure, `failed[${index}]`);
          return {
            threadId: identifier(
              failure.threadId,
              `failed[${index}].threadId`,
            ),
            message: string(failure.message, `failed[${index}].message`),
          };
        }),
      } as CodexUtilityResponseMap[Method];
    }
    case "transcribeWav": {
      const result = record(value, "dictation result");
      return {
        transcript: string(result.transcript, "transcript", {
          allowEmpty: true,
        }),
        durationSeconds: finiteNumber(
          result.durationSeconds,
          "durationSeconds",
        ),
      } as CodexUtilityResponseMap[Method];
    }
    case "stop": {
      const result = record(value, "stop result");
      if (result.stopped !== true) {
        throw new TypeError("stop result is invalid");
      }
      return { stopped: true } as CodexUtilityResponseMap[Method];
    }
  }
}

export function utilityError(error: unknown): {
  name: string;
  message: string;
} {
  return error instanceof Error
    ? {
        name: error.name || "Error",
        message: error.message || "Codex utility operation failed",
      }
    : {
        name: "Error",
        message: "Codex utility operation failed",
      };
}
