import { spawn } from "node:child_process";
import type { EventEmitter } from "node:events";
import type { Readable, Writable } from "node:stream";

import type {
  CodexNotification,
  CodexNotificationListener,
  CodexRpcTransport,
  CodexTransportCloseListener,
} from "./types.ts";

export class CodexProtocolError extends Error {
  readonly code: number | string | null;
  readonly data: unknown;

  constructor(
    message: string,
    code: number | string | null = null,
    data: unknown = null,
  ) {
    super(message);
    this.name = "CodexProtocolError";
    this.code = code;
    this.data = data;
  }
}

export interface CodexChildProcess extends EventEmitter {
  stdin: Writable;
  stdout: Readable;
  stderr?: Readable | null;
  kill(signal?: NodeJS.Signals | number): boolean;
}

export interface CodexSpawnOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdio: ["pipe", "pipe", "pipe"];
  shell: false;
  windowsHide: true;
}

export type SpawnCodexProcess = (
  command: string,
  args: string[],
  options: CodexSpawnOptions,
) => CodexChildProcess;

export interface StdioCodexTransportOptions {
  command: string;
  args: string[];
  cwd: string;
  environment: NodeJS.ProcessEnv;
  spawnProcess?: SpawnCodexProcess;
  onDiagnostic?: (message: string) => void;
  requestTimeoutMilliseconds?: number;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
}

interface RpcResponse {
  id: number | string;
  result?: unknown;
  error?: {
    code?: number | string;
    message?: string;
    data?: unknown;
  };
}

