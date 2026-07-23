import {
  STREAM_PROTOCOL_VERSION,
  type BranchyStreamEvent,
  type StreamPortMessage,
} from "../../shared/contracts.ts";
import { validateBranchyStreamEvent } from "../../shared/validators.ts";

const MAX_BUFFERED_EVENT_BYTES = 512 * 1024;
const TERMINAL_RETENTION_MILLISECONDS = 30_000;

export interface StreamPort {
  close(): void;
  on?(event: "close", listener: () => void): unknown;
  postMessage(message: StreamPortMessage): void;
  start(): void;
}

interface StreamRecord {
  buffered: BranchyStreamEvent[];
  bufferedBytes: number;
  ports: Map<string, StreamPort>;
  terminal: boolean;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
}

function eventBytes(event: BranchyStreamEvent): number {
  return Buffer.byteLength(JSON.stringify(event), "utf8");
}

function isTerminal(event: BranchyStreamEvent): boolean {
  return (
    event.type === "complete" ||
    event.type === "cancelled" ||
    event.type === "error"
  );
}

export class StreamHub {
  private readonly streams = new Map<string, StreamRecord>();

  open(
    streamId: string,
    subscriptionId: string,
    port: StreamPort,
  ): void {
    const record = this.requireRecord(streamId);
    record.ports.get(subscriptionId)?.close();
    record.ports.set(subscriptionId, port);
    port.on?.("close", () => {
      if (record.ports.get(subscriptionId) === port) {
        record.ports.delete(subscriptionId);
      }
    });
    port.start();
    if (
      !this.safePost(port, {
        kind: "opened",
        protocolVersion: STREAM_PROTOCOL_VERSION,
        streamId,
        subscriptionId,
      })
    ) {
      record.ports.delete(subscriptionId);
      return;
    }
    for (const event of record.buffered) {
      if (
        !this.safePost(port, {
          kind: "event",
          protocolVersion: STREAM_PROTOCOL_VERSION,
          streamId,
          event,
        })
      ) {
        record.ports.delete(subscriptionId);
        return;
      }
    }
  }

  close(streamId: string, subscriptionId: string): void {
    const record = this.streams.get(streamId);
    const port = record?.ports.get(subscriptionId);
    if (!record || !port) {
      return;
    }
    record.ports.delete(subscriptionId);
    port.close();
    if (record.terminal && record.ports.size === 0) {
      this.deleteRecord(streamId, record);
    }
  }

  publish(streamId: string, rawEvent: BranchyStreamEvent): void {
    const event = validateBranchyStreamEvent(rawEvent);
    const record = this.requireRecord(streamId);
    if (record.terminal) {
      return;
    }

    this.buffer(record, event);
    for (const [subscriptionId, port] of record.ports) {
      if (
        !this.safePost(port, {
          kind: "event",
          protocolVersion: STREAM_PROTOCOL_VERSION,
          streamId,
          event,
        })
      ) {
        record.ports.delete(subscriptionId);
      }
    }

    if (isTerminal(event)) {
      record.terminal = true;
      record.cleanupTimer = setTimeout(() => {
        this.deleteRecord(streamId, record);
      }, TERMINAL_RETENTION_MILLISECONDS);
      record.cleanupTimer.unref?.();
    }
  }

  dispose(): void {
    for (const [streamId, record] of this.streams) {
      this.deleteRecord(streamId, record);
    }
  }

  private buffer(record: StreamRecord, event: BranchyStreamEvent): void {
    const size = eventBytes(event);
    while (
      record.buffered.length > 0 &&
      record.bufferedBytes + size > MAX_BUFFERED_EVENT_BYTES
    ) {
      const removed = record.buffered.shift();
      if (removed) {
        record.bufferedBytes -= eventBytes(removed);
      }
    }
    if (size <= MAX_BUFFERED_EVENT_BYTES) {
      record.buffered.push(event);
      record.bufferedBytes += size;
    }
  }

  private requireRecord(streamId: string): StreamRecord {
    const existing = this.streams.get(streamId);
    if (existing) {
      return existing;
    }
    const record: StreamRecord = {
      buffered: [],
      bufferedBytes: 0,
      ports: new Map(),
      terminal: false,
      cleanupTimer: null,
    };
    this.streams.set(streamId, record);
    return record;
  }

  private deleteRecord(streamId: string, record: StreamRecord): void {
    if (this.streams.get(streamId) !== record) {
      return;
    }
    if (record.cleanupTimer) {
      clearTimeout(record.cleanupTimer);
    }
    for (const port of record.ports.values()) {
      port.close();
    }
    record.ports.clear();
    this.streams.delete(streamId);
  }

  private safePost(port: StreamPort, message: StreamPortMessage): boolean {
    try {
      port.postMessage(message);
      return true;
    } catch {
      port.close();
      return false;
    }
  }
}
