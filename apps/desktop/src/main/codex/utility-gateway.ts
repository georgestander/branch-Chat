import { randomUUID } from "node:crypto";

import type {
  BranchyCodexGateway,
} from "../application/service.ts";
import type {
  CancelTurnResult,
} from "./client.ts";
import {
  parseCodexUtilityRequest,
  parseCodexUtilityResponse,
  parseCodexUtilityWorkerMessage,
  type CodexUtilityInitializeInput,
  type CodexUtilityMethod,
  type CodexUtilityRequestMap,
  type CodexUtilityResponseMap,
} from "./utility-contracts.ts";
import type {
  CodexAccountState,
  CodexTerminalTurnEvent,
  CodexTurnEvent,
  CodexTurnSession,
  DeleteThreadsResult,
  DeviceCodeLoginCompletion,
  DeviceCodeLoginSession,
  DictationResult,
  StartCodexTurnInput,
} from "./types.ts";

const DEFAULT_REQUEST_TIMEOUT_MILLISECONDS = 60_000;
const DEFAULT_SPAWN_TIMEOUT_MILLISECONDS = 15_000;

export interface CodexUtilityProcess {
  on(event: string, listener: (...args: unknown[]) => void): this;
  once(event: string, listener: (...args: unknown[]) => void): this;
  off(event: string, listener: (...args: unknown[]) => void): this;
  postMessage(message: unknown): void;
  kill(): boolean;
}

interface PendingRequest {
  method: CodexUtilityMethod;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
}

interface ActiveLogin {
  resolve(completion: DeviceCodeLoginCompletion): void;
}

interface ActiveTurn {
  threadId: string | null;
  onEvent(event: CodexTurnEvent): void;
  resolve(event: CodexTerminalTurnEvent): void;
}

export interface CreateCodexUtilityGatewayOptions {
  initialize: CodexUtilityInitializeInput;
  spawnProcess(): CodexUtilityProcess;
  onDiagnostic?(message: string): void;
  requestTimeoutMilliseconds?: number;
  spawnTimeoutMilliseconds?: number;
}

function terminalTurnEvent(
  event: CodexTurnEvent,
): event is CodexTerminalTurnEvent {
  return (
    event.type === "complete" ||
    event.type === "cancelled" ||
    event.type === "error"
  );
}

function asError(value: unknown, fallback: string): Error {
  return value instanceof Error
    ? value
    : new Error(typeof value === "string" && value ? value : fallback);
}

async function waitForSpawn(
  child: CodexUtilityProcess,
  timeoutMilliseconds: number,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Codex utility process did not start in time"));
    }, timeoutMilliseconds);
    timeout.unref?.();

    const onSpawn = () => {
      cleanup();
      resolve();
    };
    const onExit = (code: unknown) => {
      cleanup();
      reject(
        new Error(
          `Codex utility process exited before startup (${String(code)})`,
        ),
      );
    };
    const onError = (...detail: unknown[]) => {
      cleanup();
      reject(
        asError(
          detail.find((item) => item instanceof Error) ?? detail[0],
          "Codex utility process failed to start",
        ),
      );
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.off("spawn", onSpawn);
      child.off("exit", onExit);
      child.off("error", onError);
    };

    child.once("spawn", onSpawn);
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

export class CodexUtilityGateway implements BranchyCodexGateway {
  private readonly child: CodexUtilityProcess;
  private readonly onDiagnostic?: (message: string) => void;
  private readonly requestTimeoutMilliseconds: number;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly activeLogins = new Map<string, ActiveLogin>();
  private readonly bufferedLoginCompletions =
    new Map<string, DeviceCodeLoginCompletion>();
  private readonly activeTurns = new Map<string, ActiveTurn>();
  private failed: Error | null = null;
  private stopping = false;
  private stopped = false;

  constructor(
    child: CodexUtilityProcess,
    {
      onDiagnostic,
      requestTimeoutMilliseconds = DEFAULT_REQUEST_TIMEOUT_MILLISECONDS,
    }: Pick<
      CreateCodexUtilityGatewayOptions,
      "onDiagnostic" | "requestTimeoutMilliseconds"
    > = {},
  ) {
    if (
      !Number.isSafeInteger(requestTimeoutMilliseconds) ||
      requestTimeoutMilliseconds <= 0
    ) {
      throw new TypeError(
        "requestTimeoutMilliseconds must be a positive integer",
      );
    }
    this.child = child;
    this.onDiagnostic = onDiagnostic;
    this.requestTimeoutMilliseconds = requestTimeoutMilliseconds;
    child.on("message", this.handleMessage);
    child.on("exit", this.handleExit);
    child.on("error", this.handleError);
  }

