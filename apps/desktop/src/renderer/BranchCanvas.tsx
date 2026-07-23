import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  type Edge,
  type Node,
  type NodeProps,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  branchToneForBranch,
  type Branch,
  type BranchId,
  type ConversationCanvasPatch,
  type ConversationGraphSnapshot,
} from "@branchy/conversation-core";
import type { RenderedMessage } from "@branchy/conversation-core/presentation";

import { BranchCompareDialog } from "./BranchCompareDialog.tsx";
import { Composer } from "./Composer.tsx";
import { Icon } from "./icons.tsx";
import { MessageBubble } from "./MessageBubble.tsx";
import {
  branchToFocusBeforeFold,
  descendantCount,
  isSupersededByActiveStream,
  messagesForBranch,
  parentComparisonForBranch,
  visibleBranchIds,
} from "./state.ts";
import type {
  AttachmentDraft,
  BranchSelectionDraft,
  StreamState,
} from "./types.ts";

type BranchNodeData = {
  branch: Branch;
  snapshot: ConversationGraphSnapshot;
  messages: RenderedMessage[];
  stream: StreamState | null;
  active: boolean;
  expanded: boolean;
  folded: boolean;
  toneColor: string | null;
  childCount: number;
  draft: string;
  attachments: AttachmentDraft[];
  signedIn: boolean;
  focusToken: number;
  onOpen: (branchId: BranchId) => void;
  onToggleFold: (branchId: BranchId) => void;
  onCompareParent: (branchId: BranchId) => void;
  onRename: (branchId: BranchId) => void;
  onDelete: (branchId: BranchId) => void;
  onCreateBranch: (draft: BranchSelectionDraft) => void;
  onChangeDraft: (branchId: BranchId, value: string) => void;
  onSend: (branchId: BranchId) => void;
  onStop: (branchId: BranchId) => void;
  onChooseFiles: (branchId: BranchId, files: File[]) => void;
  onRemoveAttachment: (branchId: BranchId, attachmentId: string) => void;
  onTranscribe: (
    audio: Uint8Array,
    contentType: string,
  ) => Promise<string>;
  onDownloadImage: (messageId: string, imageId: string) => void;
  onRetryImage: (
    branchId: BranchId,
    messageId: string,
    imageId: string,
    prompt: string,
  ) => void;
  onOpenExternal: (url: string) => void;
  resolveImageUrl: (
    messageId: string,
    imageId: string,
    fallback: string | null,
  ) => string | null;
};

type BranchFlowNode = Node<BranchNodeData, "branch">;

function latestPreview(messages: RenderedMessage[]): string {
  const latest = [...messages]
    .reverse()
    .find((message) => message.content.trim().length > 0);
  if (!latest) return "No messages yet.";
  const compact = latest.content.trim().replace(/\s+/g, " ");
  return compact.length > 140 ? `${compact.slice(0, 137)}…` : compact;
}

function StreamBubble({
  stream,
}: {
  stream: StreamState;
}): React.JSX.Element {
  const generating =
    stream.status === "generating_image" ||
    stream.status === "saving_image";
  return (
    <article className="message message--assistant stream-message" role="status">
      <div className="message__role">Branchy</div>
      <div className="message__body">
        {stream.reasoningSummary ? (
          <details className="reasoning-summary">
            <summary>Reasoning</summary>
            <p>{stream.reasoningSummary}</p>
          </details>
        ) : null}
        {stream.text ? (
          <div className="message__text">
            {stream.text}
            {stream.status === "streaming" ? (
              <span className="stream-caret" aria-hidden="true" />
            ) : null}
          </div>
        ) : !generating ? (
          <div className="thinking-row">
            <span className="thinking-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span>{stream.toolProgress ?? "Branchy is thinking…"}</span>
          </div>
        ) : null}

        {generating ? (
          <div className="image-progress image-progress--stream">
            <div className="image-progress__wash" />
            <div className="image-progress__content">
              <span className="image-progress__icon">
                <Icon name="image" size={23} />
                <span className="spinner spinner--large" />
              </span>
              <strong>
                {stream.status === "saving_image"
                  ? "Finishing your image…"
                  : "Creating your image…"}
              </strong>
              <span>You can keep exploring this canvas.</span>
            </div>
          </div>
        ) : null}

        {stream.status === "error" ? (
          <div className="inline-error" role="alert">
            <Icon name="info" size={16} />
            {stream.error}
          </div>
        ) : null}
      </div>
    </article>
  );
}

