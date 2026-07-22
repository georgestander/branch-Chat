import assert from "node:assert/strict";
import { test } from "node:test";

import type { AppContext } from "@/app/context";
import type { AppRequestInfo } from "@/worker";
import {
  DICTATION_MAX_BODY_BYTES,
  handleDictationRequest,
} from "./dictationProxy.server.ts";

function requestInfo(request: Request, events: string[] = []): AppRequestInfo {
  const ctx = {
    env: { CODEX_BRIDGE_URL: "http://127.0.0.1:43991" } as Env,
    trace: (event: string) => {
      events.push(event);
    },
  } as unknown as AppContext;
  return { request, ctx } as unknown as AppRequestInfo;
}

test("dictation proxy forwards bounded WAV audio and returns editable text", async () => {
  const originalFetch = globalThis.fetch;
  const events: string[] = [];
  const forwarded: Request[] = [];
  globalThis.fetch = async (input, init) => {
    forwarded.push(new Request(input, init));
    return Response.json({ transcript: "hello branch chat" });
  };

  try {
    const response = await handleDictationRequest(
      requestInfo(
        new Request("http://branch-chat.test/_dictation/transcribe", {
          method: "POST",
          headers: { "content-type": "audio/wav" },
          body: new Uint8Array([1, 2, 3]),
        }),
        events,
      ),
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { transcript: "hello branch chat" });
    assert.equal(forwarded[0]?.url, "http://127.0.0.1:43991/dictation/transcribe");
    assert.equal(forwarded[0]?.headers.get("content-type"), "audio/wav");
    assert.deepEqual(
      Array.from(new Uint8Array(await forwarded[0]!.arrayBuffer())),
      [1, 2, 3],
    );
    assert.deepEqual(events, ["dictation:transcribed"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("dictation proxy rejects unsupported media before calling Codex", async () => {
  const response = await handleDictationRequest(
    requestInfo(
      new Request("http://branch-chat.test/_dictation/transcribe", {
        method: "POST",
        headers: { "content-type": "audio/webm" },
        body: new Uint8Array([1]),
      }),
    ),
  );

  assert.equal(response.status, 415);
  assert.deepEqual(await response.json(), {
    error: "Dictation audio must be a WAV file",
  });
});

test("dictation proxy rejects a declared body above the hard limit", async () => {
  const response = await handleDictationRequest(
    requestInfo(
      new Request("http://branch-chat.test/_dictation/transcribe", {
        method: "POST",
        headers: {
          "content-type": "audio/wav",
          "content-length": String(DICTATION_MAX_BODY_BYTES + 1),
        },
        body: new Uint8Array([1]),
      }),
    ),
  );

  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), {
    error: "Dictation audio is too large",
  });
});

test("dictation proxy preserves actionable Codex bridge failures", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json(
    { error: "Another dictation is already being transcribed" },
    { status: 409 },
  );

  try {
    const response = await handleDictationRequest(
      requestInfo(
        new Request("http://branch-chat.test/_dictation/transcribe", {
          method: "POST",
          headers: { "content-type": "audio/wav" },
          body: new Uint8Array([1]),
        }),
      ),
    );
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      error: "Another dictation is already being transcribed",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
