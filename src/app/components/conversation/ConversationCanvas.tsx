"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dagre from "@dagrejs/dagre";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type {
  Branch,
  BranchId,
  ConversationCanvasPatch,
  ConversationGraphSnapshot,
  Message,
} from "@/lib/conversation";
import { cn } from "@/lib/utils";
import {
  Focus,
  GitBranch,
  LayoutGrid,
  Layers3,
  MessageSquareText,
  Trash2,
} from "lucide-react";

const CARD_WIDTH = 310;
const CARD_HEIGHT = 190;

type BranchCardSummary = {
  branch: Branch;
  latestPreview: string | null;
  descendantCount: number;
  messageCount: number;
  isStreaming: boolean;
  folded: boolean;
};

type BranchNodeData = {
  summary: BranchCardSummary;
  active: boolean;
  onOpen: (branchId: BranchId) => void;
  onToggleFold: (branchId: BranchId) => void;
  onDelete: (branchId: BranchId) => void;
};

type BranchFlowNode = Node<BranchNodeData, "branch">;

interface ConversationCanvasProps {
  snapshot: ConversationGraphSnapshot;
  activeBranchId: BranchId;
  onOpenBranch: (branchId: BranchId) => void;
  onPatchCanvas: (patch: ConversationCanvasPatch) => void;
  onDeleteBranch: (branchId: BranchId) => void;
  className?: string;
}

function branchMessages(
  snapshot: ConversationGraphSnapshot,
  branchId: BranchId,
): Message[] {
  return (snapshot.branches[branchId]?.messageIds ?? [])
    .map((messageId) => snapshot.messages[messageId])
    .filter((message): message is Message => Boolean(message));
}

function childrenByParent(snapshot: ConversationGraphSnapshot) {
  const children = new Map<BranchId, Branch[]>();
  for (const branch of Object.values(snapshot.branches)) {
    if (!branch.parentId) continue;
    const siblings = children.get(branch.parentId) ?? [];
    siblings.push(branch);
    children.set(branch.parentId, siblings);
  }
  return children;
}

function descendantCount(
  branchId: BranchId,
  children: Map<BranchId, Branch[]>,
): number {
  let count = 0;
  const queue = [...(children.get(branchId) ?? [])];
  while (queue.length > 0) {
    const branch = queue.shift()!;
    count += 1;
    queue.push(...(children.get(branch.id) ?? []));
  }
  return count;
}

function visibleBranchIds(
  snapshot: ConversationGraphSnapshot,
  folded: Record<BranchId, boolean>,
): Set<BranchId> {
  const visible = new Set<BranchId>();
  const children = childrenByParent(snapshot);
  const visit = (branchId: BranchId) => {
    if (!snapshot.branches[branchId]) return;
    visible.add(branchId);
    if (folded[branchId]) return;
    for (const child of children.get(branchId) ?? []) visit(child.id);
  };
  visit(snapshot.conversation.rootBranchId);
  return visible;
}

