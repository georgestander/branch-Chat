import assert from "node:assert/strict";
import test from "node:test";

import {
  BranchSwitchPaintRecorder,
  percentile,
  startBranchSwitchPaintTrace,
} from "./branch-switch-performance.ts";

test("branch switch recorder samples after two animation frames", () => {
  let now = 10;
  const frames: Array<() => void> = [];
  const samples: Array<{
    durationMs: number;
    totalMessageCount: number;
    targetMessageCount: number;
    renderedMessageCount: number;
  }> = [];
  const recorder = new BranchSwitchPaintRecorder({
    now: () => now,
    requestFrame: (callback) => frames.push(callback),
    onSample: (sample) => samples.push(sample),
  });

  recorder.start({
    branchId: "target",
    totalMessageCount: 500,
    targetMessageCount: 250,
  });
  now = 14;
  recorder.completeAfterPaint({
    branchId: "target",
    renderedMessageCount: 250,
  });
  recorder.completeAfterPaint({
    branchId: "target",
    renderedMessageCount: 250,
  });
  assert.equal(frames.length, 1);
  assert.deepEqual(samples, []);

  now = 18;
  frames.shift()?.();
  assert.equal(frames.length, 1);
  assert.deepEqual(samples, []);

  now = 25;
  frames.shift()?.();
  assert.deepEqual(samples, [
    {
      durationMs: 15,
      totalMessageCount: 500,
      targetMessageCount: 250,
      renderedMessageCount: 250,
    },
  ]);
});

test("the wrong active card cannot complete a branch switch sample", () => {
  const frames: Array<() => void> = [];
  const recorder = new BranchSwitchPaintRecorder({
    now: () => 0,
    requestFrame: (callback) => frames.push(callback),
    onSample: () => assert.fail("wrong card emitted a sample"),
  });
  recorder.start({
    branchId: "target",
    totalMessageCount: 500,
    targetMessageCount: 250,
  });
  recorder.completeAfterPaint({
    branchId: "other",
    renderedMessageCount: 250,
  });
  recorder.completeAfterPaint({
    branchId: "target",
    renderedMessageCount: 249,
  });
  assert.deepEqual(frames, []);
});

test("a newer branch switch supersedes an unfinished paint sample", () => {
  let now = 0;
  const frames: Array<() => void> = [];
  const samples: number[] = [];
  const recorder = new BranchSwitchPaintRecorder({
    now: () => now,
    requestFrame: (callback) => frames.push(callback),
    onSample: (sample) => samples.push(sample.durationMs),
  });

  recorder.start({
    branchId: "first",
    totalMessageCount: 500,
    targetMessageCount: 250,
  });
  recorder.completeAfterPaint({
    branchId: "first",
    renderedMessageCount: 250,
  });
  now = 5;
  recorder.start({
    branchId: "second",
    totalMessageCount: 500,
    targetMessageCount: 250,
  });
  recorder.completeAfterPaint({
    branchId: "second",
    renderedMessageCount: 250,
  });

  while (frames.length > 0) {
    now += 5;
    frames.shift()?.();
  }

  assert.deepEqual(samples, [20]);
});

test("percentile uses the nearest-rank definition without mutating samples", () => {
  const samples = [8, 2, 10, 4, 6];
  assert.equal(percentile(samples, 0.5), 6);
  assert.equal(percentile(samples, 0.95), 10);
  assert.deepEqual(samples, [8, 2, 10, 4, 6]);
  assert.throws(() => percentile([], 0.95), /At least one/);
  assert.throws(() => percentile(samples, 1.1), /between zero and one/);
});

test("disabled browser tracing does not evaluate target metadata", () => {
  startBranchSwitchPaintTrace(() => {
    assert.fail("disabled trace evaluated its target");
  });
});
