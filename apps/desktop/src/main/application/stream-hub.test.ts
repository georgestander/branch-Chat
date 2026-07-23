import assert from "node:assert/strict";
import test from "node:test";

import type { StreamPortMessage } from "../../shared/contracts.ts";
import { StreamHub, type StreamPort } from "./stream-hub.ts";

class FakePort implements StreamPort {
  readonly messages: StreamPortMessage[] = [];
  closed = false;
  started = false;

  close(): void {
    this.closed = true;
  }

  postMessage(message: StreamPortMessage): void {
    this.messages.push(message);
  }

  start(): void {
    this.started = true;
  }
}

test("flushes events emitted before the renderer port arrives", () => {
  const hub = new StreamHub();
  hub.publish("stream-1", { type: "delta", delta: "first" });
  const port = new FakePort();

  hub.open("stream-1", "subscription-1", port);

  assert.equal(port.started, true);
  assert.deepEqual(port.messages, [
    {
      kind: "opened",
      protocolVersion: 1,
      streamId: "stream-1",
      subscriptionId: "subscription-1",
    },
    {
      kind: "event",
      protocolVersion: 1,
      streamId: "stream-1",
      event: { type: "delta", delta: "first" },
    },
  ]);
  hub.dispose();
});

test("routes live events and closes the exact subscription", () => {
  const hub = new StreamHub();
  const first = new FakePort();
  const second = new FakePort();
  hub.open("stream-1", "subscription-1", first);
  hub.open("stream-1", "subscription-2", second);

  hub.publish("stream-1", { type: "cancelled" });
  hub.close("stream-1", "subscription-1");

  assert.equal(first.closed, true);
  assert.equal(second.closed, false);
  assert.equal(
    second.messages.some(
      (message) =>
        message.kind === "event" && message.event.type === "cancelled",
    ),
    true,
  );
  hub.dispose();
});

test("replays live history when a refreshed renderer subscribes late", () => {
  const hub = new StreamHub();
  const original = new FakePort();
  hub.open("stream-1", "subscription-original", original);
  hub.publish("stream-1", { type: "delta", delta: "still working" });

  const refreshed = new FakePort();
  hub.open("stream-1", "subscription-refreshed", refreshed);

  assert.deepEqual(refreshed.messages.slice(1), [
    {
      kind: "event",
      protocolVersion: 1,
      streamId: "stream-1",
      event: { type: "delta", delta: "still working" },
    },
  ]);
  hub.dispose();
});

test("validates events before they cross the port boundary", () => {
  const hub = new StreamHub();
  assert.throws(
    () =>
      hub.publish(
        "stream-1",
        { type: "delta", delta: 1 } as never,
      ),
    /delta/u,
  );
  hub.dispose();
});
