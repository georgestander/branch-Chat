type StreamId = string;

type Enqueue = (data: string) => void;

type StreamChannel = {
  enqueue: Enqueue;
  close: () => void;
};

// Ephemeral in-memory map of active SSE streams (best-effort in a single isolate)
const CHANNELS: Map<StreamId, StreamChannel> = new Map();

export function getChannel(streamId: StreamId): StreamChannel | undefined {
  return CHANNELS.get(streamId);
}

export function createSSEStream(streamId: StreamId): Response {
  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enqueue: Enqueue = (data: string) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`${data}\n`));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        controller.close();
      };

      // Register channel
      CHANNELS.set(streamId, { enqueue, close });

      // Send initial comment to establish stream quickly
      enqueue(`: stream ${streamId} open`);

      // Heartbeat every 15s to keep connections alive
      const interval = setInterval(() => {
        enqueue(`: ping ${Date.now()}`);
      }, 15000);

      // Cleanup on cancel
      // @ts-ignore runtime provides cancel
      controller["_onCancel"] = () => {
        clearInterval(interval as any);
        CHANNELS.delete(streamId);
        close();
      };
    },
    cancel() {
      CHANNELS.delete(streamId);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

export function sendSSE(streamId: StreamId, event: string, data: unknown): void {
  const channel = CHANNELS.get(streamId);
  if (!channel) return;
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  channel.enqueue(`event: ${event}\n` + `data: ${payload}\n`);
}

export function closeSSE(streamId: StreamId): void {
  const channel = CHANNELS.get(streamId);
  if (!channel) return;
  channel.enqueue("event: end\n" + "data: {}\n");
  channel.close();
  CHANNELS.delete(streamId);
}

