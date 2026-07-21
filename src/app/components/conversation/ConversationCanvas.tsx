"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
  useUpdateNodeInternals,
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
import type { BranchSelectionDraft } from "@/app/components/conversation/BranchableMessage";
import { branchToneForId, type BranchTone } from "@/lib/conversation/branchTone";
import { cn } from "@/lib/utils";
import {
  GitBranch,
  LayoutGrid,
  Layers3,
  Loader2,
  Maximize2,
  MessageSquareText,
  Minimize2,
  Pencil,
  Send,
  Trash2,
  X,
} from "lucide-react";

const CARD_WIDTH = 310;
const CARD_HEIGHT = 190;
const EXPANDED_CARD_WIDTH = 680;
const EXPANDED_CARD_HEIGHT = 700;

type BranchCardSummary = {
  branch: Branch;
  latestPreview: string | null;
  descendantCount: number;
  messageCount: number;
  isStreaming: boolean;
  folded: boolean;
  expanded: boolean;
  tone: BranchTone;
  parentTitle: string | null;
};

type BranchNodeData = {
  summary: BranchCardSummary;
  active: boolean;
  loading: boolean;
  thread: ReactNode;
  onToggleCard: (branchId: BranchId) => void;
  onToggleFold: (branchId: BranchId) => void;
  onRename: (branchId: BranchId) => void;
  onDelete: (branchId: BranchId) => void;
};

type BranchFlowNode = Node<BranchNodeData, "branch">;

type BranchDraftNodeData = {
  draft: BranchSelectionDraft;
  parentTitle: string;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (prompt: string) => void;
};