const BranchCard = memo(function BranchCard({
  data,
}: NodeProps<BranchFlowNode>): React.JSX.Element {
  const {
    branch,
    messages,
    stream,
    expanded,
    folded,
    active,
    toneColor,
  } = data;
  const threadRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const title = branch.title || "Untitled branch";
  const visibleMessages = messages.filter(
    (message) => !isSupersededByActiveStream(message, stream),
  );
  const sourceExcerpt = branch.createdFrom.excerpt?.trim();
  const parentTitle = branch.parentId
    ? data.snapshot.branches[branch.parentId]?.title ?? "Parent branch"
    : null;

  useEffect(() => {
    if (!expanded || !threadRef.current || !stream) return;
    threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [expanded, stream?.text, stream?.status]);

  return (
    <article
      className={`branch-card ${expanded ? "is-expanded" : ""} ${
        active ? "is-active" : ""
      }`}
      style={
        {
          "--branch-tone": toneColor ?? "var(--foreground)",
        } as React.CSSProperties
      }
    >
      <Handle
        className="branch-handle branch-handle--target"
        type="target"
        position={Position.Left}
        isConnectable={false}
      />
      <Handle
        className="branch-handle branch-handle--source"
        type="source"
        position={Position.Right}
        isConnectable={false}
      />

      <header className="branch-card__header">
        <button
          className="branch-card__identity nodrag"
          type="button"
          onClick={() => data.onOpen(branch.id)}
          aria-label={`${expanded ? "Focus" : "Open"} ${title}`}
        >
          <span
            className="branch-card__tone"
            aria-hidden="true"
          />
          <span className="branch-card__heading">
            {parentTitle ? (
              <span className="branch-card__parent">
                Child of {parentTitle}
                {sourceExcerpt
                  ? ` · From “${sourceExcerpt.slice(0, 48)}${
                      sourceExcerpt.length > 48 ? "…" : ""
                    }”`
                  : ""}
              </span>
            ) : (
              <span className="branch-card__parent">Root conversation</span>
            )}
            <strong title={title}>{title}</strong>
          </span>
        </button>

        <div className="branch-card__actions nodrag">
          {data.childCount > 0 ? (
            <button
              className="icon-button icon-button--quiet"
              type="button"
              aria-label={
                folded
                  ? `Show ${data.childCount} descendant branches`
                  : `Fold ${data.childCount} descendant branches`
              }
              title={folded ? "Show descendants" : "Fold descendants"}
              onClick={() => data.onToggleFold(branch.id)}
            >
              <Icon
                name={folded ? "chevron-right" : "chevron-down"}
                size={16}
              />
            </button>
          ) : null}
          <div className="menu-anchor">
            <button
              className="icon-button icon-button--quiet"
              type="button"
              aria-label={`More actions for ${title}`}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((current) => !current)}
            >
              <Icon name="more" size={17} />
            </button>
            {menuOpen ? (
              <div className="context-menu">
                {branch.parentId ? (
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    onClick={() => {
                      setMenuOpen(false);
                      data.onCompareParent(branch.id);
                    }}
                  >
                    <Icon name="branch" size={15} />
                    Compare with parent
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    data.onRename(branch.id);
                  }}
                >
                  <Icon name="pencil" size={15} />
                  Rename
                </button>
                {branch.parentId ? (
                  <button
                    className="is-danger"
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      data.onDelete(branch.id);
                    }}
                  >
                    <Icon name="trash" size={15} />
                    Delete branch
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {expanded ? (
        <>
          <div className="branch-thread nowheel nodrag" ref={threadRef}>
            {visibleMessages.length === 0 && !stream ? (
              <div className="branch-empty">
                <span className="branch-empty__mark">
                  <Icon name="branch" size={22} />
                </span>
                <strong>Start this branch</strong>
                <span>Every path keeps its own context.</span>
              </div>
            ) : (
              visibleMessages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  branchId={branch.id}
                  toneColor={toneColor}
                  onCreateBranch={data.onCreateBranch}
                  onOpenBranch={data.onOpen}
                  onDownloadImage={data.onDownloadImage}
                  onRetryImage={(messageId, imageId, prompt) =>
                    data.onRetryImage(
                      branch.id,
                      messageId,
                      imageId,
                      prompt,
                    )
                  }
                  onOpenExternal={data.onOpenExternal}
                  resolveImageUrl={data.resolveImageUrl}
                />
              ))
            )}
            {stream &&
            stream.status !== "complete" &&
            stream.status !== "cancelled" ? (
              <StreamBubble stream={stream} />
            ) : null}
          </div>
          <div className="branch-card__composer nodrag nowheel">
            <Composer
              branchTitle={title}
              value={data.draft}
              attachments={data.attachments}
              disabled={!data.signedIn}
              streaming={
                Boolean(stream) &&
                stream?.status !== "complete" &&
                stream?.status !== "cancelled" &&
                stream?.status !== "error"
              }
              focusToken={data.focusToken}
              onChange={(value) => data.onChangeDraft(branch.id, value)}
              onSend={() => data.onSend(branch.id)}
              onStop={() => data.onStop(branch.id)}
              onChooseFiles={(files) => data.onChooseFiles(branch.id, files)}
              onRemoveAttachment={(attachmentId) =>
                data.onRemoveAttachment(branch.id, attachmentId)
              }
              onTranscribe={data.onTranscribe}
            />
          </div>
        </>
      ) : (
        <button
          className="branch-card__preview nodrag"
          type="button"
          onClick={() => data.onOpen(branch.id)}
        >
          <p>{latestPreview(visibleMessages)}</p>
          <footer>
            <span>
              {visibleMessages.length}{" "}
              {visibleMessages.length === 1 ? "message" : "messages"}
            </span>
            {stream ? (
              <span className="branch-card__live">
                <span className="spinner" />
                Working
              </span>
            ) : null}
            {data.childCount > 0 ? (
              <span>
                {data.childCount}{" "}
                {data.childCount === 1 ? "descendant" : "descendants"}
              </span>
            ) : null}
          </footer>
        </button>
      )}
    </article>
  );
});

