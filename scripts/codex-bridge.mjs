import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 43991;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

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

export function toHistoryItems(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.flatMap((message) => {
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
        if (message.error) pending.reject(new Error(message.error.message ?? "Codex request failed"));
        else pending.resolve(message.result);
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

  async models() {
    await this.start();
    return this.request("model/list", { limit: 100, includeHidden: false });
  }

  async streamTurn(input, response) {
    await this.start();
    const account = await this.account();
    if (account?.account?.type !== "chatgpt") {
      throw new Error("Sign in to Codex with ChatGPT before sending messages");
    }

    const model = typeof input.model === "string" ? input.model : "gpt-5.6-sol";
    const effort = typeof input.effort === "string" ? input.effort : "low";
    const serviceTier = input.serviceTier === "priority" ? "priority" : null;
    const webSearch = input.webSearch !== false;
    const dataDirectory =
      process.env.BRANCH_CHAT_DATA_DIR ??
      join(homedir(), "Library", "Application Support", "Branch Chat");
    const chatWorkspace = join(dataDirectory, "chat-workspace");
    await mkdir(chatWorkspace, { recursive: true });

    const started = await this.request("thread/start", {
      model,
      modelProvider: "openai",
      allowProviderModelFallback: false,
      serviceTier,
      cwd: chatWorkspace,
      approvalPolicy: "never",
      sandbox: "read-only",
      baseInstructions:
        typeof input.baseInstructions === "string" ? input.baseInstructions : null,
      developerInstructions: [
        typeof input.developerInstructions === "string"
          ? input.developerInstructions
          : "You are Connexus, a helpful general chat assistant.",
        "Do not use shell commands, filesystem tools, code execution, subagents, or project automation.",
        webSearch
          ? "Live web search is available and should be used whenever current or externally verifiable information would improve the answer."
          : "Web search is disabled for this turn.",
      ].join("\n"),
      ephemeral: true,
      config: {
        web_search: webSearch ? "live" : "disabled",
      },
    });
    const threadId = started.thread.id;
    const history = toHistoryItems(input.messages);
    if (history.length > 0) {
      await this.request("thread/inject_items", { threadId, items: history });
    }

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

    const unsubscribe = this.subscribe((message) => {
      const params = message.params ?? {};
      if (params.threadId !== threadId) return;
      if (message.method === "turn/started") {
        turnId = params.turn?.id ?? null;
        emit({ type: "start", threadId, turnId });
        return;
      }
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
        });
        unsubscribe();
        response.end();
      }
    });

    response.once("close", () => {
      unsubscribe();
      if (!completed && turnId) {
        void this.request("turn/interrupt", { threadId, turnId }).catch(() => {});
      }
    });

    try {
      await this.request("turn/start", {
        threadId,
        input: [{ type: "text", text: String(input.content ?? ""), text_elements: [] }],
        model,
        serviceTier,
        effort,
        summary: "auto",
        approvalPolicy: "never",
        sandboxPolicy: { type: "readOnly", networkAccess: webSearch },
      });
    } catch (error) {
      unsubscribe();
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
