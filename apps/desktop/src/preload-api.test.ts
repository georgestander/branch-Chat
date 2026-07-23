import assert from "node:assert/strict";
import test from "node:test";

import { IPC_CHANNELS } from "./shared/contracts.ts";
import { createBranchyDesktopApi } from "./preload-api.ts";

type PostedMessage = {
  channel: string;
  payload: unknown;
  transfer: readonly MessagePort[] | undefined;
};

function createHarness() {
  const invocations: Array<{ channel: string; payload: unknown }> = [];
  const posts: PostedMessage[] = [];
  const sends: Array<{ channel: string; payload: unknown }> = [];
  const messageChannel = new MessageChannel();
  const api = createBranchyDesktopApi(
    {
      invoke: async (channel, payload) => {
        invocations.push({ channel, payload });
        return { ok: true };
      },
      postMessage: (channel, payload, transfer) => {
        posts.push({ channel, payload, transfer });
      },
      send: (channel, payload) => {
        sends.push({ channel, payload });
      },
    },
    {
      createMessageChannel: () => messageChannel,
      createSubscriptionId: () => "subscription-1",
    },
  );
  return { api, invocations, messageChannel, posts, sends };
}

test("exposes exact command methods over their allowlisted channels", async () => {
  const harness = createHarness();

  await harness.api.createConversation({ title: "First branch" });
  await harness.api.saveComposerDraft({
    conversationId: "conversation-1",
    branchId: "branch-1",
    content: "Keep this",
  });
  await harness.api.getAccountState();
  await harness.api.requestMicrophonePermission();

  assert.deepEqual(harness.invocations, [
    {
      channel: IPC_CHANNELS.createConversation,
      payload: { title: "First branch" },
    },
    {
      channel: IPC_CHANNELS.saveComposerDraft,
      payload: {
        conversationId: "conversation-1",
        branchId: "branch-1",
        content: "Keep this",
      },
    },
    {
      channel: IPC_CHANNELS.getAccountState,
      payload: {},
    },
    {
      channel: IPC_CHANNELS.requestMicrophonePermission,
      payload: {},
    },
  ]);
  harness.messageChannel.port1.close();
  harness.messageChannel.port2.close();
});

test("opens a MessagePort subscription before accepting stream events", async () => {
  const harness = createHarness();
  const events: unknown[] = [];
  const unsubscribe = harness.api.subscribeStream("stream-1", (event) => {
    events.push(event);
  });

  assert.equal(harness.posts.length, 1);
  assert.equal(harness.posts[0]?.channel, IPC_CHANNELS.streamOpen);
  assert.deepEqual(harness.posts[0]?.payload, {
    streamId: "stream-1",
    subscriptionId: "subscription-1",
  });
  assert.equal(harness.posts[0]?.transfer?.[0], harness.messageChannel.port2);

  harness.messageChannel.port2.postMessage({
    kind: "event",
    protocolVersion: 1,
    streamId: "stream-1",
    event: { type: "delta", delta: "hello" },
  });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.deepEqual(events, [{ type: "delta", delta: "hello" }]);

  unsubscribe();
  assert.deepEqual(harness.sends, [
    {
      channel: IPC_CHANNELS.streamClose,
      payload: {
        streamId: "stream-1",
        subscriptionId: "subscription-1",
      },
    },
  ]);
  harness.messageChannel.port2.close();
});

test("drops malformed or cross-stream port messages", async () => {
  const harness = createHarness();
  const events: unknown[] = [];
  const unsubscribe = harness.api.subscribeStream("stream-1", (event) => {
    events.push(event);
  });

  harness.messageChannel.port2.postMessage({ arbitrary: true });
  harness.messageChannel.port2.postMessage({
    kind: "event",
    protocolVersion: 1,
    streamId: "stream-2",
    event: { type: "cancelled" },
  });
  await new Promise((resolve) => setTimeout(resolve, 25));

  assert.deepEqual(events, []);
  unsubscribe();
  harness.messageChannel.port2.close();
});
