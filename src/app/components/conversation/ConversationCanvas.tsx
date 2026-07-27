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
  NodeResizer,
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
import { arrangeFocusedChildOnCanvas } from "@/lib/conversation";
import type { BranchSelectionDraft } from "@/app/components/conversation/BranchableMessage";
import {
  branchToneForBranch,
  type BranchTone,
} from "@/lib/conversation/branchTone";
import { cn } from "@/lib/utils";
import {
  GitBranch,
  CornerUpRight,
  LayoutGrid,
  Layers3,
  Loader2,
  Maximize2,
  MessageSquareText,
  Minimize2,
  Pencil,
  Trash2,
  X,
} from "lucide-react";

const CARD_WIDTH = 310;
const CARD_HEIGHT = 190;
const EXPANDED_CARD_WIDTH = 680;
const EXPANDED_CARD_HEIGHT = 700;
const MIN_EXPANDED_CARD_WIDTH = 420;
const MIN_EXPANDED_CARD_HEIGHT = 320;
const MAX_EXPANDED_CARD_WIDTH = 1_200;
const MAX_EXPANDED_CARD_HEIGHT = 1_000;
const DRAFT_NODE_ID = "__branch-draft__";
const DRAFT_CARD_WIDTH = 420;
const DRAFT_CARD_HEIGHT = 360;

type BranchCardSummary = {
  branch: Branch;
  isEmptyRoot: boolean;
  latestPreview: string | null;
  descendantCount: number;
  messageCount: number;
  isStreaming: boolean;
  folded: boolean;
  expanded: boolean;
  tone: BranchTone | null;
  parentTitle: string | null;
  branchSource: Message | null;
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
  onStartBranchDraft: (branchId: BranchId, source: Message) => void;
  onResizeCard: (
    branchId: BranchId,
    bounds: { x: number; y: number; width: number; height: number },
  ) => void;
};

type BranchFlowNode = Node<BranchNodeData, "branch">;

type BranchDraftNodeData = {
  editor: ReactNode;
};

type BranchDraftFlowNode = Node<BranchDraftNodeData, "branchDraft">;
type CanvasFlowNode = BranchFlowNode | BranchDraftFlowNode;

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
  onStartBranchDraft: (draft: BranchSelectionDraft) => void;
  branchDraft: BranchSelectionDraft | null;
  isCreatingBranch: boolean;
  onCancelBranchDraft: () => void;
  renderBranchDraft: (
    draft: BranchSelectionDraft,
    onCancel: () => void,
  ) => ReactNode;
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
  const sourceQuote = summary.branch.createdFrom.excerpt?.trim() || null;
  const headerTitle = sourceQuote || summary.branch.title || "Untitled branch";
  const preview = summary.latestPreview
    ? summary.latestPreview.length > 145
      ? `${summary.latestPreview.slice(0, 142)}…`
      : summary.latestPreview
    : "No messages yet.";

  return (
    <>
      <NodeResizer
        isVisible={summary.expanded}
        minWidth={MIN_EXPANDED_CARD_WIDTH}
        minHeight={MIN_EXPANDED_CARD_HEIGHT}
        maxWidth={MAX_EXPANDED_CARD_WIDTH}
        maxHeight={MAX_EXPANDED_CARD_HEIGHT}
        lineStyle={{ borderColor: "var(--foreground)", opacity: 0.28 }}
        handleStyle={{
          width: 8,
          height: 8,
          borderRadius: 2,
          border: "1px solid var(--background)",
          background: "var(--foreground)",
        }}
        onResizeEnd={(_, bounds) =>
          data.onResizeCard(summary.branch.id, bounds)
        }
      />
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
        style={
          summary.tone
            ? { borderLeftColor: summary.tone.color, borderLeftWidth: 4 }
            : undefined
        }
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
      <Handle
        id="draft-source"
        type="source"
        position={Position.Right}
        isConnectable={false}
        className="pointer-events-none! h-2! w-2! border-0! bg-amber-500!"
        style={{ top: 24 }}
      />

      {summary.folded && summary.descendantCount > 0 ? (
        <>
          <span className="pointer-events-none absolute -bottom-2 left-3 right-3 -z-10 h-5 rounded border border-border bg-muted" />
          <span className="pointer-events-none absolute -bottom-4 left-6 right-6 -z-20 h-5 rounded border border-border/70 bg-muted/70" />
        </>
      ) : null}

      <header className="canvas-card-drag-handle flex shrink-0 cursor-pointer items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.17em] text-muted-foreground">
            {summary.tone ? (
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: summary.tone.color }}
                aria-hidden="true"
              />
            ) : null}
            <GitBranch className="h-3.5 w-3.5" aria-hidden="true" />
            {summary.branch.parentId ? "Branch" : "Root chat"}
          </div>
          <h2
            className={cn(
              "mt-1 truncate text-sm font-semibold text-foreground",
              sourceQuote && "cursor-help",
            )}
            title={sourceQuote ? `“${sourceQuote}”` : headerTitle}
          >
            {sourceQuote ? `“${sourceQuote}”` : headerTitle}
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
        {!summary.isEmptyRoot ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              if (summary.branchSource) {
                data.onStartBranchDraft(summary.branch.id, summary.branchSource);
              }
            }}
            disabled={!summary.branchSource}
            className="nodrag nopan ml-auto rounded border border-border p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-35"
            data-card-interactive="true"
            aria-label={`Start a child branch from ${summary.branch.title}`}
            title="Start child branch"
          >
            <CornerUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            data.onRename(summary.branch.id);
          }}
          className="nodrag nopan rounded border border-border p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
    </>
  );
}

