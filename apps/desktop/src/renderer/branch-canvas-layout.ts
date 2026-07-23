import dagre from "@dagrejs/dagre";

export type CanvasLayoutDirection = "left" | "right" | "up" | "down";

export type CanvasLayoutNode = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CanvasLayoutEdge = {
  source: string;
  target: string;
};

export type CanvasNodePosition = {
  x: number;
  y: number;
};

export function tidyCanvasNodes(
  nodes: CanvasLayoutNode[],
  edges: CanvasLayoutEdge[],
): Record<string, CanvasNodePosition> {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: "LR",
    ranksep: 110,
    nodesep: 70,
    marginx: 40,
    marginy: 40,
  });

  for (const node of nodes) {
    graph.setNode(node.id, {
      width: node.width,
      height: node.height,
    });
  }
  for (const edge of edges) {
    if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) {
      graph.setEdge(edge.source, edge.target);
    }
  }

  dagre.layout(graph);

  return Object.fromEntries(
    nodes.map((node) => {
      const positioned = graph.node(node.id) as
        | { x: number; y: number }
        | undefined;
      if (!positioned) {
        return [node.id, { x: node.x, y: node.y }];
      }
      return [
        node.id,
        {
          x: positioned.x - node.width / 2,
          y: positioned.y - node.height / 2,
        },
      ];
    }),
  );
}

export function nearestCanvasNodeId(
  nodes: CanvasLayoutNode[],
  currentId: string,
  direction: CanvasLayoutDirection,
): string | null {
  const current = nodes.find((node) => node.id === currentId);
  if (!current) return null;

  const candidates = nodes
    .filter((node) => {
      if (node.id === currentId) return false;
      if (direction === "left") return node.x < current.x;
      if (direction === "right") return node.x > current.x;
      if (direction === "up") return node.y < current.y;
      return node.y > current.y;
    })
    .map((node) => {
      const primaryDistance =
        direction === "left" || direction === "right"
          ? Math.abs(node.x - current.x)
          : Math.abs(node.y - current.y);
      const crossAxisDistance =
        direction === "left" || direction === "right"
          ? Math.abs(node.y - current.y)
          : Math.abs(node.x - current.x);
      return {
        id: node.id,
        distance: primaryDistance + crossAxisDistance,
        crossAxisDistance,
      };
    })
    .sort(
      (left, right) =>
        left.distance - right.distance ||
        left.crossAxisDistance - right.crossAxisDistance ||
        left.id.localeCompare(right.id),
    );

  return candidates[0]?.id ?? null;
}
