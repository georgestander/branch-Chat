import assert from "node:assert/strict";
import test from "node:test";

import {
  CodexUtilityGateway,
  createCodexUtilityGateway,
  type CodexUtilityProcess,
} from "./utility-gateway.ts";
import {
  parseCodexUtilityRequest,
  type CodexUtilityRequest,
} from "./utility-contracts.ts";

type Listener = (...args: unknown[]) => void;

class FakeUtilityProcess implements CodexUtilityProcess {
  readonly requests: CodexUtilityRequest[] = [];
  readonly listeners = new Map<string, Set<Listener>>();
  killed = false;
  onRequest?: (request: CodexUtilityRequest) => void;

  on(event: string, listener: Listener): this {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  once(event: string, listener: Listener): this {
    const onceListener: Listener = (...args) => {
      this.off(event, onceListener);
      listener(...args);
    };
    return this.on(event, onceListener);
  }

  off(event: string, listener: Listener): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  postMessage(message: unknown): void {
    const request = parseCodexUtilityRequest(message);
    this.requests.push(request);
    this.onRequest?.(request);
  }

  kill(): boolean {
    this.killed = true;
    return true;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      listener(...args);
    }
  }

  respond(
    request: CodexUtilityRequest,
    result: unknown,
  ): void {
    this.emit("message", {
      kind: "response",
      id: request.id,
      ok: true,
      result,
    });
  }
}

test("gateway preserves turn events emitted before startTurn responds", async () => {
  const child = new FakeUtilityProcess();
  const gateway = new CodexUtilityGateway(child);
  const received: string[] = [];
  child.onRequest = (request) => {
    if (request.method !== "startTurn") {
      return;
    }
    child.emit("message", {
      kind: "turn-event",
      event: {
        type: "context",
        streamId: request.input.streamId,
        threadId: "thread-1",
        contextMode: "start",
        recovered: false,
        historyTruncated: false,
      },
    });
    child.respond(request, {
      streamId: request.input.streamId,
      threadId: "thread-1",
    });
  };

  const session = await gateway.startTurn(
    { streamId: "stream-1", content: "Hello" },
    (event) => received.push(event.type),
  );
  child.emit("message", {
    kind: "turn-event",
    event: {
      type: "complete",
      streamId: "stream-1",
      threadId: "thread-1",
      turnId: "turn-1",
      content: "Hello back",
      reasoningSummary: null,
      promptTokens: 2,
      completionTokens: 2,
      contextMode: "start",
      recovered: false,
      historyTruncated: false,
    },
  });

  assert.equal(session.threadId, "thread-1");
  assert.deepEqual(received, ["context", "complete"]);
  assert.equal((await session.completion).type, "complete");
});

test("gateway buffers login completion emitted before its challenge response", async () => {
  const child = new FakeUtilityProcess();
  const gateway = new CodexUtilityGateway(child);
  child.onRequest = (request) => {
    if (request.method !== "startDeviceCodeLogin") {
      return;
    }
    child.emit("message", {
      kind: "login-completion",
      completion: {
        loginId: "login-1",
        success: true,
        cancelled: false,
        error: null,
      },
    });
    child.respond(request, {
      loginId: "login-1",
      verificationUrl: "https://auth.openai.com/codex/device",
      userCode: "ABCD-EFGH",
    });
  };

  const session = await gateway.startDeviceCodeLogin();

  assert.equal(session.loginId, "login-1");
  assert.deepEqual(await session.completion, {
    loginId: "login-1",
    success: true,
    cancelled: false,
    error: null,
  });
});

test("worker exit terminates active turns with a recoverable error", async () => {
  const child = new FakeUtilityProcess();
  const gateway = new CodexUtilityGateway(child);
  const received: string[] = [];
  child.onRequest = (request) => {
    if (request.method === "startTurn") {
      child.respond(request, {
        streamId: request.input.streamId,
        threadId: "thread-1",
      });
    }
  };
  const session = await gateway.startTurn(
    { streamId: "stream-1", content: "Hello" },
    (event) => received.push(event.type),
  );

  child.emit("exit", 9);

  const terminal = await session.completion;
  assert.equal(terminal.type, "error");
  assert.match(
    terminal.type === "error" ? terminal.message : "",
    /exited \(9\)/u,
  );
  assert.deepEqual(received, ["error"]);
});

test("factory waits for spawn and initializes the isolated worker", async () => {
  const child = new FakeUtilityProcess();
  child.onRequest = (request) => {
    if (request.method === "initialize") {
      child.respond(request, { ready: true });
    }
    if (request.method === "stop") {
      child.respond(request, { stopped: true });
    }
  };
  const connecting = createCodexUtilityGateway({
    initialize: {
      userDataPath: "/tmp/branchy-user-data",
      isPackaged: false,
      resourcesPath: "/tmp/branchy-resources",
      developmentExecutablePath: "/tmp/branchy-codex",
    },
    spawnProcess: () => child,
  });
  child.emit("spawn");

  const gateway = await connecting;
  assert.equal(child.requests[0]?.method, "initialize");
  await gateway.stop();
  assert.equal(child.requests.at(-1)?.method, "stop");
  assert.equal(child.killed, true);
});
