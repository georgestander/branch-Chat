import assert from "node:assert/strict";
import test from "node:test";

import {
  parseCodexUtilityRequest,
  parseCodexUtilityResponse,
  parseCodexUtilityWorkerMessage,
  recoverCodexUtilityRequestId,
} from "./utility-contracts.ts";

test("utility initialization accepts a bounded browser user agent and rejects header injection", () => {
  const input = {
    userDataPath: "/tmp/branchy-user-data",
    isPackaged: true,
    resourcesPath: "/tmp/branchy-resources",
    transcriptionUserAgent:
      "Mozilla/5.0 Electron/43.2.0 BranchyChat/1.0.0",
  };
  assert.deepEqual(
    parseCodexUtilityRequest({
      kind: "request",
      id: "request-init",
      method: "initialize",
      input,
    }).input,
    input,
  );
  assert.throws(
    () =>
      parseCodexUtilityRequest({
        kind: "request",
        id: "request-bad-agent",
        method: "initialize",
        input: {
          ...input,
          transcriptionUserAgent:
            "Branchy Chat\r\noriginator: injected",
        },
      }),
    /control characters/u,
  );
});

test("utility requests validate the complete turn boundary", () => {
  const request = parseCodexUtilityRequest({
    kind: "request",
    id: "request-1",
    method: "startTurn",
    input: {
      streamId: "stream-1",
      content: "Explain this branch",
      messages: [
        { role: "user", content: "Initial question" },
        { role: "assistant", content: "Initial answer" },
      ],
      localImagePaths: ["/tmp/input.png"],
      additionalContext: {
        note: { value: "Evidence only", kind: "untrusted" },
      },
      serviceTier: "priority",
      webSearch: true,
    },
  });

  assert.equal(request.method, "startTurn");
  assert.equal(request.input.streamId, "stream-1");
  assert.deepEqual(request.input.localImagePaths, ["/tmp/input.png"]);
  assert.throws(
    () =>
      parseCodexUtilityRequest({
        kind: "request",
        id: "request-2",
        method: "startTurn",
        input: {
          streamId: "stream-2",
          content: "Unsafe path",
          localImagePaths: ["relative.png"],
        },
      }),
    /must be absolute/u,
  );
  assert.throws(
    () =>
      parseCodexUtilityRequest({
        kind: "request",
        id: "request-3",
        method: "readAccount",
        input: { unexpected: true },
      }),
    /unexpected field/u,
  );
});

test("utility messages reject malformed process output", () => {
  assert.throws(
    () =>
      parseCodexUtilityWorkerMessage({
        kind: "turn-event",
        event: {
          type: "tool_progress",
          streamId: "stream-1",
          threadId: "thread-1",
          turnId: null,
          tool: "shell",
          callId: "call-1",
          status: "running",
        },
      }),
    /tool progress event is invalid/u,
  );
  assert.throws(
    () =>
      parseCodexUtilityWorkerMessage({
        kind: "response",
        id: "request-1",
        ok: false,
        error: {
          name: "Error",
          message: "failed",
          stack: "must not cross the boundary",
        },
      }),
    /unexpected field stack/u,
  );
});

test("malformed utility requests recover only a bounded correlation id", () => {
  assert.equal(
    recoverCodexUtilityRequestId({ id: "request-1", bad: true }),
    "request-1",
  );
  assert.equal(recoverCodexUtilityRequestId({ id: "" }), null);
  assert.equal(recoverCodexUtilityRequestId({ id: "x".repeat(513) }), null);
  assert.equal(recoverCodexUtilityRequestId(["request-1"]), null);
});

test("utility response validators preserve typed account and dictation results", () => {
  assert.deepEqual(
    parseCodexUtilityResponse("readAccount", {
      status: "chatgpt",
      email: "person@example.com",
      planType: "plus",
      requiresOpenaiAuth: true,
    }),
    {
      status: "chatgpt",
      email: "person@example.com",
      planType: "plus",
      requiresOpenaiAuth: true,
    },
  );
  assert.deepEqual(
    parseCodexUtilityResponse("transcribeWav", {
      transcript: "Draft before send",
      durationSeconds: 1.25,
    }),
    {
      transcript: "Draft before send",
      durationSeconds: 1.25,
    },
  );
  assert.throws(
    () =>
      parseCodexUtilityResponse("transcribeWav", {
        transcript: "bad duration",
        durationSeconds: Number.NaN,
      }),
    /finite number/u,
  );
});