function defaultSpawnProcess(
  command: string,
  args: string[],
  options: CodexSpawnOptions,
): CodexChildProcess {
  return spawn(command, args, options);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasRequestId(
  value: Record<string, unknown>,
): value is Record<string, unknown> & { id: number | string } {
  return typeof value.id === "number" || typeof value.id === "string";
}

export class StdioCodexTransport implements CodexRpcTransport {
  private readonly options: StdioCodexTransportOptions;
  private readonly spawnProcess: SpawnCodexProcess;
  private child: CodexChildProcess | null = null;
  private startPromise: Promise<void> | null = null;
  private buffer = "";
  private nextId = 1;
  private readonly pending = new Map<number | string, PendingRequest>();
  private readonly listeners = new Set<CodexNotificationListener>();
  private readonly lifecycleListeners =
    new Set<CodexTransportCloseListener>();
  private readonly requestTimeoutMilliseconds: number;
  private stopping = false;

  constructor(options: StdioCodexTransportOptions) {
    this.options = options;
    this.spawnProcess = options.spawnProcess ?? defaultSpawnProcess;
    this.requestTimeoutMilliseconds =
      options.requestTimeoutMilliseconds ?? 30_000;
    if (
      !Number.isSafeInteger(this.requestTimeoutMilliseconds) ||
      this.requestTimeoutMilliseconds <= 0
    ) {
      throw new TypeError(
        "requestTimeoutMilliseconds must be a positive integer",
      );
    }
  }

  start(): Promise<void> {
    if (this.startPromise) {
      return this.startPromise;
    }

    this.stopping = false;
    this.startPromise = new Promise<void>((resolve, reject) => {
      let settled = false;
      const child = this.spawnProcess(
        this.options.command,
        [...this.options.args],
        {
          cwd: this.options.cwd,
          env: { ...this.options.environment },
          stdio: ["pipe", "pipe", "pipe"],
          shell: false,
          windowsHide: true,
        },
      );
      this.child = child;
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string | Buffer) => {
        if (this.child !== child) {
          return;
        }
        this.handleData(String(chunk));
      });
      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk: string | Buffer) => {
        if (this.child !== child) {
          return;
        }
        const message = String(chunk).trim();
        if (message) {
          this.options.onDiagnostic?.(message);
        }
      });
      child.once("spawn", () => {
        settled = true;
        resolve();
      });
      child.once("error", (error: Error) => {
        this.handleClose(child, error);
        if (!settled) {
          settled = true;
          reject(error);
        }
      });
      child.once(
        "exit",
        (code: number | null, signal: NodeJS.Signals | null) => {
          const error = new Error(
            `Codex app-server exited (${signal ?? code ?? "unknown"})`,
          );
          this.handleClose(child, error);
          if (!settled && !this.stopping) {
            settled = true;
            reject(error);
          }
        },
      );
    }).catch((error: unknown) => {
      this.startPromise = null;
      throw error;
    });
    return this.startPromise;
  }

  async stop(): Promise<void> {
    this.stopping = true;
    const child = this.child;
    if (child) {
      this.handleClose(child, new Error("Codex app-server stopped"));
    }
    if (child) {
      child.kill("SIGTERM");
    }
  }

  request<TResult = unknown>(
    method: string,
    params?: unknown,
  ): Promise<TResult> {
    const child = this.child;
    if (!child?.stdin.writable) {
      return Promise.reject(
        new Error("Codex app-server transport is not running"),
      );
    }

    const id = this.nextId++;
    return new Promise<TResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!this.pending.has(id)) {
          return;
        }
        const error = new Error(
          `Codex app-server request ${method} timed out`,
        );
        const activeChild = this.child;
        if (activeChild) {
          this.handleClose(activeChild, error);
        }
        activeChild?.kill("SIGTERM");
      }, this.requestTimeoutMilliseconds);
      timeout.unref?.();
      this.pending.set(id, {
        resolve: (value) => resolve(value as TResult),
        reject,
        timeout,
      });
      child.stdin.write(
        `${JSON.stringify({
          method,
          id,
          params,
        })}\n`,
        (error) => {
          if (!error) {
            return;
          }
          const pending = this.pending.get(id);
          if (pending) {
            this.pending.delete(id);
            clearTimeout(pending.timeout);
            pending.reject(error);
          }
        },
      );
    });
  }

  async notify(method: string, params?: unknown): Promise<void> {
    const child = this.child;
    if (!child?.stdin.writable) {
      throw new Error("Codex app-server transport is not running");
    }
    await new Promise<void>((resolve, reject) => {
      child.stdin.write(
        `${JSON.stringify({ method, params })}\n`,
        (error) => (error ? reject(error) : resolve()),
      );
    });
  }

  subscribe(listener: CodexNotificationListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribeLifecycle(listener: CodexTransportCloseListener): () => void {
    this.lifecycleListeners.add(listener);
    return () => {
      this.lifecycleListeners.delete(listener);
    };
  }

  private handleData(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) {
        return;
      }
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) {
        continue;
      }

      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        this.options.onDiagnostic?.(
          "Codex app-server sent invalid JSON over stdio",
        );
        continue;
      }
      if (!isObject(message)) {
        continue;
      }

      if (typeof message.method === "string") {
        if (hasRequestId(message)) {
          this.rejectUnsupportedServerRequest(
            message.id,
            message.method,
          );
          continue;
        }
        const notification: CodexNotification = {
          method: message.method,
          params: isObject(message.params)
            ? message.params
            : undefined,
        };
        for (const listener of [...this.listeners]) {
          try {
            listener(notification);
          } catch {
            this.options.onDiagnostic?.(
              `Codex notification listener failed for ${message.method}`,
            );
          }
        }
        continue;
      }
      if (hasRequestId(message) && this.pending.has(message.id)) {
        this.handleResponse(message as unknown as RpcResponse);
      }
    }
  }

  private handleResponse(response: RpcResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) {
      return;
    }
    this.pending.delete(response.id);
    clearTimeout(pending.timeout);
    if (response.error) {
      pending.reject(
        new CodexProtocolError(
          response.error.message ?? "Codex request failed",
          response.error.code ?? null,
          response.error.data ?? null,
        ),
      );
      return;
    }
    pending.resolve(response.result);
  }

  private rejectUnsupportedServerRequest(
    id: number | string,
    method: string,
  ): void {
    const child = this.child;
    if (!child?.stdin.writable) {
      return;
    }
    child.stdin.write(
      `${JSON.stringify({
        id,
        error: {
          code: -32601,
          message: `Branchy Chat does not handle server request ${method}`,
        },
      })}\n`,
    );
  }

  private handleClose(child: CodexChildProcess, error: Error): void {
    if (this.child !== child) {
      return;
    }
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
    this.child = null;
    this.startPromise = null;
    this.buffer = "";
    for (const listener of [...this.lifecycleListeners]) {
      try {
        listener({ error, expected: this.stopping });
      } catch {
        this.options.onDiagnostic?.(
          "Codex transport lifecycle listener failed",
        );
      }
    }
  }
}
