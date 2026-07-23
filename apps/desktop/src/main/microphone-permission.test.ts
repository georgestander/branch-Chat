import assert from "node:assert/strict";
import test from "node:test";

import {
  ensureMicrophonePermission,
  type MicrophonePermissionAdapter,
} from "./microphone-permission.ts";

function createAdapter(
  overrides: Partial<MicrophonePermissionAdapter> = {},
): MicrophonePermissionAdapter & {
  statusCalls: number;
  requestCalls: number;
} {
  let statusCalls = 0;
  let requestCalls = 0;
  const adapter = {
    platform: "darwin" as NodeJS.Platform,
    getStatus: () => {
      statusCalls += 1;
      return "not-determined" as const;
    },
    request: async () => {
      requestCalls += 1;
      return true;
    },
    ...overrides,
  };
  return Object.defineProperties(adapter, {
    statusCalls: { get: () => statusCalls },
    requestCalls: { get: () => requestCalls },
  }) as MicrophonePermissionAdapter & {
    statusCalls: number;
    requestCalls: number;
  };
}

test("non-macOS defers microphone consent to the browser runtime", async () => {
  const adapter = createAdapter({ platform: "linux" });

  assert.deepEqual(await ensureMicrophonePermission(adapter), {
    granted: true,
    status: "not-applicable",
  });
  assert.equal(adapter.statusCalls, 0);
  assert.equal(adapter.requestCalls, 0);
});

test("macOS reuses granted microphone consent without prompting", async () => {
  const adapter = createAdapter({
    getStatus: () => "granted",
  });

  assert.deepEqual(await ensureMicrophonePermission(adapter), {
    granted: true,
    status: "granted",
  });
  assert.equal(adapter.requestCalls, 0);
});

test("macOS does not re-prompt denied or restricted microphone access", async () => {
  for (const status of ["denied", "restricted"] as const) {
    const adapter = createAdapter({
      getStatus: () => status,
    });

    assert.deepEqual(await ensureMicrophonePermission(adapter), {
      granted: false,
      status,
    });
    assert.equal(adapter.requestCalls, 0);
  }
});

test("macOS asks once for undetermined microphone consent", async () => {
  const adapter = createAdapter();

  assert.deepEqual(await ensureMicrophonePermission(adapter), {
    granted: true,
    status: "granted",
  });
  assert.equal(adapter.statusCalls, 1);
  assert.equal(adapter.requestCalls, 1);
});

test("macOS reports a rejected consent request as denied", async () => {
  const statuses = ["not-determined", "denied"] as const;
  let statusIndex = 0;
  const adapter = createAdapter({
    getStatus: () => statuses[statusIndex++] ?? "denied",
    request: async () => false,
  });

  assert.deepEqual(await ensureMicrophonePermission(adapter), {
    granted: false,
    status: "denied",
  });
  assert.equal(statusIndex, 2);
});

test("macOS trusts a granted system status after a stale rejection", async () => {
  const statuses = ["not-determined", "granted"] as const;
  let statusIndex = 0;
  const adapter = createAdapter({
    getStatus: () => statuses[statusIndex++] ?? "granted",
    request: async () => false,
  });

  assert.deepEqual(await ensureMicrophonePermission(adapter), {
    granted: true,
    status: "granted",
  });
});
