import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 43991;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
export const MAX_RECOVERY_HISTORY_CHARACTERS = 64 * 1024;
export const MAX_ADDITIONAL_CONTEXT_CHARACTERS = 48 * 1024;
export const MAX_ADDITIONAL_CONTEXT_ENTRIES = 16;

export class CodexProtocolError extends Error {
  constructor(message, code = null, data = null) {
    super(message);
    this.name = "CodexProtocolError";
    this.code = code;
    this.data = data;
  }
}

export function isMissingCodexContextError(error) {
  if (!(error instanceof Error)) return false;
  return (
    /(?:thread|turn)(?: id)?[^\n]*(?:not found|does not exist)/i.test(error.message) ||
    /unknown (?:thread|turn)(?: id)?/i.test(error.message) ||
    /(?:not found|failed to find).*(?:thread|turn)/i.test(error.message) ||
    /(?:no|missing) rollout/i.test(error.message) ||
    /rollout.*not found/i.test(error.message)
  );
}

export function isLoopback(address) {
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1"
  );
}

function writeJson(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error("Request body is too large");
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

export function toHistoryItems(
  messages,
  maxCharacters = MAX_RECOVERY_HISTORY_CHARACTERS,
) {
  if (!Array.isArray(messages) || maxCharacters <= 0) return [];
  const normalized = messages.flatMap((message) => {
    const content = typeof message?.content === "string" ? message.content.trim() : "";
    if (!content || (message?.role !== "user" && message?.role !== "assistant")) {
      return [];
    }
    return [
      {
        type: "message",
        role: message.role,
        content: [
          message.role === "assistant"
            ? { type: "output_text", text: content }
            : { type: "input_text", text: content },
        ],
      },
    ];
  });

  const bounded = [];
  let remaining = maxCharacters;
  for (let index = normalized.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const item = normalized[index];
    const content = item.content[0];
    const text = content.text;
    if (text.length <= remaining) {
      bounded.unshift(item);
      remaining -= text.length;
      continue;
    }
    if (bounded.length === 0) {
      const omission = "[Earlier content omitted during context recovery]\n";
      const prefix = remaining > omission.length ? omission : "";
      const tailLength = Math.max(0, remaining - prefix.length);
      bounded.unshift({
        ...item,
        content: [{ ...content, text: `${prefix}${text.slice(-tailLength)}` }],
      });
    }
    break;
  }
  return bounded;
}

export function normalizeAdditionalContext(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = {};
  let remaining = MAX_ADDITIONAL_CONTEXT_CHARACTERS;
  for (const [rawKey, entry] of Object.entries(value)) {
    if (Object.keys(result).length >= MAX_ADDITIONAL_CONTEXT_ENTRIES || remaining <= 0) {
      break;
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const key = rawKey.trim().slice(0, 160);
    const rawText = typeof entry.value === "string" ? entry.value.trim() : "";
    if (!key || !rawText) continue;
    const text = rawText.slice(0, remaining);
    result[key] = {
      value: text,
      kind: entry.kind === "application" ? "application" : "untrusted",
    };
    remaining -= text.length;
  }
  return Object.keys(result).length > 0 ? result : null;
}

export class CodexAppServerClient {
  constructor({ command = "codex", args = ["app-server", "--listen", "stdio://"] } = {}) {
    this.command = command;
    this.args = args;
    this.child = null;
    this.buffer = "";
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.ready = null;
    this.accountReady = null;
    this.workspaceReady = null;
    this.activeThreadIds = new Set();
  }

  start() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      const child = spawn(this.command, this.args, {
        stdio: ["pipe", "pipe", "inherit"],
        env: process.env,
      });
      this.child = child;
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => this.onData(chunk));
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        const error = new Error(
          `Codex app-server exited (${signal ?? code ?? "unknown"})`,
        );
        for (const pending of this.pending.values()) pending.reject(error);
        this.pending.clear();
        this.ready = null;
        this.accountReady = null;
        this.activeThreadIds.clear();
      });
      this.request("initialize", {
        clientInfo: {
          name: "branch-chat",
          title: "Branch Chat",
          version: "1.0.0",
        },
        capabilities: null,
      })
        .then(() => {
          this.notify("initialized", {});
          resolve();
        })
        .catch(reject);
    });
    return this.ready;
  }

  onData(chunk) {
    this.buffer += chunk;
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) return;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch (error) {
        console.error("[codex-bridge] invalid app-server JSON", error);
        continue;
      }
      if (message.id !== undefined && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) {
          pending.reject(
            new CodexProtocolError(
              message.error.message ?? "Codex request failed",
              message.error.code ?? null,
              message.error.data ?? null,
            ),
          );
        } else {
          pending.resolve(message.result);
        }
        continue;
      }
      if (typeof message.method === "string") {
        for (const listener of this.listeners) listener(message);
      }
    }
  }

  request(method, params) {
    if (!this.child?.stdin.writable) {
      return Promise.reject(new Error("Codex app-server is not running"));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(`${JSON.stringify({ method, id, params })}\n`);
    });
  }

  notify(method, params) {
    if (!this.child?.stdin.writable) return;
    this.child.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async account() {
    await this.start();
    return this.request("account/read", { refreshToken: false });
  }

  async ensureChatGptAccount() {
    if (!this.accountReady) {
      this.accountReady = this.account().then((account) => {
        if (account?.account?.type !== "chatgpt") {
          throw new Error("Sign in to Codex with ChatGPT before sending messages");
        }
        return account;
      }).catch((error) => {
        this.accountReady = null;
        throw error;
      });
    }
    return this.accountReady;
  }

  async workspace() {
    if (!this.workspaceReady) {
      const dataDirectory =
        process.env.BRANCH_CHAT_DATA_DIR ??
        join(homedir(), "Library", "Application Support", "Branch Chat");
      const chatWorkspace = join(dataDirectory, "chat-workspace");
      this.workspaceReady = mkdir(chatWorkspace, { recursive: true })
        .then(() => chatWorkspace)
        .catch((error) => {
          this.workspaceReady = null;
          throw error;
        });
    }
    return this.workspaceReady;
  }

  async models() {
    await this.start();
    return this.request("model/list", { limit: 100, includeHidden: false });
  }

  async deleteThreads(threadIds) {
    await this.start();
    const normalized = Array.from(
      new Set(
        (Array.isArray(threadIds) ? threadIds : [])
          .filter((threadId) => typeof threadId === "string")
          .map((threadId) => threadId.trim())
          .filter(Boolean),
      ),
    ).slice(0, 100);
    const deleted = [];
    const failed = [];
    for (const threadId of normalized) {
      if (this.activeThreadIds.has(threadId)) {
        failed.push({ threadId, message: "thread has an active turn" });
        continue;
      }
      try {
        await this.request("thread/delete", { threadId });
        deleted.push(threadId);
      } catch (error) {
        if (isMissingCodexContextError(error)) {
          deleted.push(threadId);
          continue;
        }
        failed.push({
          threadId,
          message: error instanceof Error ? error.message : "delete failed",
        });
      }
    }
    return { deleted, failed };
  }

  threadConfiguration(input, chatWorkspace) {
    const webSearch = input.webSearch !== false;
    const developerInstructions = [
      typeof input.developerInstructions === "string"
        ? input.developerInstructions
        : "You are Connexus, a helpful general chat assistant.",
      "Do not use shell commands, filesystem tools, code execution, subagents, or project automation.",
      webSearch
        ? "Live web search is available and should be used whenever current or externally verifiable information would improve the answer."
        : "Web search is disabled for this turn.",
    ].join("\n");

    return {
      model: typeof input.model === "string" ? input.model : "gpt-5.6-sol",
      modelProvider: "openai",
      allowProviderModelFallback: false,
      serviceTier: input.serviceTier === "priority" ? "priority" : null,
      cwd: chatWorkspace,
      approvalPolicy: "never",
      sandbox: "read-only",
      baseInstructions:
        typeof input.baseInstructions === "string" ? input.baseInstructions : null,
      developerInstructions,
      config: { web_search: webSearch ? "live" : "disabled" },
    };
  }

  async startThread(input, configuration) {
    const started = await this.request("thread/start", {
      ...configuration,
      ephemeral: false,
      historyMode: "paginated",
      threadSource: "branch-chat",
    });
    const threadId = started?.thread?.id;
    if (typeof threadId !== "string" || !threadId) {
      throw new Error("Codex did not return a thread identifier");
    }
    const history = toHistoryItems(input.messages);
    const availableHistoryCharacters = Array.isArray(input.messages)
      ? input.messages.reduce(
          (total, message) =>
            total +
            (typeof message?.content === "string"
              ? message.content.trim().length
              : 0),
          0,
        )
      : 0;
    const injectedHistoryCharacters = history.reduce(
      (total, item) => total + (item.content?.[0]?.text?.length ?? 0),
      0,
    );
    if (history.length > 0) {
      await this.request("thread/inject_items", { threadId, items: history });
    }
    return {
      threadId,
      contextMode: "start",
      recovered: false,
      historyTruncated: injectedHistoryCharacters < availableHistoryCharacters,
    };
  }

  async prepareThread(input) {
    await this.ensureChatGptAccount();
    const chatWorkspace = await this.workspace();
    const configuration = this.threadConfiguration(input, chatWorkspace);
    const {
      allowProviderModelFallback: _allowProviderModelFallback,
      ...resumeConfiguration
    } = configuration;
    const {
      baseInstructions: _baseInstructions,
      developerInstructions: _developerInstructions,
      ...forkConfiguration
    } = resumeConfiguration;
    const forkThreadId = input.forkFrom?.threadId;
    const forkTurnId = input.forkFrom?.turnId;

    if (
      typeof forkThreadId === "string" &&
      forkThreadId &&
      typeof forkTurnId === "string" &&
      forkTurnId
    ) {
      try {
        const forked = await this.request("thread/fork", {
          threadId: forkThreadId,
          lastTurnId: forkTurnId,
          ...forkConfiguration,
          ephemeral: false,
          threadSource: "branch-chat",
          excludeTurns: true,
        });
        const threadId = forked?.thread?.id;
        if (typeof threadId !== "string" || !threadId) {
          throw new Error("Codex did not return a forked thread identifier");
        }
        return { threadId, contextMode: "fork", recovered: false };
      } catch (error) {
        if (!isMissingCodexContextError(error)) throw error;
        console.warn("[codex-bridge] native fork unavailable; rebuilding bounded context", {
          error: error instanceof Error ? error.message : "unknown",
        });
        const recovered = await this.startThread(input, configuration);
        return { ...recovered, contextMode: "recovery", recovered: true };
      }
    }

    if (typeof input.threadId === "string" && input.threadId) {
      try {
        const resumed = await this.request("thread/resume", {
          threadId: input.threadId,
          ...resumeConfiguration,
          excludeTurns: true,
        });
        const threadId = resumed?.thread?.id;
        if (typeof threadId !== "string" || !threadId) {
          throw new Error("Codex did not return a resumed thread identifier");
        }
        return { threadId, contextMode: "resume", recovered: false };
      } catch (error) {
        if (!isMissingCodexContextError(error)) throw error;
        console.warn("[codex-bridge] thread resume unavailable; rebuilding bounded context", {
          error: error instanceof Error ? error.message : "unknown",
        });
        const recovered = await this.startThread(input, configuration);
        return { ...recovered, contextMode: "recovery", recovered: true };
      }
    }

    return this.startThread(input, configuration);
  }

  async streamTurn(input, response) {
    await this.start();
    const model = typeof input.model === "string" ? input.model : "gpt-5.6-sol";
    const effort = typeof input.effort === "string" ? input.effort : "low";
    const serviceTier = input.serviceTier === "priority" ? "priority" : null;
    const webSearch = input.webSearch !== false;
    const prepared = await this.prepareThread(input);
    const { threadId } = prepared;
    if (this.activeThreadIds.has(threadId)) {
      throw new Error("A Codex turn is already active for this branch");
    }
    this.activeThreadIds.add(threadId);

    response.writeHead(200, {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
    });
    const emit = (event) => response.write(`${JSON.stringify(event)}\n`);
    let content = "";
    let reasoningSummary = "";
    let tokenUsage = null;
    let turnId = null;
    let completed = false;
    let released = false;
    let unsubscribe = () => {};
    const release = () => {
      if (released) return;
      released = true;
      unsubscribe();
      this.activeThreadIds.delete(threadId);
    };

    emit({
      type: "context",
      threadId,
      contextMode: prepared.contextMode,
      recovered: prepared.recovered,
      historyTruncated: prepared.historyTruncated ?? false,
    });

    unsubscribe = this.subscribe((message) => {
      const params = message.params ?? {};
      if (params.threadId !== threadId) return;
      if (message.method === "turn/started") {
        const startedTurnId = params.turn?.id ?? null;
        if (turnId && startedTurnId && startedTurnId !== turnId) return;
        turnId = startedTurnId;
        emit({
          type: "start",
          threadId,
          turnId,
          contextMode: prepared.contextMode,
          recovered: prepared.recovered,
        });
        return;
      }
      const notificationTurnId = params.turnId ?? params.turn?.id ?? null;
      if (turnId && notificationTurnId && notificationTurnId !== turnId) return;
      if (message.method === "item/agentMessage/delta") {
        const delta = typeof params.delta === "string" ? params.delta : "";
        content += delta;
        emit({ type: "delta", delta });
        return;
      }
      if (message.method === "item/reasoning/summaryTextDelta") {
        const delta = typeof params.delta === "string" ? params.delta : "";
        reasoningSummary += delta;
        emit({ type: "reasoning_summary", delta, content: reasoningSummary });
        return;
      }
      if (message.method === "thread/tokenUsage/updated") {
        tokenUsage = params.tokenUsage?.last ?? tokenUsage;
        return;
      }
      if (message.method === "item/started" && params.item?.type === "webSearch") {
        emit({ type: "tool_progress", tool: "web_search", callId: params.item.id, status: "running", query: params.item.query ?? "" });
        return;
      }
      if (message.method === "item/completed" && params.item?.type === "webSearch") {
        emit({ type: "tool_progress", tool: "web_search", callId: params.item.id, status: "succeeded", query: params.item.query ?? "" });
        return;
      }
      if (message.method === "turn/completed") {
        completed = true;
        const turn = params.turn ?? {};
        const finalMessages = Array.isArray(turn.items)
          ? turn.items.filter((item) => item?.type === "agentMessage" && typeof item.text === "string")
          : [];
        const finalContent = finalMessages.at(-1)?.text?.trim() || content.trim();
        emit({
          type: turn.status === "completed" ? "complete" : "error",
          content: finalContent,
          reasoningSummary: reasoningSummary || null,
          promptTokens: tokenUsage?.inputTokens ?? 0,
          completionTokens: tokenUsage?.outputTokens ?? 0,
          message: turn.error?.message ?? null,
          threadId,
          turnId: turn.id ?? turnId,
          contextMode: prepared.contextMode,
          recovered: prepared.recovered,
          historyTruncated: prepared.historyTruncated ?? false,
        });
        release();
        response.end();
      }
    });

    response.once("close", () => {
      release();
      if (!completed && turnId) {
        void this.request("turn/interrupt", { threadId, turnId }).catch(() => {});
      }
    });

    try {
      await this.request("turn/start", {
        threadId,
        clientUserMessageId:
          typeof input.clientUserMessageId === "string"
            ? input.clientUserMessageId
            : null,
        input: [{ type: "text", text: String(input.content ?? ""), text_elements: [] }],
        model,
        serviceTier,
        effort,
        summary: "auto",
        approvalPolicy: "never",
        sandboxPolicy: { type: "readOnly", networkAccess: webSearch },
        additionalContext: normalizeAdditionalContext(input.additionalContext),
      });
    } catch (error) {
      release();
      emit({ type: "error", message: error instanceof Error ? error.message : "Unable to start Codex turn" });
      response.end();
    }
  }

  stop() {
    this.child?.kill("SIGTERM");
  }
}

