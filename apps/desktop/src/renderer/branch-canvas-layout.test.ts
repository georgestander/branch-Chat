import assert from "node:assert/strict";
import test from "node:test";

import {
  nearestCanvasNodeId,
  tidyCanvasNodes,
  type CanvasLayoutNode,
} from "./branch-canvas-layout.ts";

const nodes: CanvasLayoutNode[] = [
  { id: "root", x: 0, y: 0, width: 680, height: 700 },
  { id: "child-a", x: 900, y: -200, width: 310, height: 190 },
  { id: "child-b", x: 900, y: 300, width: 310, height: 190 },
  { id: "grandchild", x: 1_400, y: -200, width: 420, height: 320 },
];

test("tidyCanvasNodes lays branches out from parent to child", () => {
  const layout = tidyCanvasNodes(nodes, [
    { source: "root", target: "child-a" },
    { source: "root", target: "child-b" },
    { source: "child-a", target: "grandchild" },
  ]);

  assert.deepEqual(Object.keys(layout).sort(), [
    "child-a",
    "child-b",
    "grandchild",
    "root",
  ]);
  assert.ok(layout.root!.x < layout["child-a"]!.x);
  assert.ok(layout.root!.x < layout["child-b"]!.x);
  assert.ok(layout["child-a"]!.x < layout.grandchild!.x);
  assert.notEqual(layout["child-a"]!.y, layout["child-b"]!.y);
});

test("nearestCanvasNodeId follows the requested spatial direction", () => {
  assert.equal(nearestCanvasNodeId(nodes, "root", "right"), "child-a");
  assert.equal(nearestCanvasNodeId(nodes, "child-a", "down"), "child-b");
  assert.equal(nearestCanvasNodeId(nodes, "child-b", "up"), "child-a");
  assert.equal(nearestCanvasNodeId(nodes, "root", "left"), null);
  assert.equal(nearestCanvasNodeId(nodes, "missing", "right"), null);
});
