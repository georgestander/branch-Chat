import assert from "node:assert/strict";
import test from "node:test";

import {
  hasAudioInputDevice,
  MicrophoneRequestTimeoutError,
  microphonePermissionRecoveryMessage,
  withMicrophoneRequestTimeout,
} from "./microphone.ts";

test("audio input detection ignores output-only devices", () => {
  assert.equal(
    hasAudioInputDevice([
      { kind: "audiooutput" },
      { kind: "videoinput" },
    ]),
    false,
  );
  assert.equal(
    hasAudioInputDevice([
      { kind: "audiooutput" },
      { kind: "audioinput" },
    ]),
    true,
  );
});

test("microphone permission recovery distinguishes denied from restricted", () => {
  assert.equal(
    microphonePermissionRecoveryMessage("denied"),
    "Microphone access is off. Enable it in System Settings, restart Branchy Chat, then try again.",
  );
  assert.equal(
    microphonePermissionRecoveryMessage("restricted"),
    "Microphone access is restricted by macOS or device management on this Mac.",
  );
});

test("microphone requests return before their deadline", async () => {
  assert.equal(
    await withMicrophoneRequestTimeout(Promise.resolve("ready"), {
      timeoutMs: 25,
    }),
    "ready",
  );
});

test("microphone requests fail instead of remaining pending forever", async () => {
  await assert.rejects(
    withMicrophoneRequestTimeout(new Promise(() => {}), {
      timeoutMs: 1,
    }),
    MicrophoneRequestTimeoutError,
  );
});

test("a stream arriving after timeout is stopped", async () => {
  let resolveStream: (stream: {
    getTracks(): { stop(): void }[];
  }) => void = () => {
    throw new Error("Stream resolver was not initialized.");
  };
  let stopCalls = 0;
  const streamPromise = new Promise<{
    getTracks(): { stop(): void }[];
  }>((resolve) => {
    resolveStream = resolve;
  });
  const request = withMicrophoneRequestTimeout(streamPromise, {
    timeoutMs: 1,
    onLateResult: (stream) => {
      for (const track of stream.getTracks()) {
        track.stop();
      }
    },
  });

  await assert.rejects(request, MicrophoneRequestTimeoutError);
  resolveStream({
    getTracks: () => [
      {
        stop: () => {
          stopCalls += 1;
        },
      },
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(stopCalls, 1);
});