export async function startCodexBridge({
  host = process.env.CODEX_BRIDGE_HOST ?? DEFAULT_HOST,
  port = Number(process.env.CODEX_BRIDGE_PORT ?? DEFAULT_PORT),
  client = new CodexAppServerClient(),
} = {}) {
  await client.start();
  const server = createServer(async (request, response) => {
    try {
      if (!isLoopback(request.socket.remoteAddress)) {
        writeJson(response, 403, { error: "Loopback access only" });
        return;
      }
      if (request.headers.origin || request.headers["sec-fetch-site"]) {
        writeJson(response, 403, { error: "Browser access is not allowed" });
        return;
      }
      const url = new URL(request.url ?? "/", `http://${host}:${port}`);
      if (request.method === "GET" && url.pathname === "/health") {
        const account = await client.account();
        writeJson(response, 200, { ok: true, ...account });
        return;
      }
      if (request.method === "GET" && url.pathname === "/models") {
        writeJson(response, 200, await client.models());
        return;
      }
      if (request.method === "POST" && url.pathname === "/turns") {
        const body = await readJson(request);
        await client.streamTurn(body, response);
        return;
      }
      if (request.method === "POST" && url.pathname === "/threads/delete") {
        const body = await readJson(request);
        writeJson(response, 200, await client.deleteThreads(body.threadIds));
        return;
      }
      writeJson(response, 404, { error: "Not found" });
    } catch (error) {
      if (!response.headersSent) {
        writeJson(response, 500, {
          error: error instanceof Error ? error.message : "Bridge request failed",
        });
      } else {
        response.end(
          `${JSON.stringify({ type: "error", message: error instanceof Error ? error.message : "Bridge request failed" })}\n`,
        );
      }
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  console.log(`[codex-bridge] ready on http://${host}:${port}`);
  return {
    server,
    client,
    close: async () => {
      client.stop();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  const bridge = await startCodexBridge();
  const shutdown = async () => {
    await bridge.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
