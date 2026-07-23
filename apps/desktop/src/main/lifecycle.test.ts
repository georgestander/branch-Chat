import assert from "node:assert/strict";
import test from "node:test";

import {
  createQuitCoordinator,
  shouldReportRendererLoadFailure,
  type QuitEvent,
} from "./lifecycle.ts";

function deferred(): {
  promise: Promise<void>;
  resolve(): void;
  reject(error: Error): void;
} {
  let resolvePromise: (() => void) | undefined;
  let rejectPromise: ((error: Error) => void) | undefined;
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: () => resolvePromise?.(),
    reject: (error) => rejectPromise?.(error),
  };
}

async function settlePromises(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test("quit cleanup hides windows once and suppresses window recreation", async () => {
  const cleanup = deferred();
  let hideCount = 0;
  let shutdownCount = 0;
  let quitCount = 0;
  let exitCount = 0;
  let preventCount = 0;
  let scheduledTimeout: (() => void) | undefined;
  let cancelCount = 0;
  const event: QuitEvent = {
    preventDefault: () => {
      preventCount += 1;
    },
  };
  const coordinator = createQuitCoordinator({
    shutdown: () => {
      shutdownCount += 1;
      return cleanup.promise;
    },
    hideWindows: () => {
      hideCount += 1;
    },
    quit: () => {
      quitCount += 1;
    },
    exit: () => {
      exitCount += 1;
    },
    onError: () => assert.fail("quit cleanup should not report an error"),
    scheduleTimeout: (callback) => {
      scheduledTimeout = callback;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    },
    cancelTimeout: () => {
      cancelCount += 1;
    },
  });

  coordinator.handleBeforeQuit(event);
  coordinator.handleBeforeQuit(event);

  assert.equal(coordinator.isShuttingDown(), true);
  assert.equal(preventCount, 2);
  assert.equal(hideCount, 1);
  await Promise.resolve();
  assert.equal(shutdownCount, 1);
  assert.equal(quitCount, 0);
  assert.equal(exitCount, 0);
  assert.ok(scheduledTimeout);

  cleanup.resolve();
  await settlePromises();

  assert.equal(cancelCount, 1);
  assert.equal(quitCount, 1);
  assert.equal(exitCount, 0);

  coordinator.handleBeforeQuit(event);
  assert.equal(preventCount, 2);
  assert.equal(hideCount, 1);
});

test("quit cleanup reports failures and still completes the quit", async () => {
  const cleanup = deferred();
  const errors: unknown[] = [];
  let quitCount = 0;
  let exitCount = 0;
  const coordinator = createQuitCoordinator({
    shutdown: () => cleanup.promise,
    hideWindows: () => {},
    quit: () => {
      quitCount += 1;
    },
    exit: () => {
      exitCount += 1;
    },
    onError: (error) => errors.push(error),
    scheduleTimeout: () =>
      1 as unknown as ReturnType<typeof setTimeout>,
    cancelTimeout: () => {},
  });

  coordinator.handleBeforeQuit({ preventDefault: () => {} });
  const failure = new Error("cleanup failed");
  cleanup.reject(failure);
  await settlePromises();

  assert.deepEqual(errors, [failure]);
  assert.equal(quitCount, 1);
  assert.equal(exitCount, 0);
});

test("quit cleanup force exits when shutdown exceeds its bound", async () => {
  const cleanup = deferred();
  let timeoutCallback: (() => void) | undefined;
  let quitCount = 0;
  const exitCodes: number[] = [];
  const coordinator = createQuitCoordinator({
    shutdown: () => cleanup.promise,
    hideWindows: () => {},
    quit: () => {
      quitCount += 1;
    },
    exit: (exitCode) => exitCodes.push(exitCode),
    onError: () => assert.fail("timeout should not report a cleanup error"),
    scheduleTimeout: (callback) => {
      timeoutCallback = callback;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    },
    cancelTimeout: () => assert.fail("active timeout should not be cancelled"),
  });

  coordinator.handleBeforeQuit({ preventDefault: () => {} });
  assert.ok(timeoutCallback);
  timeoutCallback();

  assert.deepEqual(exitCodes, [0]);
  assert.equal(quitCount, 0);

  cleanup.resolve();
  await settlePromises();

  assert.deepEqual(exitCodes, [0]);
  assert.equal(quitCount, 0);
});

test("quit coordinator validates its timeout boundary", () => {
  assert.throws(
    () =>
      createQuitCoordinator({
        shutdown: async () => {},
        hideWindows: () => {},
        quit: () => {},
        exit: () => {},
        onError: () => {},
        timeoutMilliseconds: 0,
      }),
    /positive integer/u,
  );
});

test("renderer load failures stay silent during intentional teardown", () => {
  assert.equal(shouldReportRendererLoadFailure(false, false), true);
  assert.equal(shouldReportRendererLoadFailure(true, false), false);
  assert.equal(shouldReportRendererLoadFailure(false, true), false);
});