type BranchCanvasProps = {
  snapshot: ConversationGraphSnapshot;
  activeBranchId: BranchId;
  messagesByBranch: Record<BranchId, RenderedMessage[]>;
  streamsByBranch: Record<BranchId, StreamState | undefined>;
  draftsByBranch: Record<BranchId, string | undefined>;
  attachmentsByBranch: Record<BranchId, AttachmentDraft[] | undefined>;
  focusTokensByBranch: Record<BranchId, number | undefined>;
  signedIn: boolean;
  onOpenBranch: (branchId: BranchId) => void;
  onJumpToRoot?: (rootBranchId: BranchId) => void;
  onCompareParent?: (
    childBranchId: BranchId,
    parentBranchId: BranchId,
  ) => void;
  onPatchCanvas: (patch: ConversationCanvasPatch) => void;
  onRenameBranch: (branchId: BranchId) => void;
  onDeleteBranch: (branchId: BranchId) => void;
  onCreateBranch: (draft: BranchSelectionDraft) => void;
  onChangeDraft: (branchId: BranchId, value: string) => void;
  onSend: (branchId: BranchId) => void;
  onStop: (branchId: BranchId) => void;
  onChooseFiles: (branchId: BranchId, files: File[]) => void;
  onRemoveAttachment: (branchId: BranchId, attachmentId: string) => void;
  onTranscribe: (
    audio: Uint8Array,
    contentType: string,
  ) => Promise<string>;
  onDownloadImage: (messageId: string, imageId: string) => void;
  onRetryImage: (
    branchId: BranchId,
    messageId: string,
    imageId: string,
    prompt: string,
  ) => void;
  onOpenExternal: (url: string) => void;
  resolveImageUrl: (
    messageId: string,
    imageId: string,
    fallback: string | null,
  ) => string | null;
};