  async initialize(input: CodexUtilityInitializeInput): Promise<void> {
    await this.request("initialize", input);
  }

  readAccount(): Promise<CodexAccountState> {
    return this.request("readAccount", {});
  }

  async startDeviceCodeLogin(): Promise<DeviceCodeLoginSession> {
    const challenge = await this.request("startDeviceCodeLogin", {});
    let resolveCompletion:
      | ((completion: DeviceCodeLoginCompletion) => void)
      | undefined;
    const completion = new Promise<DeviceCodeLoginCompletion>((resolve) => {
      resolveCompletion = resolve;
    });
    this.activeLogins.set(challenge.loginId, {
      resolve: (value) => resolveCompletion?.(value),
    });
    const buffered = this.bufferedLoginCompletions.get(challenge.loginId);
    if (buffered) {
      this.bufferedLoginCompletions.delete(challenge.loginId);
      this.finishLogin(buffered);
    }
    return {
      ...challenge,
      completion,
      cancel: () => this.cancelDeviceCodeLogin(challenge.loginId),
    };
  }

  cancelDeviceCodeLogin(loginId: string): Promise<boolean> {
    return this.request("cancelDeviceCodeLogin", { loginId });
  }

  logoutChatGpt(): Promise<CodexAccountState> {
    return this.request("logoutChatGpt", {});
  }

  async startTurn(
    input: StartCodexTurnInput,
    onEvent: (event: CodexTurnEvent) => void,
  ): Promise<CodexTurnSession> {
    if (this.activeTurns.has(input.streamId)) {
      throw new Error("That Branchy Chat stream is already active");
    }
    let resolveCompletion:
      | ((event: CodexTerminalTurnEvent) => void)
      | undefined;
    const completion = new Promise<CodexTerminalTurnEvent>((resolve) => {
      resolveCompletion = resolve;
    });
    const active: ActiveTurn = {
      threadId: null,
      onEvent,
      resolve: (event) => resolveCompletion?.(event),
    };
    this.activeTurns.set(input.streamId, active);

    try {
      const started = await this.request("startTurn", input);
      if (started.streamId !== input.streamId) {
        throw new Error("Codex utility returned the wrong stream");
      }
      active.threadId = started.threadId;
      return {
        streamId: started.streamId,
        threadId: started.threadId,
        completion,
        cancel: async () =>
          (await this.cancelTurn(started.streamId)).interrupted,
      };
    } catch (error) {
      if (this.activeTurns.get(input.streamId) === active) {
        const event: CodexTerminalTurnEvent = {
          type: "error",
          streamId: input.streamId,
          threadId: active.threadId,
          turnId: null,
          message:
            error instanceof Error
              ? error.message
              : "Codex utility could not start the turn",
        };
        this.finishTurn(active, event);
        this.activeTurns.delete(input.streamId);
      }
      throw error;
    }
  }

  cancelTurn(streamId: string): Promise<CancelTurnResult> {
    return this.request("cancelTurn", { streamId });
  }

  deleteThreads(threadIds: string[]): Promise<DeleteThreadsResult> {
    return this.request("deleteThreads", { threadIds });
  }

  transcribeWav(input: Uint8Array): Promise<DictationResult> {
    return this.request("transcribeWav", { bytes: input });
  }

  async stop(): Promise<void> {
    if (this.stopped) {
      return;
    }
    this.stopping = true;
    try {
      if (!this.failed) {
        await this.request("stop", {});
      }
    } catch (error) {
      if (!this.failed) {
        this.onDiagnostic?.(
          error instanceof Error
            ? error.message
            : "Codex utility did not stop cleanly",
        );
      }
    } finally {
      this.stopped = true;
      this.child.kill();
      this.detach();
      this.settleOutstanding(
        new Error("Branchy Codex utility process stopped"),
      );
    }
  }

