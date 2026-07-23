import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CodexAppServerClient,
  CodexProtocolError,
  normalizeLocalImagePaths,
} from "./client.ts";
import { DictationRequestError } from "./audio.ts";
import type {
  CodexNotification,
  CodexNotificationListener,
  CodexRpcTransport,
  CodexTransportCloseListener,
  CodexTurnEvent,
} from "./types.ts";

type RequestHandler = (
  method: string,
  params: unknown,
  transport: FakeTransport,
) => unknown | Promise<unknown>;

class FakeTransport implements CodexRpcTransport {
  readonly calls: Array<{
    kind: "start" | "stop" | "request" | "notify";
    method?: string;
    params?: unknown;
  }> = [];
  readonly listeners = new Set<CodexNotificationListener>();
  readonly lifecycleListeners = new Set<CodexTransportCloseListener>();
  private readonly handler: RequestHandler;

  constructor(handler: RequestHandler) {
    this.handler = handler;
  }

  async start(): Promise<void> {
    this.calls.push({ kind: "start" });
  }

  async stop(): Promise<void> {
    this.calls.push({ kind: "stop" });
  }

  async request<TResult = unknown>(
    method: string,
    params?: unknown,
  ): Promise<TResult> {
    this.calls.push({ kind: "request", method, params });
    return (await this.handler(method, params, this)) as TResult;
  }

  async notify(method: string, params?: unknown): Promise<void> {
    this.calls.push({ kind: "notify", method, params });
  }