function BranchNode({ data, selected }: NodeProps<BranchFlowNode>) {
  const { summary } = data;
  const preview = summary.latestPreview
    ? summary.latestPreview.length > 145
      ? `${summary.latestPreview.slice(0, 142)}…`
      : summary.latestPreview
    : "No messages yet.";

  return (
    <article
      className={cn(
        "group relative h-[190px] w-[310px] rounded border bg-background px-4 py-3 text-left transition",
        data.active || selected
          ? "border-foreground ring-2 ring-ring"
          : "border-border hover:border-foreground/45",
      )}
      aria-label={`${summary.branch.title} branch card`}
    >
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        className="pointer-events-none! h-2! w-2! border-0! bg-foreground/40!"
      />
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className="pointer-events-none! h-2! w-2! border-0! bg-foreground/40!"
      />

      {summary.folded && summary.descendantCount > 0 ? (
        <>
          <span className="pointer-events-none absolute -bottom-2 left-3 right-3 -z-10 h-5 rounded border border-border bg-muted" />
          <span className="pointer-events-none absolute -bottom-4 left-6 right-6 -z-20 h-5 rounded border border-border/70 bg-muted/70" />
        </>
      ) : null}

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.17em] text-muted-foreground">
            <GitBranch className="h-3.5 w-3.5" aria-hidden="true" />
            {summary.branch.parentId ? "Branch" : "Root chat"}
          </div>
          <h2 className="mt-1 truncate text-sm font-semibold text-foreground">
            {summary.branch.title || "Untitled branch"}
          </h2>
        </div>
        {summary.isStreaming ? (
          <span className="rounded border border-accent/45 bg-accent/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-accent-foreground">
            Live
          </span>
        ) : null}
      </div>

      {summary.branch.createdFrom.excerpt ? (
        <p className="mt-2 line-clamp-2 rounded bg-muted/55 px-2 py-1 text-[11px] leading-4 text-muted-foreground">
          “{summary.branch.createdFrom.excerpt}”
        </p>
      ) : (
        <p className="mt-2 line-clamp-2 text-xs leading-4 text-muted-foreground">
          {preview}
        </p>
      )}

      <div className="absolute bottom-3 left-4 right-4 flex items-end justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5">
            <MessageSquareText className="h-3 w-3" aria-hidden="true" />
            {summary.messageCount}
          </span>
          <span className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5">
            <Layers3 className="h-3 w-3" aria-hidden="true" />
            {summary.descendantCount}
          </span>
        </div>
        <div className="nodrag nopan flex items-center gap-1">
          {summary.descendantCount > 0 ? (
            <button
              type="button"
              onClick={() => data.onToggleFold(summary.branch.id)}
              className="rounded border border-border px-1.5 py-1 text-[10px] font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`${summary.folded ? "Unfold" : "Fold"} ${summary.branch.title}`}
            >
              {summary.folded ? `Unfold ${summary.descendantCount}` : "Fold"}
            </button>
          ) : null}
          {summary.branch.parentId ? (
            <button
              type="button"
              onClick={() => data.onDelete(summary.branch.id)}
              className="rounded border border-destructive/35 p-1 text-destructive hover:bg-destructive hover:text-destructive-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
              aria-label={`Delete ${summary.branch.title}`}
            >
              <Trash2 className="h-3 w-3" aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => data.onOpen(summary.branch.id)}
            className="rounded border border-foreground bg-foreground p-1 text-background hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Open ${summary.branch.title}`}
          >
            <Focus className="h-3 w-3" aria-hidden="true" />
          </button>
        </div>
      </div>
    </article>
  );
}

const nodeTypes = { branch: BranchNode };

