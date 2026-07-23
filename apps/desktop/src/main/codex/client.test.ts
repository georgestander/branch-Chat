import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  buildTurnInputText,
  CodexAppServerClient,
  CodexProtocolError,
  normalizeLocalImagePaths,
} from "./client.ts";
import { DictationRequestError } from "./audio.ts";
import { CHATGPT_TRANSCRIPTION_ENDPOINT } from "./chatgpt-transcription.ts";
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

test("turn input makes application branch context explicit before the request", () => {
  const text = buildTurnInputText("Explain why this matters.", {
    "branch-source-selection": {
      value: "Selected parent passage",
      kind: "application",
    },
  });

  assert.match(
    text,
    /Application context:\nbranch-source-selection:\nSelected parent passage/u,
  );
  assert.match(text, /User request:\nExplain why this matters\./u);
  assert.ok(
    text.indexOf("branch-source-selection") <
      text.indexOf("User request:"),
  );
});

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

function createFakeChatGptToken(
  accountId: string,
  signature = "signature",
): string {
  const payload = Buffer.from(
    JSON.stringify({
      "https://api.openai.com/auth": {
        chatgpt_account_id: accountId,
      },
    }),
  ).toString("base64url");
  return `header.${payload}.${signature}`;
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

test("ChatGPT logout deletes only Branchy's isolated auth file", async () => {
  const root = await mkdtemp(join(tmpdir(), "branchy-codex-auth-"));
  const codexHome = join(root, "codex-home");
  await mkdir(codexHome, { recursive: true });
  const authPath = join(codexHome, "auth.json");
  const outsidePath = join(root, "outside.json");
  await writeFile(authPath, '{"token":"branchy"}', "utf8");
  await writeFile(outsidePath, '{"token":"outside"}', "utf8");
  const transport = new FakeTransport((method) => {
    if (method === "account/logout") {
      return {};
    }
    if (method === "account/read") {
      return {
        account: null,
        requiresOpenaiAuth: true,
      };
    }
    return defaultResponse(method);
  });
  const client = new CodexAppServerClient({
    transport,
    workspacePath: join(root, "workspace"),
    runtime: {
      rootPath: root,
      codexHome,
      processHome: join(root, "process-home"),
      workspacePath: join(root, "workspace"),
      configPath: join(root, "config.toml"),
      xdgConfigHome: join(root, "xdg-config"),
      xdgCacheHome: join(root, "xdg-cache"),
      xdgDataHome: join(root, "xdg-data"),
      xdgStateHome: join(root, "xdg-state"),
    },
  });

  try {
    await client.logoutChatGpt();
    await assert.rejects(readFile(authPath, "utf8"), /ENOENT/u);
    assert.equal(await readFile(outsidePath, "utf8"), '{"token":"outside"}');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ChatGPT logout fails closed when isolated auth.json is a symlink", async () => {
  const root = await mkdtemp(join(tmpdir(), "branchy-codex-auth-"));
  const codexHome = join(root, "codex-home");
  await mkdir(codexHome, { recursive: true });
  const outsidePath = join(root, "outside.json");
  const authPath = join(codexHome, "auth.json");
  let logoutRequestCount = 0;
  await writeFile(authPath, '{"token":"branchy"}', "utf8");
  await writeFile(outsidePath, '{"token":"outside"}', "utf8");
  const transport = new FakeTransport((method) => {
    if (method === "account/logout") {
      logoutRequestCount += 1;
      return {};
    }
    return defaultResponse(method);
  });
  const client = new CodexAppServerClient({
    transport,
    workspacePath: join(root, "workspace"),
    runtime: {
      rootPath: root,
      codexHome,
      processHome: join(root, "process-home"),
      workspacePath: join(root, "workspace"),
      configPath: join(root, "config.toml"),
      xdgConfigHome: join(root, "xdg-config"),
      xdgCacheHome: join(root, "xdg-cache"),
      xdgDataHome: join(root, "xdg-data"),
      xdgStateHome: join(root, "xdg-state"),
    },
  });

  try {
    await client.readAccount();
    await rm(authPath, { force: true });
    await symlink(outsidePath, authPath);
    await assert.rejects(
      client.logoutChatGpt(),
      /Refusing unsafe Codex auth file/u,
    );
    assert.equal(logoutRequestCount, 0);
    assert.equal(await readFile(outsidePath, "utf8"), '{"token":"outside"}');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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

test("image generation notifications progress from running to ready before turn completion", async () => {
  const transport = new FakeTransport((method, _params, fake) => {
    if (method === "thread/start") {
      return { thread: { id: "thread-image" } };
    }
    if (method === "turn/start") {
      fake.emit({
        method: "turn/started",
        params: {
          threadId: "thread-image",
          turn: { id: "turn-image" },
        },
      });
      fake.emit({
        method: "item/started",
        params: {
          threadId: "thread-image",
          turnId: "turn-image",
          item: {
            type: "imageGeneration",
            id: "image-1",
          },
        },
      });
      fake.emit({
        method: "item/completed",
        params: {
          threadId: "thread-image",
          turnId: "turn-image",
          item: {
            type: "imageGeneration",
            id: "image-1",
            savedPath: "/isolated/workspace/generated/image-1.png",
            revisedPrompt: "A cobalt tree at dusk",
          },
        },
      });
      fake.emit({
        method: "turn/completed",
        params: {
          threadId: "thread-image",
          turn: {
            id: "turn-image",
            status: "completed",
            items: [
              {
                type: "agentMessage",
                text: "Here is the generated image.",
              },
            ],
          },
        },
      });
      return { turn: { id: "turn-image" } };
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
      streamId: "stream-image",
      content: "Generate a cobalt tree",
    },
    (event) => events.push(event),
  );

  assert.deepEqual(
    events.map((event) => event.type),
    ["context", "start", "tool_progress", "image_ready", "complete"],
  );
  assert.deepEqual(events[2], {
    type: "tool_progress",
    streamId: "stream-image",
    threadId: "thread-image",
    turnId: "turn-image",
    tool: "image_generation",
    callId: "image-1",
    status: "running",
  });
  assert.deepEqual(events[3], {
    type: "image_ready",
    streamId: "stream-image",
    threadId: "thread-image",
    turnId: "turn-image",
    imageId: "image-1",
    savedPath: "/isolated/workspace/generated/image-1.png",
    revisedPrompt: "A cobalt tree at dusk",
  });
  assert.equal((await session.completion).type, "complete");
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

test("dictation uses ChatGPT batch transcription with isolated account auth", async () => {
  const wav = createPcm16Wav();
  const accessToken = createFakeChatGptToken("account-1");
  const transport = new FakeTransport((method) => {
    if (method === "getAuthStatus") {
      return {
        authMethod: "chatgpt",
        authToken: accessToken,
        requiresOpenaiAuth: true,
      };
    }
    return defaultResponse(method);
  });
  const requests: Array<{
    url: string;
    init: RequestInit | undefined;
  }> = [];
  const client = new CodexAppServerClient({
    transport,
    workspacePath: "/isolated/workspace",
    fetchImpl: async (input, init) => {
      requests.push({ url: String(input), init });
      return new Response(
        JSON.stringify({ text: "hello branchy" }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    },
  });

  assert.deepEqual(
    await client.transcribeWav(wav, {
      timeoutMilliseconds: 2_000,
    }),
    {
      transcript: "hello branchy",
      durationSeconds: 0.02,
    },
  );
  const request = requests[0];
  assert(request);
  assert.equal(request.url, CHATGPT_TRANSCRIPTION_ENDPOINT);
  assert.equal(request.init?.method, "POST");
  assert.equal(request.init?.redirect, "error");
  const headers = new Headers(request.init?.headers);
  assert.equal(headers.get("Authorization"), `Bearer ${accessToken}`);
  assert.equal(headers.get("ChatGPT-Account-Id"), "account-1");
  assert.equal(headers.get("originator"), "Branchy Chat");
  assert.match(
    headers.get("Content-Type") ?? "",
    /^multipart\/form-data; boundary=----branchy-transcribe-/,
  );
  const body = Buffer.from(request.init?.body as Uint8Array);
  assert.notEqual(body.indexOf(wav), -1);
  assert.match(
    body.toString("utf8", 0, Math.min(body.length, 300)),
    /name="file"; filename="branchy-dictation\.wav"/,
  );
  assert.equal(
    transport.calls.some((call) =>
      call.method?.startsWith("thread/realtime"),
    ),
    false,
  );
});

test("dictation refreshes ChatGPT auth once after an unauthorized response", async () => {
  const firstToken = createFakeChatGptToken("account-1", "first");
  const refreshedToken = createFakeChatGptToken(
    "account-1",
    "refreshed",
  );
  const refreshValues: boolean[] = [];
  const transport = new FakeTransport((method, params) => {
    if (method === "getAuthStatus") {
      const refreshToken =
        (params as { refreshToken?: boolean }).refreshToken === true;
      refreshValues.push(refreshToken);
      return {
        authMethod: "chatgpt",
        authToken: refreshToken ? refreshedToken : firstToken,
        requiresOpenaiAuth: true,
      };
    }
    return defaultResponse(method);
  });
  const authorizationHeaders: string[] = [];
  const client = new CodexAppServerClient({
    transport,
    workspacePath: "/isolated/workspace",
    fetchImpl: async (_input, init) => {
      authorizationHeaders.push(
        new Headers(init?.headers).get("Authorization") ?? "",
      );
      if (authorizationHeaders.length === 1) {
        return new Response(null, { status: 401 });
      }
      return new Response(JSON.stringify({ text: "refreshed" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });

  assert.equal(
    (await client.transcribeWav(createPcm16Wav())).transcript,
    "refreshed",
  );
  assert.deepEqual(refreshValues, [false, true]);
  assert.deepEqual(authorizationHeaders, [
    `Bearer ${firstToken}`,
    `Bearer ${refreshedToken}`,
  ]);
});

test("dictation rejects non-ChatGPT auth before making a network request", async () => {
  let fetchCalls = 0;
  const transport = new FakeTransport((method) => {
    if (method === "getAuthStatus") {
      return {
        authMethod: "apikey",
        authToken: "not-a-chatgpt-token",
        requiresOpenaiAuth: true,
      };
    }
    return defaultResponse(method);
  });
  const client = new CodexAppServerClient({
    transport,
    workspacePath: "/isolated/workspace",
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response(null, { status: 500 });
    },
  });

  await assert.rejects(
    () => client.transcribeWav(createPcm16Wav()),
    (error) =>
      error instanceof DictationRequestError && error.status === 401,
  );
  assert.equal(fetchCalls, 0);
});

test("dictation timeout aborts the ChatGPT transcription request", async () => {
  const transport = new FakeTransport((method) => {
    if (method === "getAuthStatus") {
      return {
        authMethod: "chatgpt",
        authToken: createFakeChatGptToken("account-timeout"),
        requiresOpenaiAuth: true,
      };
    }
    return defaultResponse(method);
  });
  const client = new CodexAppServerClient({
    transport,
    workspacePath: "/isolated/workspace",
    fetchImpl: async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      }),
  });

  await assert.rejects(
    () =>
      client.transcribeWav(createPcm16Wav(), {
        timeoutMilliseconds: 5,
      }),
    (error) =>
      error instanceof DictationRequestError && error.status === 504,
  );
});

test("dictation honors an already-cancelled request before app-server startup", async () => {
  const transport = new FakeTransport((method) =>
    defaultResponse(method),
  );
  const abortController = new AbortController();
  abortController.abort();
  const client = new CodexAppServerClient({
    transport,
    workspacePath: "/isolated/workspace",
    fetchImpl: async () =>
      new Response(JSON.stringify({ text: "unexpected" }), {
        status: 200,
      }),
  });

  await assert.rejects(
    () =>
      client.transcribeWav(createPcm16Wav(), {
        signal: abortController.signal,
      }),
    (error) =>
      error instanceof DictationRequestError && error.status === 499,
  );
  assert.deepEqual(transport.calls, []);
});