function BranchDraftCard({ data }: { data: BranchDraftNodeData }) {
  return (
    <article
      className="nodrag nopan flex h-full w-full flex-col overflow-visible rounded border border-amber-500 bg-background text-left ring-2 ring-amber-500/10"
      aria-label="New branch draft"
      data-branch-draft-card="true"
    >
      <Handle
        id="draft-target"
        type="target"
        position={Position.Left}
        isConnectable={false}
        className="pointer-events-none! h-2! w-2! border-0! bg-amber-500!"
        style={{ top: 24 }}
      />
      <div className="min-h-0 flex-1">{data.editor}</div>
    </article>
  );
}

const nodeTypes = { branch: BranchNode, branchDraft: BranchDraftCard };

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
  onStartBranchDraft,
  branchDraft,
  isCreatingBranch,
  onCancelBranchDraft,
  renderBranchDraft,
  className,
}: ConversationCanvasProps) {
  const flow = useReactFlow<CanvasFlowNode, Edge>();
  const updateNodeInternals = useUpdateNodeInternals();
  const viewportTimer = useRef<number | null>(null);
  const persistedViewport = useRef(snapshot.canvas.viewport);
  const draftViewportRef = useRef<{
    key: string;
    focusedBranchId: BranchId | null;
    parentBranchId: BranchId;
    viewport: Viewport;
  } | null>(null);
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
  const draftLayout = useMemo(
    () =>
      branchDraft && snapshot.branches[branchDraft.parentBranchId]
        ? arrangeFocusedChildOnCanvas(
            snapshot,
            branchDraft.parentBranchId,
            DRAFT_NODE_ID,
          )
        : null,
    [branchDraft, snapshot],
  );

  const summaries = useMemo(() => {
    const result = new Map<BranchId, BranchCardSummary>();
    for (const branch of Object.values(snapshot.branches)) {
      const messages = branchMessages(snapshot, branch.id);
      const messageCount = messages.filter(
        (message) => message.role !== "system",
      ).length;
      const last = messages[messages.length - 1];
      const latest = [...messages]
        .reverse()
        .find((message) => message.role !== "system" && message.content.trim());
      const branchSource = [...messages]
        .reverse()
        .find((message) => message.role === "assistant" && message.content.trim());
      result.set(branch.id, {
        branch,
        isEmptyRoot:
          branch.id === snapshot.conversation.rootBranchId && messageCount === 0,
        latestPreview: latest?.content ?? null,
        descendantCount: descendantCount(branch.id, childMap),
        messageCount,
        isStreaming: Boolean(
          last?.role === "assistant" &&
            !last.tokenUsage &&
            last.content.trim().length === 0,
        ),
        folded: folded[branch.id] === true,
        expanded:
          draftLayout?.[branch.id]?.expanded ??
          (snapshot.canvas.nodes[branch.id]?.expanded === true),
        tone: branchToneForBranch(snapshot, branch.id),
        parentTitle: branch.parentId
          ? snapshot.branches[branch.parentId]?.title || "Untitled branch"
          : null,
        branchSource: branchSource ?? null,
      });
    }
    return result;
  }, [childMap, draftLayout, folded, snapshot]);

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

  const startBranchDraft = useCallback(
    (branchId: BranchId, source: Message) => {
      const excerpt =
        source.content.length > 280
          ? `${source.content.slice(0, 277)}…`
          : source.content;
      onStartBranchDraft({
        parentBranchId: branchId,
        messageId: source.id,
        excerpt,
        characterCount: excerpt.length,
        blockCount: 1,
      });
    },
    [onStartBranchDraft],
  );

  const resizeCard = useCallback(
    (
      branchId: BranchId,
      bounds: { x: number; y: number; width: number; height: number },
    ) => {
      setSelectedId(branchId);
      onPatchCanvas({
        focusedBranchId: branchId,
        nodes: { [branchId]: bounds },
      });
    },
    [onPatchCanvas],
  );

  const desiredNodes = useMemo<CanvasFlowNode[]>(() => {
    const branchNodes: BranchFlowNode[] = Object.values(snapshot.branches)
      .filter((branch) => visibleIds.has(branch.id))
      .map((branch) => {
        const saved = snapshot.canvas.nodes[branch.id];
        const draftUpdate = draftLayout?.[branch.id];
        const expanded = draftUpdate?.expanded ?? (saved?.expanded === true);
        const isEmptyRoot =
          branch.id === snapshot.conversation.rootBranchId &&
          summaries.get(branch.id)?.messageCount === 0;
        const width = expanded
          ? saved?.width ?? (isEmptyRoot ? DRAFT_CARD_WIDTH : EXPANDED_CARD_WIDTH)
          : CARD_WIDTH;
        const height = expanded
          ? saved?.height ?? (isEmptyRoot ? DRAFT_CARD_HEIGHT : EXPANDED_CARD_HEIGHT)
          : CARD_HEIGHT;
        return {
          id: branch.id,
          type: "branch",
          position: {
            x: draftUpdate?.x ?? saved?.x ?? 0,
            y: draftUpdate?.y ?? saved?.y ?? 0,
          },
          initialWidth: width,
          initialHeight: height,
          style: { width, height },
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
            onStartBranchDraft: startBranchDraft,
            onResizeCard: resizeCard,
          },
          selected: branch.id === selectedId,
        };
      });
    if (!branchDraft || !snapshot.branches[branchDraft.parentBranchId]) {
      return branchNodes;
    }
    const draftPosition = draftLayout?.[DRAFT_NODE_ID];
    const draftNode: BranchDraftFlowNode = {
      id: DRAFT_NODE_ID,
      type: "branchDraft",
      position: {
        x: draftPosition?.x ?? 0,
        y: draftPosition?.y ?? 0,
      },
      initialWidth: DRAFT_CARD_WIDTH,
      initialHeight: DRAFT_CARD_HEIGHT,
      style: { width: DRAFT_CARD_WIDTH, height: DRAFT_CARD_HEIGHT },
      draggable: false,
      selectable: true,
      data: {
        editor: renderBranchDraft(branchDraft, onCancelBranchDraft),
      },
    };
    return [...branchNodes, draftNode];
  }, [
    activeBranchId,
    isBranchLoading,
    onDeleteBranch,
    onRenameBranch,
    branchDraft,
    draftLayout,
    isCreatingBranch,
    onCancelBranchDraft,
    renderBranchDraft,
    renderBranchThread,
    resizeCard,
    selectedId,
    snapshot.branches,
    snapshot.canvas.nodes,
    summaries,
    startBranchDraft,
    toggleCard,
    toggleFold,
    visibleIds,
  ]);

  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasFlowNode>(desiredNodes);
  useEffect(() => {
    setNodes((current) => {
      const hasDraft = desiredNodes.some((node) => node.id === DRAFT_NODE_ID);
      const hadDraft = current.some((node) => node.id === DRAFT_NODE_ID);
      const currentPositions = new Map(
        current.map((node) => [node.id, node.position] as const),
      );
      return desiredNodes.map((node) => ({
        ...node,
        position:
          hasDraft || hadDraft
            ? node.position
            : currentPositions.get(node.id) ?? node.position,
      }));
    });
  }, [desiredNodes, setNodes]);

  useEffect(() => {
    if (!branchDraft) {
      const draftSession = draftViewportRef.current;
      if (!draftSession) return;
      const focusedBranchId = snapshot.canvas.focusedBranchId;
      const createdChildId =
        focusedBranchId && focusedBranchId !== draftSession.focusedBranchId
          ? focusedBranchId
          : null;
      if (!createdChildId) {
        draftViewportRef.current = null;
        const frame = window.requestAnimationFrame(() => {
          void flow.setViewport(draftSession.viewport, { duration: 220 });
        });
        return () => window.cancelAnimationFrame(frame);
      }
      const createdChildState = snapshot.canvas.nodes[createdChildId];
      if (!createdChildState) return;
      draftViewportRef.current = null;
      const frame = window.requestAnimationFrame(() => {
        setSelectedId(createdChildId);
        const parent = flow.getNode(draftSession.parentBranchId);
        const child = flow.getNode(createdChildId);
        if (parent && child) {
          void flow.fitView({
            nodes: [parent, child],
            padding: 0.18,
            duration: 300,
            maxZoom: 1,
          });
          return;
        }
        void flow.fitBounds(
          {
            x: createdChildState.x,
            y: createdChildState.y,
            width: createdChildState.width ?? EXPANDED_CARD_WIDTH,
            height: createdChildState.height ?? EXPANDED_CARD_HEIGHT,
          },
          { padding: 0.14, duration: 300 },
        );
      });
      return () => window.cancelAnimationFrame(frame);
    }
    const draftKey = `${branchDraft.parentBranchId}:${branchDraft.messageId}`;
    if (draftViewportRef.current?.key !== draftKey) {
      draftViewportRef.current = {
        key: draftKey,
        focusedBranchId: snapshot.canvas.focusedBranchId,
        parentBranchId: branchDraft.parentBranchId,
        viewport: flow.getViewport(),
      };
    }
    const frame = window.requestAnimationFrame(() => {
      const parent = flow.getNode(branchDraft.parentBranchId);
      const draft = flow.getNode(DRAFT_NODE_ID);
      if (!parent || !draft) return;
      void flow.fitView({
        nodes: [parent, draft],
        padding: 0.18,
        duration: 220,
        maxZoom: 1,
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [branchDraft, flow, nodes.length, snapshot.canvas.focusedBranchId]);


  const expansionSignature = useMemo(
    () =>
      Object.values(snapshot.canvas.nodes)
        .map(
          (node) =>
            `${node.branchId}:${node.expanded ? 1 : 0}:${node.width ?? ""}:${node.height ?? ""}`,
        )
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
            stroke:
              branchToneForBranch(snapshot, branch.id)?.color ??
              "var(--border)",
            strokeWidth: 2,
          },
        }));
    if (branchDraft && snapshot.branches[branchDraft.parentBranchId]) {
      branchEdges.push({
        id: `${branchDraft.parentBranchId}:${DRAFT_NODE_ID}`,
        source: branchDraft.parentBranchId,
        sourceHandle: "draft-source",
        target: DRAFT_NODE_ID,
        targetHandle: "draft-target",
        type: "smoothstep",
        animated: true,
        style: { stroke: "#f59e0b", strokeWidth: 2 },
      });
    }
    return branchEdges;
  }, [branchDraft, snapshot.branches, summaries, visibleIds]);

  const tidy = useCallback(() => {
    const graph = new dagre.graphlib.Graph();
    graph.setDefaultEdgeLabel(() => ({}));
    graph.setGraph({ rankdir: "LR", ranksep: 110, nodesep: 70, marginx: 40, marginy: 40 });
    const branchNodes = nodes.filter(
      (node): node is BranchFlowNode => node.type === "branch",
    );
    for (const node of branchNodes) {
      const expanded = node.data.summary.expanded;
      const saved = snapshot.canvas.nodes[node.id];
      const isEmptyRoot =
        node.id === snapshot.conversation.rootBranchId &&
        node.data.summary.messageCount === 0;
      graph.setNode(node.id, {
        width: expanded
          ? saved?.width ?? (isEmptyRoot ? DRAFT_CARD_WIDTH : EXPANDED_CARD_WIDTH)
          : CARD_WIDTH,
        height: expanded
          ? saved?.height ?? (isEmptyRoot ? DRAFT_CARD_HEIGHT : EXPANDED_CARD_HEIGHT)
          : CARD_HEIGHT,
      });
    }
    for (const edge of edges) {
      if (edge.target !== DRAFT_NODE_ID) graph.setEdge(edge.source, edge.target);
    }
    dagre.layout(graph);

    const patchNodes: NonNullable<ConversationCanvasPatch["nodes"]> = {};
    const nextNodes = branchNodes.map((node) => {
      const positioned = graph.node(node.id) as { x: number; y: number };
      const expanded = node.data.summary.expanded;
      const saved = snapshot.canvas.nodes[node.id];
      const isEmptyRoot =
        node.id === snapshot.conversation.rootBranchId &&
        node.data.summary.messageCount === 0;
      const width = expanded
        ? saved?.width ?? (isEmptyRoot ? DRAFT_CARD_WIDTH : EXPANDED_CARD_WIDTH)
        : CARD_WIDTH;
      const height = expanded
        ? saved?.height ?? (isEmptyRoot ? DRAFT_CARD_HEIGHT : EXPANDED_CARD_HEIGHT)
        : CARD_HEIGHT;
      const position = {
        x: positioned.x - width / 2,
        y: positioned.y - height / 2,
      };
      patchNodes[node.id] = position;
      return { ...node, position };
    });
    setNodes((current) => [
      ...nextNodes,
      ...current.filter((node) => node.type === "branchDraft"),
    ]);
    onPatchCanvas({ nodes: patchNodes });
    window.setTimeout(() => void flow.fitView({ padding: 0.18, duration: 280 }), 0);
  }, [edges, flow, nodes, onPatchCanvas, setNodes, snapshot.canvas.nodes, snapshot.conversation.rootBranchId]);

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
      <ReactFlow<CanvasFlowNode, Edge>
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