function CanvasFlow({
  snapshot,
  activeBranchId,
  onOpenBranch,
  onPatchCanvas,
  onDeleteBranch,
  className,
}: ConversationCanvasProps) {
  const flow = useReactFlow<BranchFlowNode, Edge>();
  const viewportTimer = useRef<number | null>(null);
  const persistedViewport = useRef(snapshot.canvas.viewport);
  const [selectedId, setSelectedId] = useState<BranchId>(activeBranchId);
  const [folded, setFolded] = useState<Record<BranchId, boolean>>(() =>
    Object.fromEntries(
      Object.entries(snapshot.canvas.nodes).map(([id, node]) => [id, node.folded]),
    ),
  );

  const childMap = useMemo(() => childrenByParent(snapshot), [snapshot]);
  const visibleIds = useMemo(
    () => visibleBranchIds(snapshot, folded),
    [folded, snapshot],
  );

  const summaries = useMemo(() => {
    const result = new Map<BranchId, BranchCardSummary>();
    for (const branch of Object.values(snapshot.branches)) {
      const messages = branchMessages(snapshot, branch.id);
      const last = messages[messages.length - 1];
      const latest = [...messages]
        .reverse()
        .find((message) => message.role !== "system" && message.content.trim());
      result.set(branch.id, {
        branch,
        latestPreview: latest?.content ?? null,
        descendantCount: descendantCount(branch.id, childMap),
        messageCount: messages.filter((message) => message.role !== "system").length,
        isStreaming: Boolean(
          last?.role === "assistant" &&
            !last.tokenUsage &&
            last.content.trim().length === 0,
        ),
        folded: folded[branch.id] === true,
      });
    }
    return result;
  }, [childMap, folded, snapshot]);

  const toggleFold = useCallback(
    (branchId: BranchId) => {
      const nextValue = !folded[branchId];
      setFolded((current) => {
        return { ...current, [branchId]: nextValue };
      });
      onPatchCanvas({
        focusedBranchId: branchId,
        nodes: { [branchId]: { folded: nextValue } },
      });
      setSelectedId(branchId);
    },
    [folded, onPatchCanvas],
  );

  const desiredNodes = useMemo<BranchFlowNode[]>(() => {
    return Object.values(snapshot.branches)
      .filter((branch) => visibleIds.has(branch.id))
      .map((branch) => {
        const saved = snapshot.canvas.nodes[branch.id];
        return {
          id: branch.id,
          type: "branch",
          position: { x: saved?.x ?? 0, y: saved?.y ?? 0 },
          initialWidth: CARD_WIDTH,
          initialHeight: CARD_HEIGHT,
          data: {
            summary: summaries.get(branch.id)!,
            active: branch.id === activeBranchId,
            onOpen: onOpenBranch,
            onToggleFold: toggleFold,
            onDelete: onDeleteBranch,
          },
          selected: branch.id === selectedId,
        };
      });
  }, [
    activeBranchId,
    onDeleteBranch,
    onOpenBranch,
    selectedId,
    snapshot.branches,
    snapshot.canvas.nodes,
    summaries,
    toggleFold,
    visibleIds,
  ]);

  const [nodes, setNodes, onNodesChange] = useNodesState<BranchFlowNode>(desiredNodes);
  useEffect(() => {
    setNodes((current) => {
      const currentPositions = new Map(
        current.map((node) => [node.id, node.position] as const),
      );
      return desiredNodes.map((node) => ({
        ...node,
        position: currentPositions.get(node.id) ?? node.position,
      }));
    });
  }, [desiredNodes, setNodes]);

  useEffect(() => {
    setSelectedId(activeBranchId);
  }, [activeBranchId]);

  useEffect(() => {
    persistedViewport.current = snapshot.canvas.viewport;
  }, [
    snapshot.canvas.viewport.x,
    snapshot.canvas.viewport.y,
    snapshot.canvas.viewport.zoom,
  ]);

  useEffect(() => {
    return () => {
      if (viewportTimer.current !== null) {
        window.clearTimeout(viewportTimer.current);
      }
    };
  }, []);

  const edges = useMemo<Edge[]>(
    () =>
      Object.values(snapshot.branches)
        .filter(
          (branch) =>
            branch.parentId &&
            visibleIds.has(branch.id) &&
            visibleIds.has(branch.parentId),
        )
        .map((branch) => ({
          id: `${branch.parentId}:${branch.id}`,
          source: branch.parentId!,
          target: branch.id,
          type: "smoothstep",
          animated: summaries.get(branch.id)?.isStreaming === true,
          style: { strokeWidth: 1.5 },
        })),
    [snapshot.branches, summaries, visibleIds],
  );

  const tidy = useCallback(() => {
    const graph = new dagre.graphlib.Graph();
    graph.setDefaultEdgeLabel(() => ({}));
    graph.setGraph({ rankdir: "LR", ranksep: 110, nodesep: 70, marginx: 40, marginy: 40 });
    for (const node of nodes) graph.setNode(node.id, { width: CARD_WIDTH, height: CARD_HEIGHT });
    for (const edge of edges) graph.setEdge(edge.source, edge.target);
    dagre.layout(graph);

    const patchNodes: NonNullable<ConversationCanvasPatch["nodes"]> = {};
    const nextNodes = nodes.map((node) => {
      const positioned = graph.node(node.id) as { x: number; y: number };
      const position = {
        x: positioned.x - CARD_WIDTH / 2,
        y: positioned.y - CARD_HEIGHT / 2,
      };
      patchNodes[node.id] = position;
      return { ...node, position };
    });
    setNodes(nextNodes);
    onPatchCanvas({ nodes: patchNodes });
    window.setTimeout(() => void flow.fitView({ padding: 0.18, duration: 280 }), 0);
  }, [edges, flow, nodes, onPatchCanvas, setNodes]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT"
      ) {
        return;
      }
      if (
        (event.key === "Delete" || event.key === "Backspace") &&
        selectedId !== snapshot.conversation.rootBranchId
      ) {
        event.preventDefault();
        onDeleteBranch(selectedId);
        return;
      }
      if (!event.altKey) return;
      const direction =
        event.key.toLowerCase() === "a"
          ? "left"
          : event.key.toLowerCase() === "d"
            ? "right"
            : event.key.toLowerCase() === "w"
              ? "up"
              : event.key.toLowerCase() === "s"
                ? "down"
                : null;
      if (event.key === "Enter") {
        event.preventDefault();
        onOpenBranch(selectedId);
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        toggleFold(selectedId);
        return;
      }
      if (!direction) return;
      event.preventDefault();
      const current = nodes.find((node) => node.id === selectedId);
      if (!current) return;
      const candidates = nodes.filter((node) => {
        if (node.id === selectedId) return false;
        if (direction === "left") return node.position.x < current.position.x;
        if (direction === "right") return node.position.x > current.position.x;
        if (direction === "up") return node.position.y < current.position.y;
        return node.position.y > current.position.y;
      });
      candidates.sort((left, right) => {
        const leftDistance =
          Math.abs(left.position.x - current.position.x) +
          Math.abs(left.position.y - current.position.y);
        const rightDistance =
          Math.abs(right.position.x - current.position.x) +
          Math.abs(right.position.y - current.position.y);
        return leftDistance - rightDistance;
      });
      const nearest = candidates[0];
      if (nearest) setSelectedId(nearest.id);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    nodes,
    onDeleteBranch,
    onOpenBranch,
    selectedId,
    snapshot.conversation.rootBranchId,
    toggleFold,
  ]);

  const persistViewport = useCallback(
    (viewport: Viewport) => {
      const previous = persistedViewport.current;
      if (
        Math.abs(previous.x - viewport.x) < 0.5 &&
        Math.abs(previous.y - viewport.y) < 0.5 &&
        Math.abs(previous.zoom - viewport.zoom) < 0.001
      ) {
        return;
      }
      if (viewportTimer.current !== null) window.clearTimeout(viewportTimer.current);
      viewportTimer.current = window.setTimeout(() => {
        viewportTimer.current = null;
        persistedViewport.current = viewport;
        onPatchCanvas({ viewport });
      }, 220);
    },
    [onPatchCanvas],
  );

  return (
    <div className={cn("canvas-flow h-full min-h-[420px] w-full", className)}>
      <ReactFlow<BranchFlowNode, Edge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={(_, node) => setSelectedId(node.id)}
        onNodeDoubleClick={(_, node) => onOpenBranch(node.id)}
        onNodeDragStop={(_, node) =>
          onPatchCanvas({
            focusedBranchId: node.id,
            nodes: { [node.id]: { x: node.position.x, y: node.position.y } },
          })
        }
        defaultViewport={snapshot.canvas.viewport}
        onMoveEnd={(_, viewport) => persistViewport(viewport)}
        nodesConnectable={false}
        edgesFocusable={false}
        deleteKeyCode={null}
        minZoom={0.25}
        maxZoom={1.75}
        fitViewOptions={{ padding: 0.18 }}
        onlyRenderVisibleElements
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
        <MiniMap
          pannable
          zoomable
          nodeStrokeWidth={2}
          className="border! border-border! bg-background!"
        />
        <Controls showInteractive={false} />
        <Panel position="top-right" className="flex items-center gap-2">
          <button
            type="button"
            onClick={tidy}
            className="inline-flex items-center gap-1.5 rounded border border-border bg-background px-2.5 py-1.5 text-[11px] font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
            Tidy
          </button>
          <span className="hidden rounded border border-border bg-background px-2 py-1.5 text-[10px] text-muted-foreground xl:inline">
            Alt+WASD · Alt+Enter · Alt+Space
          </span>
        </Panel>
      </ReactFlow>
    </div>
  );
}

export function ConversationCanvas(props: ConversationCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasFlow {...props} />
    </ReactFlowProvider>
  );
}