interface ConversationCanvasProps {
  snapshot: ConversationGraphSnapshot;
  activeBranchId: BranchId;
  renderBranchThread: (branch: Branch, active: boolean) => ReactNode;
  isBranchLoading: (branchId: BranchId) => boolean;
  onOpenBranch: (branchId: BranchId) => void;
  onCollapseBranch: (branchId: BranchId) => void;
  onPatchCanvas: (patch: ConversationCanvasPatch) => void;
  onDeleteBranch: (branchId: BranchId) => void;
  onRenameBranch: (branchId: BranchId) => void;
  branchDraft: BranchSelectionDraft | null;
  isCreatingBranch: boolean;
  onCancelBranchDraft: () => void;
  onSubmitBranchDraft: (prompt: string) => void;
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
      onClick={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest('[data-card-interactive="true"]')) return;
        data.onToggleCard(summary.branch.id);
      }}
      className={cn(
        "group relative flex h-full w-full flex-col overflow-hidden rounded border bg-background text-left transition-[border-color,box-shadow]",
        data.active || selected
          ? "border-foreground ring-2 ring-ring"
          : "border-border hover:border-foreground/45",
        summary.expanded ? "cursor-default" : "cursor-pointer",
      )}
      style={{ borderLeftColor: summary.tone.color, borderLeftWidth: 4 }}
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

      <header className="canvas-card-drag-handle flex shrink-0 cursor-pointer items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.17em] text-muted-foreground">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: summary.tone.color }}
              aria-hidden="true"
            />
            <GitBranch className="h-3.5 w-3.5" aria-hidden="true" />
            {summary.branch.parentId ? "Branch" : "Root chat"}
          </div>
          <h2 className="mt-1 truncate text-sm font-semibold text-foreground">
            {summary.branch.title || "Untitled branch"}
          </h2>
          {summary.parentTitle ? (
            <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
              Child of {summary.parentTitle}
            </div>
          ) : null}
        </div>
        {summary.isStreaming ? (
          <span className="rounded border border-accent/45 bg-accent/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-accent-foreground">
            Live
          </span>
        ) : null}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            data.onRename(summary.branch.id);
          }}
          className="nodrag nopan ml-auto rounded border border-border p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-card-interactive="true"
          aria-label={`Rename ${summary.branch.title}`}
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        {summary.expanded && summary.descendantCount > 0 ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              data.onToggleFold(summary.branch.id);
            }}
            className="nodrag nopan rounded border border-border p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-card-interactive="true"
            aria-label={`${summary.folded ? "Unfold" : "Fold"} descendants of ${summary.branch.title}`}
          >
            <Layers3 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : null}
        {summary.expanded && summary.branch.parentId ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              data.onDelete(summary.branch.id);
            }}
            className="nodrag nopan rounded border border-destructive/35 p-1.5 text-destructive hover:bg-destructive hover:text-destructive-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
            data-card-interactive="true"
            aria-label={`Delete ${summary.branch.title}`}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            data.onToggleCard(summary.branch.id);
          }}
          className="nodrag nopan rounded border border-border p-1.5 text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-card-interactive="true"
          aria-label={`${summary.expanded ? "Collapse" : "Expand"} ${summary.branch.title}`}
        >
          {summary.expanded ? (
            <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>
      </header>

      {summary.expanded ? (
        <div className="nodrag nowheel nopan flex min-h-0 flex-1 flex-col" data-card-interactive="true">
          {data.loading ? (
            <div className="flex flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Loading chat…
            </div>
          ) : (
            data.thread
          )}
        </div>
      ) : (
        <div className="relative min-h-0 flex-1 px-4 py-3">
          {summary.branch.createdFrom.excerpt ? (
            <p className="line-clamp-2 rounded bg-muted/55 px-2 py-1 text-[11px] leading-4 text-muted-foreground">
              “{summary.branch.createdFrom.excerpt}”
            </p>
          ) : (
            <p className="line-clamp-2 text-xs leading-4 text-muted-foreground">
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
            <div className="nodrag nopan flex items-center gap-1" data-card-interactive="true">
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
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

function BranchDraftCard({ data }: { data: BranchDraftNodeData }) {
  const [prompt, setPrompt] = useState("");
  const excerpt = data.draft.excerpt.replace(/\s+/g, " ").trim();
  const preview = excerpt.length > 150 ? `${excerpt.slice(0, 147)}…` : excerpt;

  return (
    <article
      className="nodrag nopan flex h-full w-full flex-col overflow-hidden rounded border-2 border-dashed border-amber-500 bg-background text-left ring-4 ring-amber-500/10"
      aria-label="New branch draft"
      data-branch-draft-card="true"
    >
      <header className="flex shrink-0 items-start gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.17em] text-amber-700 dark:text-amber-300">
            <GitBranch className="h-3.5 w-3.5" aria-hidden="true" />
            New branch · not saved
          </div>
          <div className="mt-1 truncate text-xs text-muted-foreground">
            From {data.parentTitle}
          </div>
        </div>
        <button
          type="button"
          onClick={data.onCancel}
          disabled={data.pending}
          className="rounded border border-amber-500/35 bg-background p-1.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          aria-label="Close branch draft"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </header>
      <form
        className="flex min-h-0 flex-1 flex-col gap-3 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = prompt.trim();
          if (trimmed) data.onSubmit(trimmed);
        }}
      >
        <blockquote className="line-clamp-3 border-l-2 border-amber-500 pl-2 text-[11px] leading-4 text-muted-foreground">
          “{preview}”
        </blockquote>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Ask about this selection…"
          rows={4}
          autoFocus
          disabled={data.pending}
          className="nowheel min-h-0 flex-1 resize-none rounded border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-amber-500 focus:ring-2 focus:ring-amber-500/25 disabled:opacity-60"
        />
        <div className="flex items-center justify-between gap-3">
          <span className="text-[10px] leading-4 text-muted-foreground">
            Close or click the canvas to discard.
          </span>
          <button
            type="submit"
            disabled={data.pending || prompt.trim().length === 0}
            className="inline-flex shrink-0 items-center gap-1.5 rounded border border-amber-600 bg-amber-500 px-3 py-1.5 text-xs font-bold text-black hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {data.pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {data.pending ? "Creating…" : "Send & create"}
          </button>
        </div>
      </form>
    </article>
  );
}

const nodeTypes = { branch: BranchNode };

function CanvasFlow({
  snapshot,
  activeBranchId,
  renderBranchThread,
  isBranchLoading,
  onOpenBranch,
  onCollapseBranch,
  onPatchCanvas,
  onDeleteBranch,
  onRenameBranch,
  branchDraft,
  isCreatingBranch,
  onCancelBranchDraft,
  onSubmitBranchDraft,
  className,
}: ConversationCanvasProps) {
  const flow = useReactFlow<BranchFlowNode, Edge>();
  const updateNodeInternals = useUpdateNodeInternals();
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
        expanded: snapshot.canvas.nodes[branch.id]?.expanded === true,
        tone: branchToneForId(branch.id),
        parentTitle: branch.parentId
          ? snapshot.branches[branch.parentId]?.title || "Untitled branch"
          : null,
      });
    }
    return result;
  }, [childMap, folded, snapshot]);

  const toggleCard = useCallback(
    (branchId: BranchId) => {
      onCancelBranchDraft();
      const expanded = snapshot.canvas.nodes[branchId]?.expanded === true;
      if (expanded && selectedId === branchId) {
        onCollapseBranch(branchId);
        return;
      }
      setSelectedId(branchId);
      onOpenBranch(branchId);
    },
    [
      onCancelBranchDraft,
      onCollapseBranch,
      onOpenBranch,
      selectedId,
      snapshot.canvas.nodes,
    ],
  );

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
        const expanded = saved?.expanded === true;
        return {
          id: branch.id,
          type: "branch",
          position: { x: saved?.x ?? 0, y: saved?.y ?? 0 },
          initialWidth: expanded ? EXPANDED_CARD_WIDTH : CARD_WIDTH,
          initialHeight: expanded ? EXPANDED_CARD_HEIGHT : CARD_HEIGHT,
          style: {
            width: expanded ? EXPANDED_CARD_WIDTH : CARD_WIDTH,
            height: expanded ? EXPANDED_CARD_HEIGHT : CARD_HEIGHT,
          },
          data: {
            summary: summaries.get(branch.id)!,
            active: branch.id === selectedId,
            loading: isBranchLoading(branch.id),
            thread: expanded
              ? renderBranchThread(branch, branch.id === selectedId)
              : null,
            onToggleCard: toggleCard,
            onToggleFold: toggleFold,
            onRename: onRenameBranch,
            onDelete: onDeleteBranch,
          },
          selected: branch.id === selectedId,
        };
      });
  }, [
    activeBranchId,
    isBranchLoading,
    onDeleteBranch,
    onRenameBranch,
    onOpenBranch,
    renderBranchThread,
    selectedId,
    snapshot.branches,
    snapshot.canvas.nodes,
    summaries,
    toggleCard,
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


  const expansionSignature = useMemo(
    () =>
      Object.values(snapshot.canvas.nodes)
        .map((node) => `${node.branchId}:${node.expanded ? 1 : 0}`)
        .sort()
        .join("|"),
    [snapshot.canvas.nodes],
  );
  useEffect(() => {
    for (const branchId of Object.keys(snapshot.branches)) {
      updateNodeInternals(branchId);
    }
  }, [expansionSignature, snapshot.branches, updateNodeInternals]);

  useEffect(() => {
    setSelectedId(snapshot.canvas.focusedBranchId ?? activeBranchId);
  }, [activeBranchId, snapshot.canvas.focusedBranchId]);

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

  const edges = useMemo<Edge[]>(() => {
    const branchEdges: Edge[] = Object.values(snapshot.branches)
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
          style: {
            stroke: branchToneForId(branch.id).color,
            strokeWidth: 2,
          },
        }));
    return branchEdges;
  }, [snapshot.branches, summaries, visibleIds]);

  const tidy = useCallback(() => {
    const graph = new dagre.graphlib.Graph();
    graph.setDefaultEdgeLabel(() => ({}));
    graph.setGraph({ rankdir: "LR", ranksep: 110, nodesep: 70, marginx: 40, marginy: 40 });
    for (const node of nodes) {
      const expanded = node.data.summary.expanded;
      graph.setNode(node.id, {
        width: expanded ? EXPANDED_CARD_WIDTH : CARD_WIDTH,
        height: expanded ? EXPANDED_CARD_HEIGHT : CARD_HEIGHT,
      });
    }
    for (const edge of edges) graph.setEdge(edge.source, edge.target);
    dagre.layout(graph);

    const patchNodes: NonNullable<ConversationCanvasPatch["nodes"]> = {};
    const nextNodes = nodes.map((node) => {
      const positioned = graph.node(node.id) as { x: number; y: number };
      const expanded = node.data.summary.expanded;
      const width = expanded ? EXPANDED_CARD_WIDTH : CARD_WIDTH;
      const height = expanded ? EXPANDED_CARD_HEIGHT : CARD_HEIGHT;
      const position = {
        x: positioned.x - width / 2,
        y: positioned.y - height / 2,
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
        if (event.key === "Escape" && branchDraft && !isCreatingBranch) {
          event.preventDefault();
          onCancelBranchDraft();
        }
        return;
      }
      if (event.key === "Escape" && branchDraft && !isCreatingBranch) {
        event.preventDefault();
        onCancelBranchDraft();
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
      if (
        event.key === "Escape" &&
        snapshot.canvas.nodes[selectedId]?.expanded
      ) {
        event.preventDefault();
        onCollapseBranch(selectedId);
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
        toggleCard(selectedId);
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
    branchDraft,
    isCreatingBranch,
    nodes,
    onCancelBranchDraft,
    onDeleteBranch,
    onCollapseBranch,
    selectedId,
    snapshot.conversation.rootBranchId,
    snapshot.canvas.nodes,
    toggleCard,
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
    <div className={cn("canvas-flow relative h-full min-h-[420px] w-full", className)}>
      <ReactFlow<BranchFlowNode, Edge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={(_, node) => {
          if (node.type !== "branch") return;
          onPatchCanvas({
            focusedBranchId: node.id,
            nodes: { [node.id]: { x: node.position.x, y: node.position.y } },
          });
        }}
        onPaneClick={() => {
          if (branchDraft && !isCreatingBranch) onCancelBranchDraft();
        }}
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
      {branchDraft && snapshot.branches[branchDraft.parentBranchId] ? (
        <div className="absolute right-4 top-16 z-40 h-[300px] w-[360px] max-w-[calc(100%-2rem)]">
          <BranchDraftCard
            data={{
              draft: branchDraft,
              parentTitle:
                snapshot.branches[branchDraft.parentBranchId]?.title ||
                "Untitled branch",
              pending: isCreatingBranch,
              onCancel: onCancelBranchDraft,
              onSubmit: onSubmitBranchDraft,
            }}
          />
        </div>
      ) : null}
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
