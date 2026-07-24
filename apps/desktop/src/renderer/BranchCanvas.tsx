import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
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
import { GitBranch, LayoutGrid } from "lucide-react";
import "@xyflow/react/dist/style.css";
import {
  arrangeFocusedChildOnCanvas,
  type Branch,
  type BranchId,
  type ConversationCanvasPatch,
  type ConversationGraphSnapshot,
} from "@branchy/conversation-core";
import type { RenderedMessage } from "@branchy/conversation-core/presentation";

import { BrandMark } from "./BrandMark.tsx";
import { completeBranchSwitchPaintTrace } from "./branch-switch-performance.ts";
import { BranchCompareDialog } from "./BranchCompareDialog.tsx";
import {
  Composer,
  type ComposerSettingsChangeHandler,
  type ComposerSettingsSelection,
} from "./Composer.tsx";
import { Icon } from "./icons.tsx";
import { MessageBubble } from "./MessageBubble.tsx";
import {
  nearestCanvasNodeId,
  tidyCanvasNodes,
  type CanvasLayoutDirection,
  type CanvasLayoutNode,
} from "./branch-canvas-layout.ts";
import {
  branchToFocusBeforeFold,
  descendantCount,
  isEmptyCanvasRoot,
  isStreamActive,
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
const CANVAS_FIT_PADDING = 0.24;

export type BranchStopMode = "edit" | "discard";

type BranchNodeData = {
  branch: Branch;
  snapshot: ConversationGraphSnapshot;
  messages: RenderedMessage[];
  stream: StreamState | null;
  active: boolean;
  expanded: boolean;
  folded: boolean;
  draftParent: boolean;
  childCount: number;
  draft: string;
  attachments: AttachmentDraft[];
  signedIn: boolean;
  focusToken: number;
  settings: ComposerSettingsSelection;
  settingsSaving: boolean;
  onOpen: (branchId: BranchId) => void;
  onToggleExpanded: (branchId: BranchId) => void;
  onToggleFold: (branchId: BranchId) => void;
  onCompareParent: (branchId: BranchId) => void;
  onRename: (branchId: BranchId) => void;
  onDelete: (branchId: BranchId) => void;
  onResize: (
    branchId: BranchId,
    bounds: { x: number; y: number; width: number; height: number },
  ) => void;
  onCreateBranch: (draft: BranchSelectionDraft) => void;
  onChangeDraft: (branchId: BranchId, value: string) => void;
  onSend: (branchId: BranchId) => void;
  onStop: (branchId: BranchId, mode: BranchStopMode) => void;
  onChooseFiles: (branchId: BranchId, files: File[]) => void;
  onRemoveAttachment: (branchId: BranchId, attachmentId: string) => void;
  onTranscribe: (
    audio: Uint8Array,
    contentType: string,
  ) => Promise<string>;
  onSettingsChange: ComposerSettingsChangeHandler;
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

type BranchDraftNodeData = {
  draft: BranchSelectionDraft;
  attachments: AttachmentDraft[];
  signedIn: boolean;
  settings: ComposerSettingsSelection;
  settingsSaving: boolean;
  isCreating: boolean;
  onCancel: () => void;
  onCreate: (prompt: string) => void;
  onSaveNote: (prompt: string) => void;
  onChooseFiles: (files: File[]) => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onTranscribe: (
    audio: Uint8Array,
    contentType: string,
  ) => Promise<string>;
  onSettingsChange: ComposerSettingsChangeHandler;
};

type BranchDraftFlowNode = Node<BranchDraftNodeData, "branchDraft">;
type CanvasFlowNode = BranchFlowNode | BranchDraftFlowNode;

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
  onStop,
}: {
  stream: StreamState;
  onStop: (mode: BranchStopMode) => void;
}): React.JSX.Element {
  const [stopMenuOpen, setStopMenuOpen] = useState(false);
  const generating =
    stream.status === "generating_image" ||
    stream.status === "saving_image";
  return (
    <article className="message message--assistant stream-message" role="status">
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

        {stream.status !== "error" ? (
          <div
            className="menu-anchor"
            style={{ marginTop: 10, width: "fit-content" }}
          >
            <button
              className="connect-button"
              type="button"
              aria-expanded={stopMenuOpen}
              onClick={() => setStopMenuOpen((current) => !current)}
            >
              <Icon name="square" size={12} />
              Stop
              <Icon name="chevron-down" size={12} />
            </button>
            {stopMenuOpen ? (
              <div
                className="context-menu"
                style={{
                  top: "auto",
                  right: "auto",
                  bottom: "calc(100% + 5px)",
                  left: 0,
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setStopMenuOpen(false);
                    onStop("edit");
                  }}
                >
                  <Icon name="pencil" size={14} />
                  Stop &amp; edit prompt
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStopMenuOpen(false);
                    onStop("discard");
                  }}
                >
                  <Icon name="trash" size={14} />
                  Stop &amp; discard
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

const BranchCard = memo(function BranchCard({
  data,
  selected,
}: NodeProps<BranchFlowNode>): React.JSX.Element {
  const { branch, messages, stream, expanded, folded, active } = data;
  const threadRef = useRef<HTMLDivElement>(null);
  const title = branch.title || "Untitled branch";
  const visibleMessages = messages.filter(
    (message) => !isSupersededByActiveStream(message, stream),
  );
  const branchSource = [...visibleMessages]
    .reverse()
    .find(
      (message) =>
        message.role === "assistant" && message.content.trim().length > 0,
    );
  const sourceExcerpt = branch.createdFrom.excerpt?.trim();
  const headerTitle = sourceExcerpt || title;
  const parentTitle = branch.parentId
    ? data.snapshot.branches[branch.parentId]?.title ?? "Parent branch"
    : null;
  const streamActive = isStreamActive(stream);
  const emptyRoot = isEmptyCanvasRoot(
    branch.id,
    data.snapshot.conversation.rootBranchId,
    visibleMessages.length,
    stream,
  );

  useLayoutEffect(() => {
    if (!active || !expanded || !threadRef.current) return;
    completeBranchSwitchPaintTrace({
      branchId: branch.id,
      renderedMessageCount: visibleMessages.length,
    });
  }, [active, branch.id, expanded, visibleMessages]);

  const composer = (
    <Composer
      branchTitle={title}
      value={data.draft}
      attachments={data.attachments}
      variant={emptyRoot ? "canvas-start" : "default"}
      disabled={!data.signedIn}
      streaming={streamActive}
      focusToken={data.focusToken}
      settings={data.settings}
      settingsSaving={data.settingsSaving}
      onChange={(value) => data.onChangeDraft(branch.id, value)}
      onSend={() => data.onSend(branch.id)}
      onStop={() => data.onStop(branch.id, "edit")}
      onChooseFiles={(files) => data.onChooseFiles(branch.id, files)}
      onRemoveAttachment={(attachmentId) =>
        data.onRemoveAttachment(branch.id, attachmentId)
      }
      onTranscribe={data.onTranscribe}
      onSettingsChange={data.onSettingsChange}
    />
  );

  useEffect(() => {
    if (!expanded || !threadRef.current || !stream) return;
    threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [expanded, stream?.text, stream?.status]);

  return (
    <>
      <NodeResizer
        isVisible={expanded}
        minWidth={MIN_EXPANDED_CARD_WIDTH}
        minHeight={MIN_EXPANDED_CARD_HEIGHT}
        maxWidth={MAX_EXPANDED_CARD_WIDTH}
        maxHeight={MAX_EXPANDED_CARD_HEIGHT}
        lineStyle={{
          borderColor: "var(--border-strong)",
        }}
        handleStyle={{
          width: 8,
          height: 8,
          border: "1px solid var(--border-strong)",
          borderRadius: 2,
          background: "var(--background)",
        }}
        onResizeEnd={(_event, bounds) =>
          data.onResize(branch.id, bounds)
        }
      />
      <article
        className={`branch-card ${expanded ? "is-expanded" : ""} ${
          active || selected ? "is-active" : ""
        }`}
        onClick={(event) => {
          if (expanded) return;
          const target = event.target as HTMLElement;
          if (target.closest("button")) return;
          data.onOpen(branch.id);
        }}
        style={{ isolation: "isolate" }}
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
        {data.draftParent ? (
          <Handle
            id="draft-source"
            className="branch-handle branch-handle--source"
            type="source"
            position={Position.Right}
            isConnectable={false}
            style={{ top: 24 }}
          />
        ) : null}

        {folded && data.childCount > 0 ? (
          <>
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                right: 12,
                bottom: -8,
                left: 12,
                zIndex: -1,
                height: 22,
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                background: "var(--muted)",
              }}
            />
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                right: 24,
                bottom: -15,
                left: 24,
                zIndex: -2,
                height: 22,
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                background:
                  "color-mix(in srgb, var(--muted) 72%, var(--background))",
              }}
            />
          </>
        ) : null}

        <header className="branch-card__header">
          <button
            className="branch-card__identity nodrag"
            type="button"
            onClick={() => data.onOpen(branch.id)}
            aria-label={`${expanded ? "Focus" : "Open"} ${title}`}
          >
            <span className="branch-card__tone" aria-hidden="true" />
            <span className="branch-card__heading">
              {parentTitle ? (
                <span className="branch-card__parent">
                  Branch · Child of {parentTitle}
                </span>
              ) : (
                <span className="branch-card__parent">Root chat</span>
              )}
              <strong title={sourceExcerpt ? `“${sourceExcerpt}”` : title}>
                {sourceExcerpt ? `“${headerTitle}”` : headerTitle}
              </strong>
            </span>
          </button>

          <div className="branch-card__actions nodrag">
            <button
              className="icon-button icon-button--quiet"
              type="button"
              disabled={!branchSource}
              aria-label={`Start a child branch from ${title}`}
              title={
                branchSource
                  ? "Start child branch"
                  : "A child branch needs an assistant response"
              }
              onClick={() => {
                if (!branchSource) return;
                const excerpt = branchSource.content.trim();
                data.onCreateBranch({
                  parentBranchId: branch.id,
                  messageId: branchSource.id,
                  excerpt:
                    excerpt.length > 280
                      ? `${excerpt.slice(0, 277)}…`
                      : excerpt,
                  span: null,
                });
              }}
            >
              <GitBranch aria-hidden="true" size={16} strokeWidth={1.8} />
            </button>
            <button
              className="icon-button icon-button--quiet"
              type="button"
              aria-label={`Rename ${title}`}
              title="Rename branch"
              onClick={() => data.onRename(branch.id)}
            >
              <Icon name="pencil" size={15} />
            </button>
            {expanded && data.childCount > 0 ? (
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
            {expanded && branch.parentId ? (
              <button
                className="icon-button icon-button--quiet"
                type="button"
                aria-label={`Delete ${title}`}
                title="Delete branch"
                onClick={() => data.onDelete(branch.id)}
              >
                <Icon name="trash" size={15} />
              </button>
            ) : null}
            <button
              className="icon-button icon-button--quiet"
              type="button"
              aria-label={`${expanded ? "Collapse" : "Expand"} ${title}`}
              title={expanded ? "Collapse branch" : "Expand branch"}
              onClick={() => data.onToggleExpanded(branch.id)}
            >
              <Icon
                name={expanded ? "chevron-down" : "chevron-right"}
                size={16}
              />
            </button>
          </div>
        </header>

        {expanded && emptyRoot && active ? (
          <div className="branch-card__start nodrag nowheel">
            {composer}
          </div>
        ) : expanded ? (
          <>
            <div
              className="branch-thread nowheel nodrag"
              data-card-interactive="true"
              ref={threadRef}
            >
              {visibleMessages.length === 0 && !streamActive ? (
                <div className="branch-empty">
                  <BrandMark className="branch-empty__mark" size={32} />
                  <strong>Start this branch</strong>
                  <span>Every path keeps its own context.</span>
                </div>
              ) : (
                visibleMessages.map((message) => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    branchId={branch.id}
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
              {stream && streamActive ? (
                <StreamBubble
                  stream={stream}
                  onStop={(mode) => data.onStop(branch.id, mode)}
                />
              ) : null}
            </div>
            <div
              className={`branch-card__composer nodrag nowheel ${
                active ? "" : "branch-card__composer--inactive"
              }`}
            >
              {active ? composer : (
                <button
                  className="branch-card__inactive"
                  type="button"
                  onClick={() => data.onOpen(branch.id)}
                >
                  Select this card to continue
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="branch-card__preview nodrag">
            <button
              className={
                sourceExcerpt
                  ? "branch-card__excerpt"
                  : "branch-card__latest"
              }
              type="button"
              onClick={() => data.onOpen(branch.id)}
            >
              <p>
                {sourceExcerpt
                  ? `“${sourceExcerpt}”`
                  : latestPreview(visibleMessages)}
              </p>
            </button>
            <footer>
              <span className="branch-card__count">
                <Icon name="menu" size={12} />
                {visibleMessages.length}{" "}
                {visibleMessages.length === 1 ? "message" : "messages"}
              </span>
              <span className="branch-card__count">
                <Icon name="branch" size={12} />
                {data.childCount}
              </span>
              {stream ? (
                <span className="branch-card__live">
                  <span className="spinner" />
                  Working
                </span>
              ) : null}
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
                    size={14}
                  />
                  <span>{data.childCount}</span>
                </button>
              ) : null}
              {branch.parentId ? (
                <button
                  className="icon-button icon-button--quiet"
                  type="button"
                  aria-label={`Delete ${title}`}
                  title="Delete branch"
                  onClick={() => data.onDelete(branch.id)}
                >
                  <Icon name="trash" size={14} />
                </button>
              ) : null}
            </footer>
          </div>
        )}
      </article>
    </>
  );
});

const BranchDraftCard = memo(function BranchDraftCard({
  data,
}: NodeProps<BranchDraftFlowNode>): React.JSX.Element {
  const [prompt, setPrompt] = useState("");
  const draftKey = `${data.draft.parentBranchId}:${data.draft.messageId}:${
    data.draft.span?.start ?? ""
  }:${data.draft.span?.end ?? ""}`;

  useEffect(() => {
    setPrompt("");
  }, [draftKey]);

  const submit = useCallback(() => {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt || data.isCreating) return;
    data.onCreate(normalizedPrompt);
  }, [data, prompt]);

  return (
    <article
      className="branch-card nodrag nopan nowheel"
      aria-label="New branch draft"
      data-branch-draft-card="true"
    >
      <Handle
        id="draft-target"
        className="branch-handle branch-handle--target"
        type="target"
        position={Position.Left}
        isConnectable={false}
        style={{ top: 24 }}
      />
      <header className="branch-card__header">
        <span className="branch-card__identity">
          <span className="branch-card__tone" aria-hidden="true" />
          <span className="branch-card__heading">
            <span className="branch-card__parent">New child branch</span>
            <strong>Explore another direction</strong>
          </span>
        </span>
        <button
          className="icon-button icon-button--quiet"
          type="button"
          disabled={data.isCreating}
          aria-label="Cancel branch draft"
          title="Cancel branch draft"
          onClick={data.onCancel}
        >
          <Icon name="close" size={16} />
        </button>
      </header>
      <blockquote className="branch-draft__source">
        {data.draft.excerpt || "Branch from this response"}
      </blockquote>
      <div className="branch-draft__composer">
        <Composer
          branchTitle="new branch"
          value={prompt}
          attachments={data.attachments}
          variant="branch-draft"
          disabled={data.isCreating || !data.signedIn}
          focusToken={1}
          settings={data.settings}
          settingsSaving={data.settingsSaving}
          onChange={setPrompt}
          onSend={submit}
          onStop={() => undefined}
          onChooseFiles={data.onChooseFiles}
          onRemoveAttachment={data.onRemoveAttachment}
          onTranscribe={data.onTranscribe}
          onSettingsChange={data.onSettingsChange}
          onSaveNote={() => data.onSaveNote(prompt)}
        />
      </div>
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
  settingsSaving: boolean;
  signedIn: boolean;
  branchDraftAttachments: AttachmentDraft[];
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
  branchDraft: BranchSelectionDraft | null;
  isCreatingBranch: boolean;
  onCancelBranchDraft: () => void;
  onCreateBranchPrompt: (prompt: string) => void;
  onSaveBranchNote: (prompt: string) => void;
  onChooseBranchDraftFiles: (files: File[]) => void;
  onRemoveBranchDraftAttachment: (attachmentId: string) => void;
  onChangeDraft: (branchId: BranchId, value: string) => void;
  onSend: (branchId: BranchId) => void;
  onStop: (branchId: BranchId, mode: BranchStopMode) => void;
  onChooseFiles: (branchId: BranchId, files: File[]) => void;
  onRemoveAttachment: (branchId: BranchId, attachmentId: string) => void;
  onTranscribe: (
    audio: Uint8Array,
    contentType: string,
  ) => Promise<string>;
  onSettingsChange: ComposerSettingsChangeHandler;
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
  settingsSaving,
  signedIn,
  branchDraftAttachments,
  onOpenBranch,
  onJumpToRoot,
  onCompareParent,
  onPatchCanvas,
  onRenameBranch,
  onDeleteBranch,
  onCreateBranch,
  branchDraft,
  isCreatingBranch,
  onCancelBranchDraft,
  onCreateBranchPrompt,
  onSaveBranchNote,
  onChooseBranchDraftFiles,
  onRemoveBranchDraftAttachment,
  onChangeDraft,
  onSend,
  onStop,
  onChooseFiles,
  onRemoveAttachment,
  onTranscribe,
  onSettingsChange,
  onDownloadImage,
  onRetryImage,
  onOpenExternal,
  resolveImageUrl,
}: BranchCanvasProps): React.JSX.Element {
  const flow = useReactFlow<CanvasFlowNode, Edge>();
  const updateNodeInternals = useUpdateNodeInternals();
  const draftViewportRef = useRef<{
    key: string;
    focusedBranchId: BranchId | null;
    viewport: Viewport;
  } | null>(null);
  const [compareBranchId, setCompareBranchId] =
    useState<BranchId | null>(null);
  const [selectedBranchId, setSelectedBranchId] =
    useState<BranchId>(activeBranchId);
  const visible = useMemo(() => visibleBranchIds(snapshot), [snapshot]);
  const draftLayout = useMemo(
    () =>
      branchDraft &&
      snapshot.branches[branchDraft.parentBranchId] &&
      visible.has(branchDraft.parentBranchId)
        ? arrangeFocusedChildOnCanvas(
            snapshot,
            branchDraft.parentBranchId,
            DRAFT_NODE_ID,
          )
        : null,
    [branchDraft, snapshot, visible],
  );
  const activeBranch = snapshot.branches[activeBranchId] ?? null;
  const rootBranchId = snapshot.conversation.rootBranchId;
  const composerSettings = useMemo<ComposerSettingsSelection>(
    () => ({
      model: snapshot.conversation.settings.model,
      reasoningEffort:
        snapshot.conversation.settings.reasoningEffort ?? null,
      preset:
        snapshot.conversation.settings.composerDefaults.preset,
      tools: [
        ...snapshot.conversation.settings.composerDefaults.tools,
      ],
    }),
    [snapshot.conversation.settings],
  );
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

  const toggleExpanded = useCallback(
    (branchId: BranchId) => {
      setSelectedBranchId(branchId);
      if (snapshot.canvas.nodes[branchId]?.expanded) {
        onPatchCanvas({
          focusedBranchId: branchId,
          nodes: { [branchId]: { expanded: false } },
        });
        return;
      }
      onOpenBranch(branchId);
    },
    [onOpenBranch, onPatchCanvas, snapshot.canvas.nodes],
  );

  const toggleFold = useCallback(
    (branchId: BranchId) => {
      const focusBranchId = branchToFocusBeforeFold(
        snapshot,
        branchId,
        activeBranchId,
      );
      if (focusBranchId) onOpenBranch(focusBranchId);
      setSelectedBranchId(branchId);
      onPatchCanvas({
        focusedBranchId: branchId,
        nodes: {
          [branchId]: {
            folded: !snapshot.canvas.nodes[branchId]?.folded,
          },
        },
      });
    },
    [activeBranchId, onOpenBranch, onPatchCanvas, snapshot],
  );

  const resizeBranch = useCallback(
    (
      branchId: BranchId,
      bounds: { x: number; y: number; width: number; height: number },
    ) => {
      setSelectedBranchId(branchId);
      onPatchCanvas({
        focusedBranchId: branchId,
        nodes: {
          [branchId]: {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
          },
        },
      });
    },
    [onPatchCanvas],
  );

  const desiredNodes = useMemo<CanvasFlowNode[]>(() => {
    const branchNodes: BranchFlowNode[] = Object.values(snapshot.branches)
        .filter((branch) => visible.has(branch.id))
        .map((branch) => {
          const canvasNode = snapshot.canvas.nodes[branch.id];
          const draftUpdate = draftLayout?.[branch.id];
          const expanded =
            draftUpdate?.expanded ?? canvasNode?.expanded === true;
          const messages = messagesForBranch(
            snapshot,
            messagesByBranch,
            branch.id,
          );
          const isEmptyRoot =
            branch.id === rootBranchId && messages.length === 0;
          const expandedWidth =
            canvasNode?.width ??
            (isEmptyRoot ? DRAFT_CARD_WIDTH : EXPANDED_CARD_WIDTH);
          const expandedHeight =
            canvasNode?.height ??
            (isEmptyRoot ? DRAFT_CARD_HEIGHT : EXPANDED_CARD_HEIGHT);
          return {
            id: branch.id,
            type: "branch",
            position: {
              x: draftUpdate?.x ?? canvasNode?.x ?? 0,
              y: draftUpdate?.y ?? canvasNode?.y ?? 0,
            },
            initialWidth: expanded
              ? expandedWidth
              : CARD_WIDTH,
            initialHeight: expanded
              ? expandedHeight
              : CARD_HEIGHT,
            style: {
              width: expanded ? expandedWidth : CARD_WIDTH,
              height: expanded ? expandedHeight : CARD_HEIGHT,
            },
            selected: branch.id === selectedBranchId,
            data: {
              branch,
              snapshot,
              messages,
              stream: streamsByBranch[branch.id] ?? null,
              active: branch.id === activeBranchId,
              expanded,
              folded: canvasNode?.folded === true,
              draftParent: branchDraft?.parentBranchId === branch.id,
              childCount: descendantCount(snapshot, branch.id),
              draft: draftsByBranch[branch.id] ?? "",
              attachments: attachmentsByBranch[branch.id] ?? [],
              signedIn,
              focusToken: focusTokensByBranch[branch.id] ?? 0,
              settings: composerSettings,
              settingsSaving,
              onOpen: onOpenBranch,
              onToggleExpanded: toggleExpanded,
              onToggleFold: toggleFold,
              onCompareParent: compareWithParent,
              onRename: onRenameBranch,
              onDelete: onDeleteBranch,
              onResize: resizeBranch,
              onCreateBranch,
              onChangeDraft,
              onSend,
              onStop,
              onChooseFiles,
              onRemoveAttachment,
              onTranscribe,
              onSettingsChange,
              onDownloadImage,
              onRetryImage,
              onOpenExternal,
              resolveImageUrl,
            },
          };
        });

    if (!branchDraft || !draftLayout) return branchNodes;
    const draftPosition = draftLayout[DRAFT_NODE_ID];
    const draftNode: BranchDraftFlowNode = {
      id: DRAFT_NODE_ID,
      type: "branchDraft",
      position: {
        x: draftPosition?.x ?? 0,
        y: draftPosition?.y ?? 0,
      },
      initialWidth: DRAFT_CARD_WIDTH,
      initialHeight: DRAFT_CARD_HEIGHT,
      style: {
        width: DRAFT_CARD_WIDTH,
        height: DRAFT_CARD_HEIGHT,
      },
      draggable: false,
      selectable: false,
      data: {
        draft: branchDraft,
        attachments: branchDraftAttachments,
        signedIn,
        settings: composerSettings,
        settingsSaving,
        isCreating: isCreatingBranch,
        onCancel: onCancelBranchDraft,
        onCreate: onCreateBranchPrompt,
        onSaveNote: onSaveBranchNote,
        onChooseFiles: onChooseBranchDraftFiles,
        onRemoveAttachment: onRemoveBranchDraftAttachment,
        onTranscribe,
        onSettingsChange,
      },
    };
    return [...branchNodes, draftNode];
  }, [
      activeBranchId,
      attachmentsByBranch,
      branchDraft,
      branchDraftAttachments,
      composerSettings,
      draftLayout,
      draftsByBranch,
      focusTokensByBranch,
      isCreatingBranch,
      messagesByBranch,
      compareWithParent,
      onCancelBranchDraft,
      onChangeDraft,
      onChooseFiles,
      onCreateBranch,
      onCreateBranchPrompt,
      onChooseBranchDraftFiles,
      onDeleteBranch,
      onDownloadImage,
      onOpenBranch,
      onOpenExternal,
      onRemoveBranchDraftAttachment,
      onRemoveAttachment,
      onRenameBranch,
      onRetryImage,
      onSend,
      onStop,
      onSaveBranchNote,
      onSettingsChange,
      onTranscribe,
      resolveImageUrl,
      resizeBranch,
      rootBranchId,
      selectedBranchId,
      settingsSaving,
      signedIn,
      snapshot,
      streamsByBranch,
      toggleExpanded,
      toggleFold,
      visible,
    ]);
  const [nodes, setNodes, onNodesChange] =
    useNodesState<CanvasFlowNode>(desiredNodes);

  useEffect(() => {
    setNodes((current) => {
      const hasDraft = desiredNodes.some(
        (node) => node.id === DRAFT_NODE_ID,
      );
      const hadDraft = current.some(
        (node) => node.id === DRAFT_NODE_ID,
      );
      const livePositions = new Map(
        current.map((node) => [node.id, node.position] as const),
      );
      return desiredNodes.map((node) => ({
        ...node,
        position:
          hasDraft || hadDraft
            ? node.position
            : livePositions.get(node.id) ?? node.position,
      }));
    });
  }, [desiredNodes, setNodes]);

  useEffect(() => {
    if (!branchDraft) {
      const draftSession = draftViewportRef.current;
      if (!draftSession) return;
      draftViewportRef.current = null;
      const focusedBranchId = snapshot.canvas.focusedBranchId;
      const createdChildId =
        focusedBranchId && focusedBranchId !== draftSession.focusedBranchId
          ? focusedBranchId
          : null;
      const createdChildState = createdChildId
        ? snapshot.canvas.nodes[createdChildId]
        : null;
      const frame = window.requestAnimationFrame(() => {
        if (createdChildId && createdChildState) {
          setSelectedBranchId(createdChildId);
          void flow.fitBounds(
            {
              x: createdChildState.x,
              y: createdChildState.y,
              width: createdChildState.width ?? EXPANDED_CARD_WIDTH,
              height: createdChildState.height ?? EXPANDED_CARD_HEIGHT,
            },
            {
              padding: 0.14,
              duration: 300,
            },
          );
          return;
        }
        void flow.setViewport(draftSession.viewport, { duration: 220 });
      });
      return () => window.cancelAnimationFrame(frame);
    }

    const draftKey = `${branchDraft.parentBranchId}:${branchDraft.messageId}:${
      branchDraft.span?.start ?? ""
    }:${branchDraft.span?.end ?? ""}`;
    if (draftViewportRef.current?.key !== draftKey) {
      draftViewportRef.current = {
        key: draftKey,
        focusedBranchId: snapshot.canvas.focusedBranchId,
        viewport: flow.getViewport(),
      };
    }
    let measuredFrame: number | null = null;
    const layoutFrame = window.requestAnimationFrame(() => {
      measuredFrame = window.requestAnimationFrame(() => {
        const parent = flow.getNode(branchDraft.parentBranchId);
        const draft = flow.getNode(DRAFT_NODE_ID);
        if (!parent || !draft) return;
        void flow.fitView({
          nodes: [parent, draft],
          padding: CANVAS_FIT_PADDING,
          duration: 220,
          maxZoom: 1,
        });
      });
    });
    return () => {
      window.cancelAnimationFrame(layoutFrame);
      if (measuredFrame !== null) {
        window.cancelAnimationFrame(measuredFrame);
      }
    };
  }, [
    branchDraft,
    flow,
    nodes.length,
    setSelectedBranchId,
    snapshot.canvas.focusedBranchId,
    snapshot.canvas.nodes,
  ]);

  useEffect(() => {
    const nextSelected =
      snapshot.canvas.focusedBranchId ?? activeBranchId;
    if (snapshot.branches[nextSelected]) {
      setSelectedBranchId(nextSelected);
    }
  }, [
    activeBranchId,
    snapshot.branches,
    snapshot.canvas.focusedBranchId,
  ]);

  const sizeSignature = useMemo(
    () =>
      desiredNodes
        .filter((node): node is BranchFlowNode => node.type === "branch")
        .map(
          (node) =>
            `${node.id}:${node.data.expanded ? 1 : 0}:${
              node.style?.width ?? ""
            }:${node.style?.height ?? ""}:${node.data.draftParent ? 1 : 0}`,
        )
        .sort()
        .join("|"),
    [desiredNodes],
  );
  useEffect(() => {
    for (const branchId of visible) updateNodeInternals(branchId);
    if (branchDraft) updateNodeInternals(DRAFT_NODE_ID);
  }, [branchDraft, sizeSignature, updateNodeInternals, visible]);

  const edges = useMemo<Edge[]>(() => {
    const branchEdges: Edge[] = Object.values(snapshot.branches)
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
            stroke: "var(--border-strong)",
            strokeWidth: 1.4,
          },
        }));
    if (branchDraft && draftLayout) {
      branchEdges.push({
        id: `${branchDraft.parentBranchId}-${DRAFT_NODE_ID}`,
        source: branchDraft.parentBranchId,
        sourceHandle: "draft-source",
        target: DRAFT_NODE_ID,
        targetHandle: "draft-target",
        type: "smoothstep",
        animated: true,
        style: {
          stroke: "var(--border-strong)",
          strokeWidth: 1.4,
        },
      });
    }
    return branchEdges;
  }, [branchDraft, draftLayout, snapshot, streamsByBranch, visible]);

  const nodeTypes = useMemo(
    () => ({
      branch: BranchCard,
      branchDraft: BranchDraftCard,
    }),
    [],
  );
  const layoutNodes = useCallback(
    (): CanvasLayoutNode[] =>
      nodes
        .filter((node): node is BranchFlowNode => node.type === "branch")
        .map((node) => {
          const canvasNode = snapshot.canvas.nodes[node.id];
          const expanded = node.data.expanded;
          const isEmptyRoot =
            node.id === rootBranchId && node.data.messages.length === 0;
          return {
            id: node.id,
            x: node.position.x,
            y: node.position.y,
            width: expanded
              ? canvasNode?.width ??
                (isEmptyRoot ? DRAFT_CARD_WIDTH : EXPANDED_CARD_WIDTH)
              : CARD_WIDTH,
            height: expanded
              ? canvasNode?.height ??
                (isEmptyRoot ? DRAFT_CARD_HEIGHT : EXPANDED_CARD_HEIGHT)
              : CARD_HEIGHT,
          };
        }),
    [nodes, rootBranchId, snapshot.canvas.nodes],
  );

  const tidy = useCallback(() => {
    const positions = tidyCanvasNodes(
      layoutNodes(),
      edges
        .filter(
          (edge) =>
            edge.source !== DRAFT_NODE_ID &&
            edge.target !== DRAFT_NODE_ID,
        )
        .map((edge) => ({
          source: edge.source,
          target: edge.target,
        })),
    );
    const patchNodes: NonNullable<ConversationCanvasPatch["nodes"]> = {};
    for (const [branchId, position] of Object.entries(positions)) {
      patchNodes[branchId] = position;
    }
    setNodes((current) =>
      current.map((node) => ({
        ...node,
        position: positions[node.id] ?? node.position,
      })),
    );
    onPatchCanvas({ nodes: patchNodes });
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        void flow.fitView({
          padding: CANVAS_FIT_PADDING,
          duration: 280,
          maxZoom: 1,
        });
      });
    });
  }, [edges, flow, layoutNodes, onPatchCanvas, setNodes]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
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

      if (event.key === "Escape" && comparison) {
        event.preventDefault();
        closeComparison();
        return;
      }

      const selectedNode = snapshot.canvas.nodes[selectedBranchId];
      if (
        (event.key === "Delete" || event.key === "Backspace") &&
        selectedBranchId !== rootBranchId
      ) {
        event.preventDefault();
        onDeleteBranch(selectedBranchId);
        return;
      }
      if (event.key === "Escape" && selectedNode?.expanded) {
        event.preventDefault();
        toggleExpanded(selectedBranchId);
        return;
      }
      if (!event.altKey) return;

      if (event.key === "Enter") {
        event.preventDefault();
        toggleExpanded(selectedBranchId);
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        if (descendantCount(snapshot, selectedBranchId) > 0) {
          toggleFold(selectedBranchId);
        }
        return;
      }

      const direction: CanvasLayoutDirection | null =
        event.key.toLowerCase() === "a"
          ? "left"
          : event.key.toLowerCase() === "d"
            ? "right"
            : event.key.toLowerCase() === "w"
              ? "up"
              : event.key.toLowerCase() === "s"
                ? "down"
                : null;
      if (!direction) return;

      const candidates = layoutNodes();
      const nearestId = nearestCanvasNodeId(
        candidates,
        selectedBranchId,
        direction,
      );
      if (!nearestId) return;
      event.preventDefault();
      setSelectedBranchId(nearestId);
      onPatchCanvas({ focusedBranchId: nearestId });
      const nearestNode = nodes.find((node) => node.id === nearestId);
      if (nearestNode) {
        void flow.fitView({
          nodes: [nearestNode],
          padding: 0.42,
          duration: 160,
          maxZoom: Math.min(flow.getZoom(), 1),
        });
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    branchDraft,
    closeComparison,
    comparison,
    flow,
    isCreatingBranch,
    layoutNodes,
    nodes,
    onCancelBranchDraft,
    onDeleteBranch,
    onPatchCanvas,
    rootBranchId,
    selectedBranchId,
    snapshot,
    toggleExpanded,
    toggleFold,
  ]);

  const handleMoveEnd = useCallback(
    (_event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
      onPatchCanvas({ viewport });
    },
    [onPatchCanvas],
  );

  return (
    <>
      <ReactFlow<CanvasFlowNode>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        nodesConnectable={false}
        edgesFocusable={false}
        deleteKeyCode={null}
        minZoom={0.25}
        maxZoom={1.75}
        defaultViewport={snapshot.canvas.viewport}
        onMoveEnd={handleMoveEnd}
        onNodeClick={(_event, node) => {
          if (node.type !== "branch") return;
          setSelectedBranchId(node.id);
          onPatchCanvas({ focusedBranchId: node.id });
        }}
        onNodeDragStop={(_event, node) => {
          if (node.type !== "branch") return;
          setSelectedBranchId(node.id);
          onPatchCanvas({
            focusedBranchId: node.id,
            nodes: {
              [node.id]: { x: node.position.x, y: node.position.y },
            },
          });
        }}
        onPaneClick={() => {
          if (branchDraft && !isCreatingBranch) {
            onCancelBranchDraft();
          }
          setSelectedBranchId(activeBranchId);
          if (snapshot.canvas.focusedBranchId !== null) {
            onPatchCanvas({ focusedBranchId: null });
          }
        }}
        onlyRenderVisibleElements
        proOptions={{ hideAttribution: true }}
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
          <button type="button" onClick={tidy} title="Arrange branch cards">
            <LayoutGrid aria-hidden="true" size={14} strokeWidth={1.8} />
            Tidy
          </button>
          {activeBranchId !== rootBranchId ? (
            <button
              type="button"
              onClick={() => {
                setSelectedBranchId(rootBranchId);
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
          <span
            aria-hidden="true"
            style={{
              padding: "0 9px",
              color: "var(--muted-foreground)",
              fontSize: 9,
              whiteSpace: "nowrap",
            }}
          >
            Alt+WASD · Alt+Enter · Alt+Space
          </span>
        </Panel>
        <Controls
          position="bottom-left"
          showInteractive={false}
          aria-label="Canvas controls"
        />
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