  subscribe(listener: CodexNotificationListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeLifecycle(listener: CodexTransportCloseListener): () => void {
    this.lifecycleListeners.add(listener);
    return () => this.lifecycleListeners.delete(listener);
  }

  emit(notification: CodexNotification): void {
    for (const listener of [...this.listeners]) {
      listener(notification);
    }
  }

  emitClose(message: string, expected = false): void {
    for (const listener of [...this.lifecycleListeners]) {
      listener({ error: new Error(message), expected });
    }
  }
}

function createPcm16Wav({
  sampleRate = 24_000,
  channels = 1,
  samples = 480,
} = {}): Buffer {
  const dataBytes = samples * channels * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * channels * 2, 28);
  wav.writeUInt16LE(channels * 2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(dataBytes, 40);
  return wav;
}

function defaultResponse(method: string): unknown {
  if (method === "initialize") {
    return {
      userAgent: "fake",
      codexHome: "/isolated/codex-home",
      platformFamily: "unix",
      platformOs: "macos",
    };
  }
  if (method === "account/read") {
    return {
      account: {
        type: "chatgpt",
        email: "branchy@example.test",
        planType: "pro",
      },
      requiresOpenaiAuth: true,
    };
  }
  return {};
}

test("client initializes experimental API before reading isolated account state", async () => {
  const transport = new FakeTransport((method) =>
    defaultResponse(method),
  );
  const client = new CodexAppServerClient({
    transport,
    workspacePath: "/isolated/workspace",
  });

  assert.deepEqual(await client.readAccount(), {
    status: "chatgpt",
    email: "branchy@example.test",
    planType: "pro",
    requiresOpenaiAuth: true,
  });
  assert.deepEqual(
    transport.calls.map((call) => [call.kind, call.method]),
    [
      ["start", undefined],
      ["request", "initialize"],
      ["notify", "initialized"],
      ["request", "account/read"],
    ],
  );
  const initialize = transport.calls.find(
    (call) => call.method === "initialize",
  );
  assert.deepEqual(initialize?.params, {
    clientInfo: {
      name: "branchy-chat",
      title: "Branchy Chat",
      version: "1.0.0",
    },
    capabilities: {
      experimentalApi: true,
      requestAttestation: false,
    },
  });
});

test("device-code login captures completion even when notification precedes response", async () => {
  const transport = new FakeTransport((method, _params, fake) => {
    if (method === "account/login/start") {
      assert.equal(fake.listeners.size, 1);
      fake.emit({
        method: "account/login/completed",
        params: {
          loginId: "login-1",
          success: true,
          error: null,
        },
      });
      return {
        type: "chatgptDeviceCode",
        loginId: "login-1",
        verificationUrl: "https://auth.openai.test/device",
        userCode: "ABCD-EFGH",
      };
    }
    return defaultResponse(method);
  });
  const client = new CodexAppServerClient({
    transport,
    workspacePath: "/isolated/workspace",
  });

  const session = await client.startDeviceCodeLogin();
  assert.equal(session.verificationUrl, "https://auth.openai.test/device");
  assert.equal(session.userCode, "ABCD-EFGH");
  assert.deepEqual(await session.completion, {
    loginId: "login-1",
    success: true,
    cancelled: false,
    error: null,
  });
});

test("device-code login cancellation settles its completion", async () => {
  const transport = new FakeTransport((method) => {
    if (method === "account/login/start") {
      return {
        type: "chatgptDeviceCode",
        loginId: "login-cancel",
        verificationUrl: "https://auth.openai.test/device",
        userCode: "CANCEL-ME",
      };
    }
    if (method === "account/login/cancel") {
      return { status: "canceled" };
    }
    return defaultResponse(method);
  });
  const client = new CodexAppServerClient({
    transport,
    workspacePath: "/isolated/workspace",
  });

  const session = await client.startDeviceCodeLogin();
  assert.equal(await session.cancel(), true);
  assert.deepEqual(await session.completion, {
    loginId: "login-cancel",
    success: false,
    cancelled: true,
    error: null,
  });
});

test("ChatGPT logout clears only the isolated Codex account", async () => {
  let loggedOut = false;
  const transport = new FakeTransport((method) => {
    if (method === "account/logout") {
      loggedOut = true;
      return {};
    }
    if (method === "account/read" && loggedOut) {
      return {
        account: null,
        requiresOpenaiAuth: true,
      };
    }
    return defaultResponse(method);
  });
  const client = new CodexAppServerClient({
    transport,
    workspacePath: "/isolated/workspace",
  });

  assert.deepEqual(await client.logoutChatGpt(), {
    status: "signed-out",
    requiresOpenaiAuth: true,
  });
  assert.equal(
    transport.calls.some(
      (call) => call.method === "account/logout",
    ),
    true,
  );
});

test("turn subscribes before request and preserves structured event order", async () => {
  const transport = new FakeTransport((method, _params, fake) => {
    if (method === "thread/start") {
      return { thread: { id: "thread-1" } };
    }
    if (method === "turn/start") {
      assert.equal(fake.listeners.size, 1);
      fake.emit({
        method: "turn/started",
        params: {
          threadId: "thread-1",
          turn: { id: "turn-1" },
        },
      });
      fake.emit({
        method: "item/agentMessage/delta",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          delta: "Hello",
        },
      });
      fake.emit({
        method: "turn/completed",
        params: {
          threadId: "thread-1",
          turn: {
            id: "turn-1",
            status: "completed",
            items: [{ type: "agentMessage", text: "Hello" }],
          },
        },
      });
      return { turn: { id: "turn-1" } };
    }
    return defaultResponse(method);
  });
  const client = new CodexAppServerClient({
    transport,
    workspacePath: "/isolated/workspace",
  });
  const events: CodexTurnEvent[] = [];

  const session = await client.startTurn(
    {
      streamId: "stream-1",
      content: "Say hello",
      localImagePaths: ["/private/var/branchy/image.png"],
    },
    (event) => events.push(event),
  );

  assert.deepEqual(
    events.map((event) => event.type),
    ["context", "start", "delta", "complete"],
  );
  assert.equal(
    events.find((event) => event.type === "delta")?.delta,
    "Hello",
  );
  assert.equal((await session.completion).type, "complete");
  const turnStart = transport.calls.find(
    (call) => call.method === "turn/start",
  );
  assert.deepEqual(
    (turnStart?.params as { input: unknown[] }).input,
    [
      {
        type: "text",
        text: "Say hello",
        text_elements: [],
      },
      {
        type: "localImage",
        path: "/private/var/branchy/image.png",
      },
    ],
  );
  assert.deepEqual(
    (turnStart?.params as {
      environments: unknown[];
      sandboxPolicy: unknown;
    }).environments,
    [],
  );
  assert.deepEqual(
    (turnStart?.params as { sandboxPolicy: unknown }).sandboxPolicy,
    { type: "readOnly", networkAccess: false },
  );
});

