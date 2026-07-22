import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CodexAppServerClient,
  CodexProtocolError,
  isLoopback,
  isMissingCodexContextError,
  normalizeAdditionalContext,
  toHistoryItems,
} from "./codex-bridge.mjs";

test("bridge accepts only loopback addresses", () => {
  assert.equal(isLoopback("127.0.0.1"), true);
  assert.equal(isLoopback("::1"), true);
  assert.equal(isLoopback("::ffff:127.0.0.1"), true);
  assert.equal(isLoopback("192.168.1.20"), false);
});

test("history injection keeps only non-empty chat messages", () => {
  assert.deepEqual(
    toHistoryItems([
      { role: "user", content: " hello " },
      { role: "assistant", content: "world" },
      { role: "system", content: "ignore" },
      { role: "user", content: "   " },
    ]),
    [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "hello" }],
      },
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "world" }],
      },
    ],
  );
});

test("history recovery is bounded from the newest messages", () => {
  assert.deepEqual(
    toHistoryItems(
      [
        { role: "user", content: "older" },
        { role: "assistant", content: "newer" },
      ],
      5,
    ),
    [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "newer" }],
      },
    ],
  );
});

test("additional context accepts bounded application and untrusted entries", () => {
  assert.deepEqual(
    normalizeAdditionalContext({
      attachment: { value: " source text ", kind: "untrusted" },
      selection: { value: "quoted span", kind: "application" },
      ignored: { value: "" },
    }),
    {
      attachment: { value: "source text", kind: "untrusted" },
      selection: { value: "quoted span", kind: "application" },
    },
  );
});

function createProtocolClient(handler) {
  const client = new CodexAppServerClient();
  client.ensureChatGptAccount = async () => ({ account: { type: "chatgpt" } });
  client.workspace = async () => "/tmp/branch-chat-test";
  client.request = handler;
  return client;
}

test("existing branches resume their persistent Codex thread without replay", async () => {
  const calls = [];
  const client = createProtocolClient(async (method, params) => {
    calls.push({ method, params });
    assert.equal(method, "thread/resume");
    return { thread: { id: "thread-existing" } };
  });

  const prepared = await client.prepareThread({
    threadId: "thread-existing",
    messages: [{ role: "user", content: "must not replay" }],
  });

  assert.deepEqual(prepared, {
    threadId: "thread-existing",
    contextMode: "resume",
    recovered: false,
  });
  assert.deepEqual(calls.map((call) => call.method), ["thread/resume"]);
});

test("new child branches fork through the exact source turn", async () => {
  const calls = [];
  const client = createProtocolClient(async (method, params) => {
    calls.push({ method, params });
    assert.equal(method, "thread/fork");
    return { thread: { id: "thread-child" } };
  });

  const prepared = await client.prepareThread({
    forkFrom: { threadId: "thread-parent", turnId: "turn-source" },
    messages: [{ role: "user", content: "fallback only" }],
  });

  assert.equal(prepared.threadId, "thread-child");
  assert.equal(prepared.contextMode, "fork");
  assert.equal(calls[0].params.threadId, "thread-parent");
  assert.equal(calls[0].params.lastTurnId, "turn-source");
  assert.equal(calls[0].params.ephemeral, false);
});

test("missing native context rebuilds one persistent thread from bounded history", async () => {
  const calls = [];
  const client = createProtocolClient(async (method, params) => {
    calls.push({ method, params });
    if (method === "thread/resume") {
      throw new CodexProtocolError("thread not found");
    }
    if (method === "thread/start") {
      return { thread: { id: "thread-recovered" } };
    }
    if (method === "thread/inject_items") {
      return {};
    }
    throw new Error(`Unexpected method ${method}`);
  });

  const prepared = await client.prepareThread({
    threadId: "thread-missing",
    messages: [{ role: "user", content: "recover me" }],
  });

  assert.equal(prepared.threadId, "thread-recovered");
  assert.equal(prepared.contextMode, "recovery");
  assert.equal(prepared.recovered, true);
  assert.deepEqual(calls.map((call) => call.method), [
    "thread/resume",
    "thread/start",
    "thread/inject_items",
  ]);
  assert.equal(calls[1].params.ephemeral, false);
});

test("transient or configuration errors never silently replace context", async () => {
  const client = createProtocolClient(async () => {
    throw new CodexProtocolError("model is unavailable");
  });

  await assert.rejects(
    () =>
      client.prepareThread({
        threadId: "thread-existing",
        messages: [{ role: "user", content: "do not replay" }],
      }),
    { message: "model is unavailable" },
  );
  assert.equal(
    isMissingCodexContextError(new CodexProtocolError("model is unavailable")),
    false,
  );
});

test("thread cleanup is idempotent for already-missing contexts", async () => {
  const calls = [];
  const client = createProtocolClient(async (method, params) => {
    calls.push({ method, params });
    if (params.threadId === "thread-missing") {
      throw new CodexProtocolError("thread not found");
    }
    return {};
  });
  client.start = async () => {};

  const result = await client.deleteThreads([
    "thread-live",
    "thread-missing",
    "thread-live",
  ]);

  assert.deepEqual(result, {
    deleted: ["thread-live", "thread-missing"],
    failed: [],
  });
  assert.deepEqual(calls.map((call) => call.params.threadId), [
    "thread-live",
    "thread-missing",
  ]);
});