function BranchCanvasInner({
  snapshot,
  activeBranchId,
  messagesByBranch,
  streamsByBranch,
  draftsByBranch,
  attachmentsByBranch,
  focusTokensByBranch,
  signedIn,
  onOpenBranch,
  onJumpToRoot,
  onCompareParent,
  onPatchCanvas,
  onRenameBranch,
  onDeleteBranch,
  onCreateBranch,
  onChangeDraft,
  onSend,
  onStop,
  onChooseFiles,
  onRemoveAttachment,
  onTranscribe,
  onDownloadImage,
  onRetryImage,
  onOpenExternal,
  resolveImageUrl,
}: BranchCanvasProps): React.JSX.Element {
  const [compareBranchId, setCompareBranchId] =
    useState<BranchId | null>(null);
  const visible = useMemo(() => visibleBranchIds(snapshot), [snapshot]);
  const activeBranch = snapshot.branches[activeBranchId] ?? null;
  const rootBranchId = snapshot.conversation.rootBranchId;
  const comparison = useMemo(
    () =>
      compareBranchId
        ? parentComparisonForBranch(
            snapshot,
            messagesByBranch,
            compareBranchId,
          )
        : null,
    [compareBranchId, messagesByBranch, snapshot],
  );

  useEffect(() => {
    if (compareBranchId && !comparison) setCompareBranchId(null);
  }, [compareBranchId, comparison]);

  const compareWithParent = useCallback(
    (branchId: BranchId) => {
      const parentId = snapshot.branches[branchId]?.parentId;
      if (!parentId) return;
      setCompareBranchId(branchId);
      onCompareParent?.(branchId, parentId);
    },
    [onCompareParent, snapshot.branches],
  );
  const closeComparison = useCallback(() => setCompareBranchId(null), []);

  const nodes = useMemo<BranchFlowNode[]>(
    () =>
      Object.values(snapshot.branches)
        .filter((branch) => visible.has(branch.id))
        .map((branch) => {
          const canvasNode = snapshot.canvas.nodes[branch.id];
          const expanded = canvasNode?.expanded === true;
          const messages = messagesForBranch(
            snapshot,
            messagesByBranch,
            branch.id,
          );
          const tone = branchToneForBranch(snapshot, branch.id);
          return {
            id: branch.id,
            type: "branch",
            position: {
              x: canvasNode?.x ?? 0,
              y: canvasNode?.y ?? 0,
            },
            width: canvasNode?.width ?? (expanded ? 610 : 324),
            height: canvasNode?.height ?? (expanded ? 720 : 192),
            style: {
              width: canvasNode?.width ?? (expanded ? 610 : 324),
              height: canvasNode?.height ?? (expanded ? 720 : 192),
            },
            selected: branch.id === activeBranchId,
            data: {
              branch,
              snapshot,
              messages,
              stream: streamsByBranch[branch.id] ?? null,
              active: branch.id === activeBranchId,
              expanded,
              folded: canvasNode?.folded === true,
              toneColor: tone?.color ?? null,
              childCount: descendantCount(snapshot, branch.id),
              draft: draftsByBranch[branch.id] ?? "",
              attachments: attachmentsByBranch[branch.id] ?? [],
              signedIn,
              focusToken: focusTokensByBranch[branch.id] ?? 0,
              onOpen: onOpenBranch,
              onToggleFold: (branchId) => {
                const focusBranchId = branchToFocusBeforeFold(
                  snapshot,
                  branchId,
                  activeBranchId,
                );
                if (focusBranchId) onOpenBranch(focusBranchId);
                onPatchCanvas({
                  nodes: {
                    [branchId]: {
                      folded: !snapshot.canvas.nodes[branchId]?.folded,
                    },
                  },
                });
              },
              onCompareParent: compareWithParent,
              onRename: onRenameBranch,
              onDelete: onDeleteBranch,
              onCreateBranch,
              onChangeDraft,
              onSend,
              onStop,
              onChooseFiles,
              onRemoveAttachment,
              onTranscribe,
              onDownloadImage,
              onRetryImage,
              onOpenExternal,
              resolveImageUrl,
            },
          };
        }),
    [
      activeBranchId,
      attachmentsByBranch,
      draftsByBranch,
      focusTokensByBranch,
      messagesByBranch,
      compareWithParent,
      onChangeDraft,
      onChooseFiles,
      onCreateBranch,
      onDeleteBranch,
      onDownloadImage,
      onOpenBranch,
      onOpenExternal,
      onPatchCanvas,
      onRemoveAttachment,
      onRenameBranch,
      onRetryImage,
      onSend,
      onStop,
      onTranscribe,
      resolveImageUrl,
      signedIn,
      snapshot,
      streamsByBranch,
      visible,
    ],
  );

  const edges = useMemo<Edge[]>(
    () =>
      Object.values(snapshot.branches)
        .filter(
          (branch) =>
            branch.parentId &&
            visible.has(branch.id) &&
            visible.has(branch.parentId),
        )
        .map((branch) => ({
          id: `${branch.parentId}-${branch.id}`,
          source: branch.parentId!,
          target: branch.id,
          type: "smoothstep",
          animated: Boolean(streamsByBranch[branch.id]),
          style: {
            stroke: branchToneForBranch(snapshot, branch.id)?.color ?? "#9ca3af",
            strokeWidth: 1.6,
          },
        })),
    [snapshot, streamsByBranch, visible],
  );

  const nodeTypes = useMemo(() => ({ branch: BranchCard }), []);
  const handleMoveEnd = useCallback(
    (_event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
      onPatchCanvas({ viewport });
    },
    [onPatchCanvas],
  );

  return (
    <>
      <ReactFlow<BranchFlowNode>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        minZoom={0.22}
        maxZoom={1.8}
        defaultViewport={snapshot.canvas.viewport}
        onMoveEnd={handleMoveEnd}
        onNodeDragStop={(_event, node) =>
          onPatchCanvas({
            nodes: {
              [node.id]: { x: node.position.x, y: node.position.y },
            },
          })
        }
        onPaneClick={() => {
          if (snapshot.canvas.focusedBranchId !== null) {
            onPatchCanvas({ focusedBranchId: null });
          }
        }}
        proOptions={{ hideAttribution: true }}
        fitView={nodes.length > 0 && snapshot.canvas.viewport.zoom === 1}
        fitViewOptions={{ padding: 0.14, maxZoom: 0.9 }}
        aria-label="Branching conversation canvas"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={22}
          size={1}
          color="var(--canvas-dot)"
        />
        <Panel
          className="canvas-navigation nodrag"
          position="top-right"
          aria-label="Branch navigation"
        >
          {activeBranchId !== rootBranchId ? (
            <button
              type="button"
              onClick={() => {
                if (onJumpToRoot) {
                  onJumpToRoot(rootBranchId);
                } else {
                  onOpenBranch(rootBranchId);
                }
              }}
            >
              <Icon name="chevron-left" size={14} />
              Jump to root
            </button>
          ) : null}
          {activeBranch?.parentId ? (
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={() => compareWithParent(activeBranch.id)}
            >
              <Icon name="branch" size={14} />
              Compare with parent
            </button>
          ) : null}
        </Panel>
        <Controls
          position="bottom-right"
          showInteractive={false}
          aria-label="Canvas controls"
        />
        {nodes.length > 4 ? (
          <MiniMap
            position="bottom-left"
            pannable
            zoomable
            nodeColor={(node) =>
              (node.data as BranchNodeData).toneColor ?? "var(--foreground)"
            }
            maskColor="color-mix(in srgb, var(--background) 74%, transparent)"
          />
        ) : null}
      </ReactFlow>
      {comparison ? (
        <BranchCompareDialog
          comparison={comparison}
          onClose={closeComparison}
          onOpenBranch={onOpenBranch}
        />
      ) : null}
    </>
  );
}

export function BranchCanvas(props: BranchCanvasProps): React.JSX.Element {
  return (
    <ReactFlowProvider key={props.snapshot.conversation.id}>
      <BranchCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
