import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { test } from "node:test";

import {
  StdioCodexTransport,
  type CodexChildProcess,
  type CodexSpawnOptions,
} from "./transport.ts";

class FakeCodexChild extends EventEmitter implements CodexChildProcess {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly writes: Array<Record<string, unknown>> = [];
  readonly stdin: Writable;
  killed = false;

  constructor() {
    super();
    this.stdin = new Writable({
      write: (chunk, _encoding, callback) => {
        const messages = String(chunk)
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as Record<string, unknown>);
        this.writes.push(...messages);
        for (const message of messages) {
          if (message.method === "ping" && message.id !== undefined) {
            this.stdout.write(
              `${JSON.stringify({
                id: message.id,
                result: { ok: true },
              })}\n`,
            );
          }
        }
        callback();
      },
    });
  }

  kill(): boolean {
    this.killed = true;
    queueMicrotask(() => this.emit("exit", 0, null));
    return true;
  }
}

test("stdio transport exchanges requests and notifications through a fake child", async () => {
  const child = new FakeCodexChild();
  const capturedSpawnOptions: CodexSpawnOptions[] = [];
  const transport = new StdioCodexTransport({
    command: "/private/branchy/codex",
    args: ["app-server", "--listen", "stdio://"],
    cwd: "/private/branchy/workspace",
    environment: {
      CODEX_HOME: "/private/branchy/codex-home",
    },
    spawnProcess: (_command, _args, options) => {
      capturedSpawnOptions.push(options);
      queueMicrotask(() => child.emit("spawn"));
      return child;
    },
  });

  await transport.start();
  const notifications: string[] = [];
  transport.subscribe((notification) => {
    notifications.push(notification.method);
  });
  assert.deepEqual(await transport.request("ping", {}), { ok: true });
  child.stdout.write(
    `${JSON.stringify({
      method: "account/login/completed",
      params: { success: true },
    })}\n`,
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(notifications, ["account/login/completed"]);
  const spawnOptions = capturedSpawnOptions[0];
  assert(spawnOptions);
  assert.deepEqual(spawnOptions?.env, {
    CODEX_HOME: "/private/branchy/codex-home",
  });
  assert.equal(spawnOptions?.shell, false);
  assert.equal(child.writes[0].method, "ping");

  await transport.stop();
  assert.equal(child.killed, true);
});

test("stdio transport rejects unsupported server requests instead of granting authority", async () => {
  const child = new FakeCodexChild();
  const transport = new StdioCodexTransport({
    command: "codex",
    args: [],
    cwd: "/tmp",
    environment: {},
    spawnProcess: () => {
      queueMicrotask(() => child.emit("spawn"));
      return child;
    },
  });
  await transport.start();
  child.stdout.write(
    `${JSON.stringify({
      id: 77,
      method: "item/commandExecution/requestApproval",
      params: {},
    })}\n`,
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(child.writes.at(-1), {
    id: 77,
    error: {
      code: -32601,
      message:
        "Branchy Chat does not handle server request item/commandExecution/requestApproval",
    },
  });
  await transport.stop();
});

test("server request ids cannot collide with pending client request ids", async () => {
  const child = new FakeCodexChild();
  const transport = new StdioCodexTransport({
    command: "codex",
    args: [],
    cwd: "/tmp",
    environment: {},
    spawnProcess: () => {
      queueMicrotask(() => child.emit("spawn"));
      return child;
    },
  });
  await transport.start();

  const pending = transport.request("wait", {});
  const requestId = child.writes.at(-1)?.id;
  assert.equal(typeof requestId, "number");
  child.stdout.write(
    `${JSON.stringify({
      id: requestId,
      method: "item/commandExecution/requestApproval",
      params: {},
    })}\n`,
  );
  await new Promise((resolve) => setImmediate(resolve));
  child.stdout.write(
    `${JSON.stringify({
      id: requestId,
      result: { completed: true },
    })}\n`,
  );

  assert.deepEqual(await pending, { completed: true });
  assert.equal(
    child.writes.some(
      (message) =>
        message.id === requestId &&
        (message.error as { code?: number } | undefined)?.code === -32601,
    ),
    true,
  );
  await transport.stop();
});

test("unexpected child exit notifies listeners and permits a clean restart", async () => {
  const children = [new FakeCodexChild(), new FakeCodexChild()];
  let spawnCount = 0;
  const transport = new StdioCodexTransport({
    command: "codex",
    args: [],
    cwd: "/tmp",
    environment: {},
    spawnProcess: () => {
      const child = children[spawnCount++]!;
      queueMicrotask(() => child.emit("spawn"));
      return child;
    },
  });
  const lifecycle: Array<{ expected: boolean; message: string }> = [];
  transport.subscribeLifecycle((event) => {
    lifecycle.push({
      expected: event.expected,
      message: event.error.message,
    });
  });

  await transport.start();
  children[0]!.emit("exit", 1, null);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(lifecycle, [
    {
      expected: false,
      message: "Codex app-server exited (1)",
    },
  ]);

  await transport.start();
  assert.deepEqual(await transport.request("ping", {}), { ok: true });
  assert.equal(spawnCount, 2);
  await transport.stop();
});

test("transport re-runs pre-spawn verification before every restart", async () => {
  const child = new FakeCodexChild();
  let prepareCount = 0;
  let spawnCount = 0;
  const transport = new StdioCodexTransport({
    command: "codex",
    args: [],
    cwd: "/tmp",
    environment: {},
    prepareSpawn: async () => {
      prepareCount += 1;
      if (prepareCount === 2) {
        throw new Error("re-verify failed");
      }
      return {
        command: "codex",
        args: [],
      };
    },
    spawnProcess: () => {
      spawnCount += 1;
      queueMicrotask(() => child.emit("spawn"));
      return child;
    },
  });

  await transport.start();
  child.emit("exit", 1, null);
  await new Promise((resolve) => setImmediate(resolve));

  await assert.rejects(transport.start(), /re-verify failed/);
  assert.equal(prepareCount, 2);
  assert.equal(spawnCount, 1);
});

test("stop during pending pre-spawn verification prevents spawn and settles start", async () => {
  let releasePrepare: (() => void) | undefined;
  let spawnCount = 0;
  const transport = new StdioCodexTransport({
    command: "codex",
    args: [],
    cwd: "/tmp",
    environment: {},
    prepareSpawn: async () =>
      await new Promise((resolve) => {
        releasePrepare = () =>
          resolve({
            command: "codex",
            args: [],
          });
      }),
    spawnProcess: () => {
      spawnCount += 1;
      throw new Error("spawn should not run after stop");
    },
  });

  const startPromise = transport.start();
  const stopPromise = transport.stop();
  if (!releasePrepare) {
    throw new Error("prepareSpawn did not expose a release handle");
  }
  releasePrepare();

  await assert.rejects(startPromise, /start was cancelled/);
  await stopPromise;
  assert.equal(spawnCount, 0);
});

test("output from a replaced child cannot affect the active transport", async () => {
  const children = [new FakeCodexChild(), new FakeCodexChild()];
  const diagnostics: string[] = [];
  let spawnCount = 0;
  const transport = new StdioCodexTransport({
    command: "codex",
    args: [],
    cwd: "/tmp",
    environment: {},
    onDiagnostic: (message) => diagnostics.push(message),
    spawnProcess: () => {
      const child = children[spawnCount++]!;
      queueMicrotask(() => child.emit("spawn"));
      return child;
    },
  });
  const notifications: string[] = [];
  transport.subscribe((notification) => {
    notifications.push(notification.method);
  });

  await transport.start();
  children[0]!.emit("exit", 1, null);
  await new Promise((resolve) => setImmediate(resolve));
  await transport.start();

  const pending = transport.request<{ source: string }>("wait", {});
  const requestId = children[1]!.writes.at(-1)?.id;
  assert.equal(typeof requestId, "number");
  children[0]!.stdout.write(
    `${JSON.stringify({
      id: requestId,
      result: { source: "replaced-child" },
    })}\n${JSON.stringify({
      method: "stale/notification",
      params: {},
    })}\n`,
  );
  children[0]!.stderr.write("stale diagnostic\n");
  children[1]!.stdout.write(
    `${JSON.stringify({
      id: requestId,
      result: { source: "active-child" },
    })}\n${JSON.stringify({
      method: "active/notification",
      params: {},
    })}\n`,
  );
  children[1]!.stderr.write("active diagnostic\n");

  assert.deepEqual(await pending, { source: "active-child" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(notifications, ["active/notification"]);
  assert.deepEqual(diagnostics, ["active diagnostic"]);
  await transport.stop();
});

test("a silent app-server request times out and tears down the child", async () => {
  const children = [new FakeCodexChild(), new FakeCodexChild()];
  let spawnCount = 0;
  const transport = new StdioCodexTransport({
    command: "codex",
    args: [],
    cwd: "/tmp",
    environment: {},
    requestTimeoutMilliseconds: 10,
    spawnProcess: () => {
      const child = children[spawnCount++]!;
      queueMicrotask(() => child.emit("spawn"));
      return child;
    },
  });
  const lifecycle: boolean[] = [];
  transport.subscribeLifecycle((event) => {
    lifecycle.push(event.expected);
  });
  await transport.start();

  await assert.rejects(
    transport.request("never-replies", {}),
    /never-replies timed out/u,
  );
  assert.equal(children[0]!.killed, true);
  assert.deepEqual(lifecycle, [false]);

  await transport.start();
  assert.deepEqual(await transport.request("ping", {}), { ok: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(await transport.request("ping", {}), { ok: true });
  assert.equal(spawnCount, 2);
  await transport.stop();
});