test("unexpected transport closure settles the turn and allows restart", async () => {
  const transport = new FakeTransport((method) => {
    if (method === "thread/start") {
      return { thread: { id: "thread-crash" } };
    }
    if (method === "turn/start") {
      return { turn: { id: "turn-crash" } };
    }
    return defaultResponse(method);
  });
  const client = new CodexAppServerClient({
    transport,
    workspacePath: "/isolated/workspace",
  });
  const events: CodexTurnEvent[] = [];
  const session = await client.startTurn(
    {
      streamId: "stream-crash",
      content: "Keep working",
    },
    (event) => events.push(event),
  );

  transport.emitClose("child exited");
  const terminal = await session.completion;
  assert.equal(terminal.type, "error");
  assert.match(
    terminal.type === "error" ? terminal.message : "",
    /disconnected: child exited/u,
  );
  assert.equal(events.at(-1)?.type, "error");

  await client.readAccount();
  assert.equal(
    transport.calls.filter((call) => call.kind === "start").length,
    2,
  );
});

test("local-image turn inputs are absolute, unique, and bounded", () => {
  assert.deepEqual(
    normalizeLocalImagePaths([
      "relative.png",
      "/private/var/branchy/a.png",
      " /private/var/branchy/a.png ",
      ...Array.from(
        { length: 12 },
        (_, index) => `/private/var/branchy/${index}.png`,
      ),
    ]),
    [
      "/private/var/branchy/a.png",
      "/private/var/branchy/0.png",
      "/private/var/branchy/1.png",
      "/private/var/branchy/2.png",
      "/private/var/branchy/3.png",
      "/private/var/branchy/4.png",
      "/private/var/branchy/5.png",
      "/private/var/branchy/6.png",
    ],
  );
});

test("resume, fork, and missing-context recovery preserve persistent thread semantics", async () => {
  const transport = new FakeTransport((method, params) => {
    const body = params as Record<string, unknown>;
    if (method === "thread/resume") {
      if (body.threadId === "missing") {
        throw new CodexProtocolError("thread not found");
      }
      return { thread: { id: body.threadId } };
    }
    if (method === "thread/fork") {
      assert.equal(body.lastTurnId, "turn-source");
      assert.equal(body.ephemeral, false);
      return { thread: { id: "thread-child" } };
    }
    if (method === "thread/start") {
      assert.equal(body.ephemeral, false);
      return { thread: { id: "thread-recovered" } };
    }
    return defaultResponse(method);
  });
  const client = new CodexAppServerClient({
    transport,
    workspacePath: "/isolated/workspace",
  });

  assert.equal(
    (
      await client.prepareThread({
        streamId: "resume",
        content: "continue",
        threadId: "thread-existing",
      })
    ).contextMode,
    "resume",
  );
  assert.deepEqual(
    await client.prepareThread({
      streamId: "fork",
      content: "branch",
      forkFrom: {
        threadId: "thread-parent",
        turnId: "turn-source",
      },
    }),
    {
      threadId: "thread-child",
      contextMode: "fork",
      recovered: false,
    },
  );
  const recovered = await client.prepareThread({
    streamId: "recover",
    content: "recover",
    threadId: "missing",
    messages: [{ role: "user", content: "bounded history" }],
  });
  assert.equal(recovered.contextMode, "recovery");
  assert.equal(recovered.recovered, true);
  assert.equal(
    transport.calls.some(
      (call) => call.method === "thread/inject_items",
    ),
    true,
  );
});