  private request<Method extends CodexUtilityMethod>(
    method: Method,
    input: CodexUtilityRequestMap[Method],
  ): Promise<CodexUtilityResponseMap[Method]> {
    if (this.failed) {
      return Promise.reject(this.failed);
    }
    if (this.stopped || (this.stopping && method !== "stop")) {
      return Promise.reject(
        new Error("Branchy Codex utility process is stopping"),
      );
    }
    const id = randomUUID();
    const request = parseCodexUtilityRequest({
      kind: "request",
      id,
      method,
      input,
    });
    return new Promise<CodexUtilityResponseMap[Method]>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!this.pending.delete(id)) {
          return;
        }
        const error = new Error(`Codex utility ${method} timed out`);
        reject(error);
        this.fail(error);
      }, this.requestTimeoutMilliseconds);
      timeout.unref?.();
      this.pending.set(id, {
        method,
        resolve: (value) => {
          try {
            resolve(parseCodexUtilityResponse(method, value));
          } catch (error) {
            const invalidResponse = asError(
              error,
              `Codex utility returned invalid ${method} data`,
            );
            reject(invalidResponse);
            this.fail(invalidResponse);
          }
        },
        reject,
        timeout,
      });
      try {
        this.child.postMessage(request);
      } catch (error) {
        const pending = this.pending.get(id);
        if (pending) {
          this.pending.delete(id);
          clearTimeout(pending.timeout);
          const contactError = asError(
            error,
            "Unable to contact Codex utility process",
          );
          pending.reject(contactError);
          this.fail(contactError);
        }
      }
    });
  }

  private readonly handleMessage = (rawMessage: unknown): void => {
    let message;
    try {
      message = parseCodexUtilityWorkerMessage(rawMessage);
    } catch (error) {
      this.fail(
        asError(error, "Codex utility sent an invalid internal message"),
      );
      return;
    }
    if (message.kind === "diagnostic") {
      this.onDiagnostic?.(message.message);
      return;
    }
    if (message.kind === "login-completion") {
      this.finishLogin(message.completion);
      return;
    }
    if (message.kind === "turn-event") {
      const active = this.activeTurns.get(message.event.streamId);
      if (!active) {
        this.onDiagnostic?.(
          `Ignored Codex event for inactive stream ${message.event.streamId}`,
        );
        return;
      }
      try {
        active.onEvent(message.event);
      } catch (error) {
        this.onDiagnostic?.(
          asError(error, "Branchy turn event callback failed").message,
        );
      }
      if (terminalTurnEvent(message.event)) {
        this.activeTurns.delete(message.event.streamId);
        active.resolve(message.event);
      }
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      this.onDiagnostic?.("Ignored stale Codex utility response");
      return;
    }
    this.pending.delete(message.id);
    clearTimeout(pending.timeout);
    if (message.ok) {
      pending.resolve(message.result);
    } else {
      const error = new Error(message.error.message);
      error.name = message.error.name;
      pending.reject(error);
    }
  };

  private readonly handleExit = (code: unknown): void => {
    if (this.stopped) {
      return;
    }
    this.fail(
      new Error(`Codex utility process exited (${String(code)})`),
      false,
    );
  };

  private readonly handleError = (...detail: unknown[]): void => {
    this.fail(
      asError(
        detail.find((item) => item instanceof Error) ?? detail[0],
        "Codex utility process failed",
      ),
    );
  };

  private finishLogin(completion: DeviceCodeLoginCompletion): void {
    const active = this.activeLogins.get(completion.loginId);
    if (!active) {
      this.bufferedLoginCompletions.set(completion.loginId, completion);
      return;
    }
    this.activeLogins.delete(completion.loginId);
    active.resolve(completion);
  }

  private finishTurn(
    active: ActiveTurn,
    event: CodexTerminalTurnEvent,
  ): void {
    try {
      active.onEvent(event);
    } catch (error) {
      this.onDiagnostic?.(
        asError(error, "Branchy turn event callback failed").message,
      );
    } finally {
      active.resolve(event);
    }
  }

  private fail(error: Error, terminate = true): void {
    if (this.failed || this.stopped) {
      return;
    }
    this.failed = error;
    this.onDiagnostic?.(error.message);
    if (terminate) {
      this.child.kill();
    }
    this.detach();
    this.settleOutstanding(error);
  }

  private settleOutstanding(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
    for (const [loginId, active] of this.activeLogins) {
      active.resolve({
        loginId,
        success: false,
        cancelled: this.stopping,
        error: this.stopping ? null : error.message,
      });
    }
    this.activeLogins.clear();
    this.bufferedLoginCompletions.clear();
    for (const [streamId, active] of this.activeTurns) {
      this.finishTurn(active, {
        type: "error",
        streamId,
        threadId: active.threadId,
        turnId: null,
        message: error.message,
      });
    }
    this.activeTurns.clear();
  }

  private detach(): void {
    this.child.off("message", this.handleMessage);
    this.child.off("exit", this.handleExit);
    this.child.off("error", this.handleError);
  }
}

export async function createCodexUtilityGateway(
  options: CreateCodexUtilityGatewayOptions,
): Promise<CodexUtilityGateway> {
  const child = options.spawnProcess();
  const gateway = new CodexUtilityGateway(child, options);
  try {
    await waitForSpawn(
      child,
      options.spawnTimeoutMilliseconds ??
        DEFAULT_SPAWN_TIMEOUT_MILLISECONDS,
    );
    await gateway.initialize(options.initialize);
    return gateway;
  } catch (error) {
    await gateway.stop();
    throw error;
  }
}