test("turn cancellation interrupts the active turn and releases it for cleanup", async () => {
  const transport = new FakeTransport((method) => {
    if (method === "thread/start") {
      return { thread: { id: "thread-cancel" } };
    }
    if (method === "turn/start") {
      return { turn: { id: "turn-cancel" } };
    }
    if (method === "thread/delete") {
      return {};
    }
    return defaultResponse(method);
  });
  const client = new CodexAppServerClient({
    transport,
    workspacePath: "/isolated/workspace",
  });
  const events: CodexTurnEvent[] = [];
  const session = await client.startTurn(
    {
      streamId: "stream-cancel",
      content: "Wait",
    },
    (event) => events.push(event),
  );

  assert.equal(await session.cancel(), true);
  assert.equal((await session.completion).type, "cancelled");
  assert.equal(events.at(-1)?.type, "cancelled");
  assert.equal(
    transport.calls.some(
      (call) => call.method === "turn/interrupt",
    ),
    true,
  );
  assert.deepEqual(await client.deleteThreads(["thread-cancel"]), {
    deleted: ["thread-cancel"],
    failed: [],
  });
});

test("thread cleanup is idempotent for missing threads", async () => {
  const transport = new FakeTransport((method, params) => {
    if (
      method === "thread/delete" &&
      (params as { threadId: string }).threadId === "missing"
    ) {
      throw new CodexProtocolError("thread not found");
    }
    return defaultResponse(method);
  });
  const client = new CodexAppServerClient({
    transport,
    workspacePath: "/isolated/workspace",
  });

  assert.deepEqual(
    await client.deleteThreads(["present", "missing", "present"]),
    {
      deleted: ["present", "missing"],
      failed: [],
    },
  );
});

test("dictation subscribes before realtime audio and always removes its temporary thread", async () => {
  let audioFrames = 0;
  const transport = new FakeTransport((method, _params, fake) => {
    if (method === "thread/start") {
      return { thread: { id: "dictation-thread" } };
    }
    if (method === "thread/realtime/start") {
      assert.equal(fake.listeners.size, 1);
      return {};
    }
    if (method === "thread/realtime/appendAudio") {
      audioFrames += 1;
      if (audioFrames === 2) {
        fake.emit({
          method: "thread/realtime/transcript/done",
          params: {
            threadId: "dictation-thread",
            role: "user",
            text: "hello branchy",
          },
        });
      }
      return {};
    }
    return defaultResponse(method);
  });
  const client = new CodexAppServerClient({
    transport,
    workspacePath: "/isolated/workspace",
  });

  assert.deepEqual(
    await client.transcribeWav(createPcm16Wav(), {
      timeoutMilliseconds: 2_000,
      settleMilliseconds: 1,
    }),
    {
      transcript: "hello branchy",
      durationSeconds: 0.02,
    },
  );
  assert.deepEqual(
    transport.calls
      .filter((call) => call.kind === "request")
      .slice(-2)
      .map((call) => call.method),
    ["thread/realtime/stop", "thread/delete"],
  );
});

test("dictation timeout still stops realtime and deletes its temporary thread", async () => {
  const transport = new FakeTransport((method) => {
    if (method === "thread/start") {
      return { thread: { id: "dictation-timeout" } };
    }
    return defaultResponse(method);
  });
  const client = new CodexAppServerClient({
    transport,
    workspacePath: "/isolated/workspace",
  });

  await assert.rejects(
    () =>
      client.transcribeWav(createPcm16Wav(), {
        timeoutMilliseconds: 5,
        settleMilliseconds: 1,
      }),
    (error) =>
      error instanceof DictationRequestError && error.status === 504,
  );
  assert.deepEqual(
    transport.calls
      .filter((call) => call.kind === "request")
      .slice(-2)
      .map((call) => call.method),
    ["thread/realtime/stop", "thread/delete"],
  );
});
