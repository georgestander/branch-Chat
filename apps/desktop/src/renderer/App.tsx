import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  applyCanvasPatch,
  type Branch,
  type BranchId,
  type ComposerPreset,
  type ConversationCanvasPatch,
  type ConversationGraphSnapshot,
  type Message,
  type ReasoningEffort,
} from "@branchy/conversation-core";
import type { ConversationComposerTool } from "@branchy/conversation-core/tools";
import type { RenderedMessage } from "@branchy/conversation-core/presentation";
import type {
  ActiveConversationStream,
  BranchyStreamEvent,
  ConversationBootstrap,
  ConversationDirectory,
  ConversationDirectoryEntry,
  DesktopAccountState,
  SendMessageResult,
} from "../shared/contracts.ts";

import { AccountPanel } from "./AccountPanel.tsx";
import { BrandMark } from "./BrandMark.tsx";
import {
  BranchCanvas,
  type BranchStopMode,
} from "./BranchCanvas.tsx";
import type { ComposerSettingsSelection } from "./composer-settings.ts";
import { Icon } from "./icons.tsx";
import {
  ConfirmDialog,
  RenameDialog,
  ToastRegion,
  type ToastMessage,
} from "./Overlays.tsx";
import { Sidebar } from "./Sidebar.tsx";
import {
  PendingUploadRegistry,
  visitDiscardedAttachments,
} from "./pending-uploads.ts";
import {
  initialStreamState,
  isStreamActive,
  latestUserPrompt,
  mergeRenderedMessage,
  removeStreamStateIfMatching,
  reduceStreamState,
  retainBranchRecords,
  retainBranchSelectionDraft,
  toRenderedMessage,
} from "./state.ts";
import {
  generatedImagesForMessage,
  type AccountState,
  type AttachmentDraft,
  type BranchSelectionDraft,
  type DirectoryConversation,
  type RendererStreamEvent,
  type StreamState,
} from "./types.ts";

type LoadingScreen = {
  kind: "loading";
};

type ErrorScreen = {
  kind: "error";
  message: string;
};

type EmptyScreen = {
  kind: "empty";
  conversations: DirectoryConversation[];
  account: AccountState;
};

type ReadyScreen = {
  kind: "ready";
  conversationId: string;
  title: string;
  snapshot: ConversationGraphSnapshot;
  activeBranchId: BranchId;
  messagesByBranch: Record<BranchId, RenderedMessage[]>;
  conversations: DirectoryConversation[];
  account: AccountState;
};

type Screen = LoadingScreen | ErrorScreen | EmptyScreen | ReadyScreen;

type RenameTarget =
  | { kind: "conversation"; id: string; title: string }
  | { kind: "branch"; id: BranchId; title: string }
  | null;

type DeleteTarget =
  | { kind: "conversation"; id: string; title: string }
  | { kind: "branch"; id: BranchId; title: string }
  | null;

type ImageRetrySource = {
  messageId: string;
  imageId: string;
};

const BRANCH_DRAFT_ATTACHMENT_KEY = "__branch-draft__";

const FALLBACK_ACCOUNT: AccountState = {
  status: "signed_out",
  email: null,
  plan: null,
  error: null,
  login: null,
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback;
}

function accountView(
  state: DesktopAccountState,
  previous?: AccountState,
): AccountState {
  switch (state.status) {
    case "connected":
      return {
        status: "signed_in",
        email: state.account.email,
        plan: state.account.planType,
        error: null,
        login: null,
      };
    case "signing-in":
      return {
        status: "signing_in",
        email: null,
        plan: null,
        error: null,
        login: {
          loginId: state.login.loginId,
          verificationUrl: state.login.verificationUrl,
          userCode: state.login.userCode,
          expiresAt: state.login.expiresAt,
        },
      };
    case "error":
      return {
        status: "error",
        email: null,
        plan: null,
        error: state.message,
        login: previous?.login ?? null,
      };
    case "signed-out":
      return { ...FALLBACK_ACCOUNT };
  }
}

function directoryView(
  directory: ConversationDirectory,
): DirectoryConversation[] {
  const mapEntry = (
    entry: ConversationDirectoryEntry,
  ): DirectoryConversation => ({
    id: entry.id,
    title: entry.title || "Untitled conversation",
    preview: `${entry.branchCount} ${
      entry.branchCount === 1 ? "branch" : "branches"
    }`,
    updatedAt: entry.lastActiveAt,
    archivedAt: entry.archivedAt,
  });
  return [...directory.active.map(mapEntry), ...directory.archived.map(mapEntry)]
    .filter(
      (entry, index, entries) =>
        entries.findIndex((candidate) => candidate.id === entry.id) === index,
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function titleForConversation(
  conversationId: string,
  conversations: DirectoryConversation[],
  snapshot: ConversationGraphSnapshot,
): string {
  return (
    conversations.find((entry) => entry.id === conversationId)?.title ??
    snapshot.branches[snapshot.conversation.rootBranchId]?.title ??
    "Untitled conversation"
  );
}

function screenFromBootstrap(
  bootstrap: ConversationBootstrap,
  previousAccount?: AccountState,
): EmptyScreen | ReadyScreen {
  const conversations = directoryView(bootstrap.conversations);
  const account = accountView(bootstrap.account, previousAccount);
  if (bootstrap.kind === "empty") {
    return { kind: "empty", conversations, account };
  }
  return {
    kind: "ready",
    conversationId: bootstrap.conversationId,
    title: titleForConversation(
      bootstrap.conversationId,
      conversations,
      bootstrap.snapshot,
    ),
    snapshot: bootstrap.snapshot,
    activeBranchId: bootstrap.initialActiveBranchId,
    messagesByBranch: bootstrap.initialMessagesByBranch,
    conversations,
    account,
  };
}

function renderedMessagesFromResult(
  result: SendMessageResult,
): RenderedMessage[] {
  const byId = new Map<string, Message>();
  byId.set(result.optimisticUserMessage.id, result.optimisticUserMessage);
  for (const message of result.appendedMessages) byId.set(message.id, message);
  byId.set(result.pendingAssistantMessage.id, result.pendingAssistantMessage);
  return [...byId.values()]
    .filter(
      (message) =>
        message.role !== "assistant" ||
        message.content.trim().length > 0 ||
        (message.toolInvocations?.length ?? 0) > 0,
    )
    .map(toRenderedMessage);
}

function addMessagesByBranch(
  current: Record<BranchId, RenderedMessage[]>,
  messages: RenderedMessage[],
): Record<BranchId, RenderedMessage[]> {
  if (messages.length === 0) return current;
  const next = { ...current };
  for (const message of messages) {
    next[message.branchId] = mergeRenderedMessage(
      next[message.branchId] ?? [],
      message,
    );
  }
  return next;
}

function uniqueStreamId(): string {
  return crypto.randomUUID();
}

function optimisticUserMessage(
  branchId: BranchId,
  content: string,
): RenderedMessage {
  return {
    id: `optimistic-${crypto.randomUUID()}`,
    branchId,
    role: "user",
    content,
    createdAt: new Date().toISOString(),
    renderedHtml: "",
    hasBranchHighlight: false,
    branchAnchors: [],
  };
}

function streamEventView(event: BranchyStreamEvent): RendererStreamEvent {
  switch (event.type) {
    case "start":
      return { type: "start" };
    case "delta":
      return event;
    case "reasoning_summary":
      return {
        type: "reasoning_summary",
        summary: event.content ?? event.delta,
      };
    case "tool_progress":
      return {
        type: "tool_progress",
        toolType: event.tool,
        status: event.status,
        label:
          event.tool === "image_generation"
            ? event.status === "succeeded"
              ? "Finishing your image"
              : "Creating your image"
            : event.query
              ? `Searching for ${event.query}`
              : "Searching the web",
      };
    case "image_ready":
      return { type: "image_ready", imageId: event.imageId };
    case "complete":
      return { type: "complete" };
    case "cancelled":
      return event;
    case "error":
      return event;
  }
}

export function App(): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    try {
      const stored = window.localStorage.getItem("branchy:theme");
      if (stored === "light" || stored === "dark") return stored;
    } catch {
      // Fall through to the system preference.
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  });
  const [accountOpen, setAccountOpen] = useState(false);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [renameTarget, setRenameTarget] = useState<RenameTarget>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [branchDraft, setBranchDraft] =
    useState<BranchSelectionDraft | null>(null);
  const [startDraft, setStartDraft] = useState("");
  const [startPreset, setStartPreset] =
    useState<ComposerPreset>("fast");
  const [startAdvancedOpen, setStartAdvancedOpen] = useState(false);
  const [startModel, setStartModel] = useState("gpt-5.6-terra");
  const [startReasoningEffort, setStartReasoningEffort] =
    useState<ReasoningEffort>("medium");
  const [startTools, setStartTools] = useState<
    ConversationComposerTool[]
  >(["web-search"]);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [streamsByBranch, setStreamsByBranch] = useState<
    Record<BranchId, StreamState | undefined>
  >({});
  const [streamsToResume, setStreamsToResume] = useState<
    ActiveConversationStream[]
  >([]);
  const [draftsByBranch, setDraftsByBranch] = useState<
    Record<BranchId, string | undefined>
  >({});
  const [attachmentsByBranch, setAttachmentsByBranch] = useState<
    Record<BranchId, AttachmentDraft[] | undefined>
  >({});
  const [focusTokensByBranch, setFocusTokensByBranch] = useState<
    Record<BranchId, number | undefined>
  >({});
  const [retryByBranch, setRetryByBranch] = useState<
    Record<BranchId, ImageRetrySource | undefined>
  >({});
  const [imageUrls, setImageUrls] = useState<Record<string, string | undefined>>(
    {},
  );
  const activeConversationIdRef = useRef<string | null>(null);
  const attachmentsByBranchRef = useRef<
    Record<BranchId, AttachmentDraft[] | undefined>
  >({});
  const pendingUploadsRef = useRef(new PendingUploadRegistry());
  const subscriptionsRef = useRef(new Map<string, () => void>());
  const streamBranchesRef = useRef(new Map<string, BranchId>());
  const toastIdRef = useRef(0);

  const notify = useCallback(
    (message: string, tone: ToastMessage["tone"] = "info") => {
      const id = ++toastIdRef.current;
      setToasts((current) => [...current, { id, message, tone }].slice(-4));
      window.setTimeout(() => {
        setToasts((current) => current.filter((toast) => toast.id !== id));
      }, 4_500);
    },
    [],
  );

  const queueDraftSave = useCallback(
    (conversationId: string, branchId: BranchId, content: string) => {
      void window.branchy
        .saveComposerDraft({ conversationId, branchId, content })
        .catch((error: unknown) => {
          notify(
            errorMessage(error, "Branchy could not save this draft."),
            "error",
          );
        });
    },
    [notify],
  );

  const updateAttachmentsByBranch = useCallback(
    (
      update: (
        current: Record<BranchId, AttachmentDraft[] | undefined>,
      ) => Record<BranchId, AttachmentDraft[] | undefined>,
    ) => {
      const next = update(attachmentsByBranchRef.current);
      attachmentsByBranchRef.current = next;
      setAttachmentsByBranch(next);
    },
    [],
  );

  const removeDiscardedAttachments = useCallback(
    (conversationId: string, validBranchIds: ReadonlySet<BranchId>) => {
      visitDiscardedAttachments(
        attachmentsByBranchRef.current,
        validBranchIds,
        {
          upload: (localId) => {
            pendingUploadsRef.current.discard(localId);
          },
          ready: (attachmentId) => {
            void window.branchy
              .removeAttachment({
                conversationId,
                attachmentId,
              })
              .catch((error: unknown) => {
                notify(
                  errorMessage(
                    error,
                    "A discarded attachment could not be cleaned up.",
                  ),
                  "error",
                );
              });
          },
        },
      );
    },
    [notify],
  );

  const loadBootstrap = useCallback(
    async (input?: { conversationId?: string; branchId?: string }) => {
      for (const unsubscribe of subscriptionsRef.current.values()) {
        unsubscribe();
      }
      subscriptionsRef.current.clear();
      streamBranchesRef.current.clear();
      const bootstrap = await window.branchy.bootstrap(input);
      const nextConversationId =
        bootstrap.kind === "ready" ? bootstrap.conversationId : null;
      const previousConversationId = activeConversationIdRef.current;
      const sameConversation =
        nextConversationId !== null &&
        nextConversationId === previousConversationId;
      setBranchDraft((current) =>
        retainBranchSelectionDraft(
          current,
          previousConversationId,
          nextConversationId,
        ),
      );
      const validBranchIds = new Set(
        bootstrap.kind === "ready"
          ? Object.keys(bootstrap.snapshot.branches)
          : [],
      );
      if (previousConversationId) {
        removeDiscardedAttachments(
          previousConversationId,
          sameConversation ? validBranchIds : new Set(),
        );
      }
      activeConversationIdRef.current = nextConversationId;
      pendingUploadsRef.current.reconcile(
        nextConversationId,
        validBranchIds,
      );
      setScreen((current) =>
        screenFromBootstrap(
          bootstrap,
          current.kind === "ready" || current.kind === "empty"
            ? current.account
            : undefined,
        ),
      );
      setStreamsByBranch({});
      setStreamsToResume(
        bootstrap.kind === "ready" ? bootstrap.activeStreams : [],
      );
      if (sameConversation && bootstrap.kind === "ready") {
        setDraftsByBranch((current) => ({
          ...bootstrap.draftsByBranch,
          ...retainBranchRecords(current, bootstrap.snapshot.branches),
        }));
        updateAttachmentsByBranch((current) =>
          retainBranchRecords(current, bootstrap.snapshot.branches),
        );
        setRetryByBranch((current) =>
          retainBranchRecords(current, bootstrap.snapshot.branches),
        );
      } else {
        setDraftsByBranch(
          bootstrap.kind === "ready" ? bootstrap.draftsByBranch : {},
        );
        updateAttachmentsByBranch(() => ({}));
        setRetryByBranch({});
      }
      return bootstrap;
    },
    [removeDiscardedAttachments, updateAttachmentsByBranch],
  );

  useEffect(() => {
    let cancelled = false;
    if (typeof window.branchy?.bootstrap !== "function") {
      setScreen({
        kind: "error",
        message:
          "The native bridge is missing its conversation API. Restart Branchy Chat.",
      });
      return;
    }
    void window.branchy
      .bootstrap()
      .then((bootstrap) => {
        if (!cancelled) {
          activeConversationIdRef.current =
            bootstrap.kind === "ready" ? bootstrap.conversationId : null;
          setScreen(screenFromBootstrap(bootstrap));
          setStreamsToResume(
            bootstrap.kind === "ready" ? bootstrap.activeStreams : [],
          );
          setDraftsByBranch(
            bootstrap.kind === "ready" ? bootstrap.draftsByBranch : {},
          );
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setScreen({
            kind: "error",
            message: errorMessage(
              error,
              "Branchy could not load the local conversation library.",
            ),
          });
        }
      });
    return () => {
      cancelled = true;
      for (const unsubscribe of subscriptionsRef.current.values()) {
        unsubscribe();
      }
      subscriptionsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
    try {
      window.localStorage.setItem("branchy:theme", theme);
    } catch {
      // Local preference persistence is best effort.
    }
  }, [theme]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) {
        if (event.key === "Escape") {
          setHeaderMenuOpen(false);
          setAccountOpen(false);
          setSidebarCollapsed(true);
        }
        return;
      }
      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        void createConversation();
      } else if (event.key.toLowerCase() === "b") {
        event.preventDefault();
        setSidebarCollapsed((current) => !current);
      } else if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSidebarCollapsed(false);
        window.requestAnimationFrame(() => {
          document
            .querySelector<HTMLInputElement>(".search-field input")
            ?.focus();
        });
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  });

  useEffect(() => {
    if (
      (screen.kind !== "ready" && screen.kind !== "empty") ||
      screen.account.status !== "signing_in" ||
      !screen.account.login?.loginId
    ) {
      return;
    }
    let cancelled = false;
    const poll = window.setInterval(() => {
      void window.branchy
        .getAccountState()
        .then((state) => {
          if (cancelled) return;
          const next = accountView(state, screen.account);
          setScreen((current) =>
            current.kind === "ready" || current.kind === "empty"
              ? { ...current, account: next }
              : current,
          );
          if (next.status === "signed_in") {
            window.clearInterval(poll);
            notify("ChatGPT connected to Branchy.", "success");
          }
        })
        .catch(() => {
          // The visible challenge stays usable while a transient poll fails.
        });
    }, 1_500);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
    };
  }, [notify, screen]);

  const ready = screen.kind === "ready" ? screen : null;
  const conversations =
    screen.kind === "ready" || screen.kind === "empty"
      ? screen.conversations
      : [];
  const account =
    screen.kind === "ready" || screen.kind === "empty"
      ? screen.account
      : FALLBACK_ACCOUNT;

  useEffect(() => {
    if (!ready) return;
    const pending: Array<{
      messageId: string;
      imageId: string;
      key: string;
    }> = [];
    for (const messages of Object.values(ready.messagesByBranch)) {
      for (const message of messages) {
        for (const image of generatedImagesForMessage(message)) {
          const key = `${message.id}:${image.id}`;
          if (
            image.status === "succeeded" &&
            !image.url &&
            imageUrls[key] === undefined
          ) {
            pending.push({ messageId: message.id, imageId: image.id, key });
          }
        }
      }
    }
    for (const image of pending) {
      setImageUrls((current) => ({
        ...current,
        [image.key]: "__loading__",
      }));
      void window.branchy
        .getGeneratedImageUrl({
          conversationId: ready.conversationId,
          messageId: image.messageId,
          imageId: image.imageId,
        })
        .then((url) => {
          setImageUrls((current) => ({ ...current, [image.key]: url }));
        })
        .catch(() => {
          setImageUrls((current) => ({
            ...current,
            [image.key]: "__unavailable__",
          }));
        });
    }
  }, [imageUrls, ready]);

  const createConversation = useCallback(async () => {
    if (busyAction) return;
    setBusyAction("create-conversation");
    try {
      const result = await window.branchy.createConversation({
        title: "New conversation",
      });
      await loadBootstrap({ conversationId: result.conversationId });
    } catch (error) {
      notify(
        errorMessage(error, "Branchy could not create a conversation."),
        "error",
      );
    } finally {
      setBusyAction(null);
    }
  }, [busyAction, loadBootstrap, notify]);

  const refreshDirectory = useCallback(async () => {
    const directory = await window.branchy.listConversations({
      includeArchived: true,
    });
    const next = directoryView(directory);
    setScreen((current) =>
      current.kind === "ready" || current.kind === "empty"
        ? { ...current, conversations: next }
        : current,
    );
  }, []);

  const openConversation = useCallback(
    async (conversationId: string) => {
      setBusyAction(`open:${conversationId}`);
      try {
        await loadBootstrap({ conversationId });
        setSidebarCollapsed(true);
      } catch (error) {
        notify(
          errorMessage(error, "Branchy could not open that conversation."),
          "error",
        );
      } finally {
        setBusyAction(null);
      }
    },
    [loadBootstrap, notify],
  );

  const archiveConversation = useCallback(
    async (conversationId: string) => {
      try {
        await window.branchy.archiveConversation({ conversationId });
        if (ready?.conversationId === conversationId) {
          await loadBootstrap();
        } else {
          await refreshDirectory();
        }
        notify("Conversation archived.", "success");
      } catch (error) {
        notify(errorMessage(error, "Could not archive conversation."), "error");
      }
    },
    [loadBootstrap, notify, ready?.conversationId, refreshDirectory],
  );

  const unarchiveConversation = useCallback(
    async (conversationId: string) => {
      try {
        await window.branchy.unarchiveConversation({ conversationId });
        await refreshDirectory();
        notify("Conversation restored.", "success");
      } catch (error) {
        notify(errorMessage(error, "Could not restore conversation."), "error");
      }
    },
    [notify, refreshDirectory],
  );

  const patchCanvas = useCallback(
    (patch: ConversationCanvasPatch) => {
      if (!ready) return;
      setScreen((current) =>
        current.kind === "ready" &&
        current.conversationId === ready.conversationId
          ? {
              ...current,
              snapshot: {
                ...current.snapshot,
                canvas: applyCanvasPatch(current.snapshot, patch),
              },
            }
          : current,
      );
      void window.branchy
        .updateConversationCanvas({
          conversationId: ready.conversationId,
          ...patch,
        })
        .catch((error: unknown) => {
          notify(
            errorMessage(error, "Canvas position could not be saved."),
            "error",
          );
        });
    },
    [notify, ready],
  );

  const updateComposerSettings = useCallback(
    async (settings: ComposerSettingsSelection): Promise<void> => {
      if (!ready) return;
      const conversationId = ready.conversationId;
      setSettingsSaving(true);
      try {
        const result = await window.branchy.updateConversationSettings({
          conversationId,
          model: settings.model,
          reasoningEffort: settings.reasoningEffort,
          preset: settings.preset,
          tools: settings.tools,
        });
        setScreen((current) =>
          current.kind === "ready" &&
          current.conversationId === conversationId
            ? { ...current, snapshot: result.snapshot }
            : current,
        );
      } catch (error) {
        throw new Error(
          errorMessage(error, "Composer settings could not be saved."),
        );
      } finally {
        setSettingsSaving(false);
      }
    },
    [ready],
  );

  const openBranch = useCallback(
    (branchId: BranchId) => {
      if (!ready) return;
      const currentNode = ready.snapshot.canvas.nodes[branchId];
      patchCanvas({
        focusedBranchId: branchId,
        nodes: { [branchId]: { expanded: true } },
      });
      setScreen((current) =>
        current.kind === "ready" ? { ...current, activeBranchId: branchId } : current,
      );
      if (ready.messagesByBranch[branchId] && currentNode?.expanded) return;
      void window.branchy
        .openCanvasBranchCard({
          conversationId: ready.conversationId,
          branchId,
        })
        .then((result) => {
          setScreen((current) =>
            current.kind === "ready" &&
            current.conversationId === result.conversationId
              ? {
                  ...current,
                  messagesByBranch: {
                    ...current.messagesByBranch,
                    [branchId]: result.messages,
                  },
                }
              : current,
          );
        })
        .catch((error: unknown) => {
          notify(errorMessage(error, "Could not open this branch."), "error");
        });
    },
    [notify, patchCanvas, ready],
  );

  const subscribeToStream = useCallback(
    (
      streamId: string,
      branchId: BranchId,
      conversationId: string,
      assistantMessageId?: string,
    ) => {
      streamBranchesRef.current.set(streamId, branchId);
      setStreamsByBranch((current) => ({
        ...current,
        [branchId]: initialStreamState(
          streamId,
          branchId,
          assistantMessageId,
        ),
      }));
      const unsubscribe = window.branchy.subscribeStream(streamId, (event) => {
        const currentBranchId =
          streamBranchesRef.current.get(streamId) ?? branchId;
        setStreamsByBranch((current) => {
          const existing =
            current[currentBranchId] ??
            initialStreamState(
              streamId,
              currentBranchId,
              assistantMessageId,
            );
          return {
            ...current,
            [currentBranchId]: reduceStreamState(
              existing,
              streamEventView(event),
            ),
          };
        });
        if (event.type === "complete") {
          const { canonical } = event;
          const rendered: RenderedMessage = {
            ...canonical.assistantMessage,
            renderedHtml: canonical.assistantRenderedHtml,
            hasBranchHighlight: false,
            branchAnchors: [],
          };
          setScreen((current) => {
            if (
              current.kind !== "ready" ||
              current.conversationId !== canonical.conversationId
            ) {
              return current;
            }
            const branch = current.snapshot.branches[canonical.branchId];
            const messageIds = branch?.messageIds.includes(
              canonical.assistantMessage.id,
            )
              ? branch.messageIds
              : [...(branch?.messageIds ?? []), canonical.assistantMessage.id];
            return {
              ...current,
              snapshot: {
                ...current.snapshot,
                branches: branch
                  ? {
                      ...current.snapshot.branches,
                      [canonical.branchId]: { ...branch, messageIds },
                    }
                  : current.snapshot.branches,
                messages: {
                  ...current.snapshot.messages,
                  [canonical.assistantMessage.id]:
                    canonical.assistantMessage,
                },
              },
              messagesByBranch: {
                ...current.messagesByBranch,
                [canonical.branchId]: mergeRenderedMessage(
                  current.messagesByBranch[canonical.branchId] ?? [],
                  rendered,
                ),
              },
            };
          });
          window.setTimeout(() => {
            setStreamsByBranch((current) =>
              removeStreamStateIfMatching(
                current,
                canonical.branchId,
                streamId,
              ),
            );
          }, 200);
        }
        if (
          event.type === "complete" ||
          event.type === "cancelled" ||
          event.type === "error"
        ) {
          if (event.type !== "complete") {
            void loadBootstrap({
              conversationId,
              branchId: currentBranchId,
            }).catch(() => {
              setStreamsByBranch((current) =>
                removeStreamStateIfMatching(
                  current,
                  currentBranchId,
                  streamId,
                ),
              );
            });
          }
          window.queueMicrotask(() => {
            subscriptionsRef.current.get(streamId)?.();
            subscriptionsRef.current.delete(streamId);
            streamBranchesRef.current.delete(streamId);
          });
        }
      });
      subscriptionsRef.current.set(streamId, unsubscribe);
      return () => {
        subscriptionsRef.current.get(streamId)?.();
        subscriptionsRef.current.delete(streamId);
        streamBranchesRef.current.delete(streamId);
      };
    },
    [loadBootstrap],
  );

  useEffect(() => {
    if (!ready || streamsToResume.length === 0) {
      return;
    }
    for (const stream of streamsToResume) {
      if (
        stream.branchId in ready.snapshot.branches &&
        !subscriptionsRef.current.has(stream.streamId)
      ) {
        subscribeToStream(
          stream.streamId,
          stream.branchId,
          ready.conversationId,
          stream.assistantMessageId,
        );
      }
    }
    setStreamsToResume([]);
  }, [ready, streamsToResume, subscribeToStream]);

  const reconcileSend = useCallback(
    (
      result: SendMessageResult,
      targetBranchId: BranchId,
      streamId: string,
      provisionalMessageId?: string,
    ) => {
      const rendered = renderedMessagesFromResult(result);
      const finalBranchId = result.createdBranch?.id ?? targetBranchId;
      streamBranchesRef.current.set(streamId, finalBranchId);
      setScreen((current) => {
        if (
          current.kind !== "ready" ||
          current.conversationId !== result.conversationId
        ) {
          return current;
        }
        const cleaned = { ...current.messagesByBranch };
        if (provisionalMessageId) {
          cleaned[targetBranchId] = (cleaned[targetBranchId] ?? []).filter(
            (message) => message.id !== provisionalMessageId,
          );
        }
        return {
          ...current,
          snapshot: result.snapshot,
          activeBranchId: finalBranchId,
          messagesByBranch: addMessagesByBranch(cleaned, rendered),
        };
      });
      if (finalBranchId !== targetBranchId) {
        setStreamsByBranch((current) => {
          const activeStream = current[targetBranchId];
          const next = { ...current };
          delete next[targetBranchId];
          if (activeStream) {
            next[finalBranchId] = {
              ...activeStream,
              branchId: finalBranchId,
            };
          }
          return next;
        });
      }
    },
    [],
  );

  const sendOnBranch = useCallback(
    async (branchId: BranchId) => {
      if (!ready) return;
      const content = draftsByBranch[branchId]?.trim();
      if (!content || isStreamActive(streamsByBranch[branchId])) return;
      const streamId = uniqueStreamId();
      const attachmentIds = (attachmentsByBranch[branchId] ?? [])
        .filter((attachment) => attachment.status === "ready")
        .map((attachment) => attachment.id);
      const optimistic = optimisticUserMessage(branchId, content);
      const stopSubscription = subscribeToStream(
        streamId,
        branchId,
        ready.conversationId,
      );
      setDraftsByBranch((current) => ({ ...current, [branchId]: "" }));
      updateAttachmentsByBranch((current) => ({
        ...current,
        [branchId]: [],
      }));
      setScreen((current) =>
        current.kind === "ready"
          ? {
              ...current,
              messagesByBranch: {
                ...current.messagesByBranch,
                [branchId]: [
                  ...(current.messagesByBranch[branchId] ?? []),
                  optimistic,
                ],
              },
            }
          : current,
      );
      try {
        const retry = retryByBranch[branchId];
        const result = retry
          ? await window.branchy.retryGeneratedImage({
              conversationId: ready.conversationId,
              branchId,
              messageId: retry.messageId,
              imageId: retry.imageId,
              prompt: content,
              streamId,
            })
          : await window.branchy.sendMessage({
              conversationId: ready.conversationId,
              branchId,
              content,
              streamId,
              attachmentIds,
            });
        reconcileSend(result, branchId, streamId, optimistic.id);
        setRetryByBranch((current) => {
          const next = { ...current };
          delete next[branchId];
          return next;
        });
      } catch (error) {
        stopSubscription();
        const previousMessageIds = new Set(
          ready.snapshot.branches[branchId]?.messageIds ?? [],
        );
        let contentWasPersisted = false;
        try {
          const bootstrap = await loadBootstrap({
            conversationId: ready.conversationId,
            branchId,
          });
          if (bootstrap.kind === "ready") {
            contentWasPersisted = (
              bootstrap.snapshot.branches[branchId]?.messageIds ?? []
            ).some((messageId) => {
              const message = bootstrap.snapshot.messages[messageId];
              return (
                !previousMessageIds.has(messageId) &&
                message?.role === "user" &&
                message.content === content
              );
            });
          }
        } catch {
          setStreamsByBranch((current) => ({
            ...current,
            [branchId]: {
              ...(current[branchId] ??
                initialStreamState(streamId, branchId)),
              status: "error",
              error: errorMessage(
                error,
                "Branchy could not finish this reply.",
              ),
            },
          }));
        }
        if (!contentWasPersisted) {
          setDraftsByBranch((current) => ({
            ...current,
            [branchId]: content,
          }));
          queueDraftSave(ready.conversationId, branchId, content);
        }
        notify(
          errorMessage(error, "Branchy could not finish this reply."),
          "error",
        );
      }
    },
    [
      attachmentsByBranch,
      draftsByBranch,
      loadBootstrap,
      notify,
      queueDraftSave,
      ready,
      reconcileSend,
      retryByBranch,
      streamsByBranch,
      subscribeToStream,
    ],
  );

  const startConversationFromDraft = useCallback(async () => {
    const content = startDraft.trim();
    if (
      !content ||
      busyAction ||
      account.status !== "signed_in"
    ) {
      if (account.status !== "signed_in") {
        setAccountOpen(true);
      }
      return;
    }
    const tools = [...startTools];
    const title =
      content.length > 52 ? `${content.slice(0, 49)}…` : content;
    let conversationId: string | null = null;
    let rootBranchId: BranchId | null = null;
    let streamId: string | null = null;
    let stopSubscription: (() => void) | null = null;
    setBusyAction("start-conversation");
    try {
      const created = await window.branchy.createConversation({
        title,
        preset: startPreset,
        model: startModel,
        reasoningEffort: startReasoningEffort,
        tools,
      });
      conversationId = created.conversationId;
      rootBranchId = created.snapshot.conversation.rootBranchId;
      const bootstrap = await loadBootstrap({
        conversationId,
        branchId: rootBranchId,
      });
      if (bootstrap.kind !== "ready") {
        throw new Error("The new conversation could not be opened.");
      }
      streamId = uniqueStreamId();
      const optimistic = optimisticUserMessage(rootBranchId, content);
      stopSubscription = subscribeToStream(
        streamId,
        rootBranchId,
        conversationId,
      );
      setScreen((current) =>
        current.kind === "ready" &&
        current.conversationId === conversationId
          ? {
              ...current,
              messagesByBranch: {
                ...current.messagesByBranch,
                [rootBranchId!]: [
                  ...(current.messagesByBranch[rootBranchId!] ?? []),
                  optimistic,
                ],
              },
            }
          : current,
      );
      const result = await window.branchy.sendMessage({
        conversationId,
        branchId: rootBranchId,
        content,
        streamId,
        tools,
      });
      reconcileSend(result, rootBranchId, streamId, optimistic.id);
      setStartDraft("");
    } catch (error) {
      stopSubscription?.();
      if (conversationId && rootBranchId) {
        await loadBootstrap({
          conversationId,
          branchId: rootBranchId,
        }).catch(() => undefined);
      }
      notify(
        errorMessage(error, "Branchy could not start this conversation."),
        "error",
      );
    } finally {
      setBusyAction(null);
    }
  }, [
    account.status,
    busyAction,
    loadBootstrap,
    notify,
    reconcileSend,
    startDraft,
    startModel,
    startPreset,
    startReasoningEffort,
    startTools,
    subscribeToStream,
  ]);

  const discardBranchDraft = useCallback(() => {
    const draftAttachments =
      attachmentsByBranchRef.current[BRANCH_DRAFT_ATTACHMENT_KEY] ?? [];
    for (const attachment of draftAttachments) {
      if (attachment.id.startsWith("upload-")) {
        pendingUploadsRef.current.discard(attachment.id);
      } else if (ready) {
        void window.branchy
          .removeAttachment({
            conversationId: ready.conversationId,
            attachmentId: attachment.id,
          })
          .catch((error: unknown) => {
            notify(
              errorMessage(
                error,
                "A discarded branch attachment could not be cleaned up.",
              ),
              "error",
            );
          });
      }
    }
    updateAttachmentsByBranch((current) => {
      const next = { ...current };
      delete next[BRANCH_DRAFT_ATTACHMENT_KEY];
      return next;
    });
    setBranchDraft(null);
  }, [notify, ready, updateAttachmentsByBranch]);

  const beginBranchDraft = useCallback(
    (draft: BranchSelectionDraft) => {
      if (branchDraft) discardBranchDraft();
      setBranchDraft(draft);
    },
    [branchDraft, discardBranchDraft],
  );

  const stopBranch = useCallback(
    async (branchId: BranchId, mode: BranchStopMode = "edit") => {
      if (!ready) return;
      const stream = streamsByBranch[branchId];
      if (!stream) return;
      const prompt =
        mode === "edit"
          ? latestUserPrompt(ready.messagesByBranch[branchId] ?? [])
          : "";
      try {
        await window.branchy.cancelMessage({
          conversationId: ready.conversationId,
          streamId: stream.streamId,
        });
        setStreamsByBranch((current) => ({
          ...current,
          [branchId]: current[branchId]
            ? { ...current[branchId]!, status: "cancelled" }
            : undefined,
        }));
        setDraftsByBranch((current) => ({
          ...current,
          [branchId]: prompt,
        }));
        queueDraftSave(ready.conversationId, branchId, prompt);
        if (mode === "edit" && prompt) {
          setFocusTokensByBranch((current) => ({
            ...current,
            [branchId]: (current[branchId] ?? 0) + 1,
          }));
        }
      } catch (error) {
        notify(errorMessage(error, "Could not stop this response."), "error");
      }
    },
    [notify, queueDraftSave, ready, streamsByBranch],
  );

  const createChildBranch = useCallback(
    async (prompt: string) => {
      if (!ready || !branchDraft) return;
      const draftAttachments =
        attachmentsByBranch[BRANCH_DRAFT_ATTACHMENT_KEY] ?? [];
      if (
        draftAttachments.some(
          (attachment) => attachment.status === "uploading",
        )
      ) {
        notify("Wait for branch attachments to finish uploading.", "error");
        return;
      }
      const attachmentIds = draftAttachments
        .filter((attachment) => attachment.status === "ready")
        .map((attachment) => attachment.id);
      const streamId = uniqueStreamId();
      const provisionalBranchId = `draft-${streamId}`;
      const parentNode =
        ready.snapshot.canvas.nodes[branchDraft.parentBranchId];
      const provisionalBranch: Branch = {
        id: provisionalBranchId,
        parentId: branchDraft.parentBranchId,
        title:
          branchDraft.excerpt.length > 56
            ? `${branchDraft.excerpt.slice(0, 53)}…`
            : branchDraft.excerpt,
        createdFrom: {
          messageId: branchDraft.messageId,
          excerpt: branchDraft.excerpt,
          span: branchDraft.span,
        },
        messageIds: [],
        createdAt: new Date().toISOString(),
      };
      const optimistic = optimisticUserMessage(provisionalBranchId, prompt);
      provisionalBranch.messageIds = [optimistic.id];
      const provisionalSnapshot: ConversationGraphSnapshot = {
        ...ready.snapshot,
        branches: {
          ...ready.snapshot.branches,
          [provisionalBranchId]: provisionalBranch,
        },
        messages: {
          ...ready.snapshot.messages,
          [optimistic.id]: optimistic,
        },
        canvas: {
          ...ready.snapshot.canvas,
          focusedBranchId: provisionalBranchId,
          nodes: {
            ...ready.snapshot.canvas.nodes,
            [branchDraft.parentBranchId]: {
              ...ready.snapshot.canvas.nodes[branchDraft.parentBranchId]!,
              expanded: true,
            },
            [provisionalBranchId]: {
              branchId: provisionalBranchId,
              x:
                (parentNode?.x ?? 0) +
                (parentNode?.width ?? 610) +
                110,
              y: parentNode?.y ?? 0,
              folded: false,
              expanded: true,
            },
          },
        },
      };
      setBusyAction("create-branch");
      setBranchDraft(null);
      updateAttachmentsByBranch((current) => {
        const next = { ...current };
        delete next[BRANCH_DRAFT_ATTACHMENT_KEY];
        return next;
      });
      setScreen((current) =>
        current.kind === "ready"
          ? {
              ...current,
              snapshot: provisionalSnapshot,
              activeBranchId: provisionalBranchId,
              messagesByBranch: {
                ...current.messagesByBranch,
                [provisionalBranchId]: [optimistic],
              },
            }
          : current,
      );
      const stopSubscription = subscribeToStream(
        streamId,
        provisionalBranchId,
        ready.conversationId,
      );
      try {
        const result = await window.branchy.sendMessage({
          conversationId: ready.conversationId,
          content: prompt,
          streamId,
          attachmentIds,
          branchDraft: {
            parentBranchId: branchDraft.parentBranchId,
            messageId: branchDraft.messageId,
            span: branchDraft.span,
            excerpt: branchDraft.excerpt,
          },
        });
        reconcileSend(
          result,
          provisionalBranchId,
          streamId,
          optimistic.id,
        );
        notify("Child branch created.", "success");
      } catch (error) {
        stopSubscription();
        await loadBootstrap({
          conversationId: ready.conversationId,
          branchId: branchDraft.parentBranchId,
        }).catch(() => {
          setStreamsByBranch((current) => ({
            ...current,
            [provisionalBranchId]: {
              ...(current[provisionalBranchId] ??
                initialStreamState(streamId, provisionalBranchId)),
              status: "error",
              error: errorMessage(error, "Could not create this branch."),
            },
          }));
        });
        notify(errorMessage(error, "Could not create this branch."), "error");
      } finally {
        setBusyAction(null);
      }
    },
    [
      branchDraft,
      attachmentsByBranch,
      loadBootstrap,
      notify,
      ready,
      reconcileSend,
      subscribeToStream,
      updateAttachmentsByBranch,
    ],
  );

  const saveChildBranchNote = useCallback(
    async (prompt: string) => {
      if (!ready || !branchDraft) return;
      const content = prompt.trim();
      if (!content) return;
      const draftAttachments =
        attachmentsByBranch[BRANCH_DRAFT_ATTACHMENT_KEY] ?? [];
      if (
        draftAttachments.some(
          (attachment) => attachment.status !== "ready",
        )
      ) {
        notify(
          "Resolve branch attachments before saving this note.",
          "error",
        );
        return;
      }
      setBusyAction("save-branch-note");
      try {
        const result = await window.branchy.saveBranchNote({
          conversationId: ready.conversationId,
          parentBranchId: branchDraft.parentBranchId,
          messageId: branchDraft.messageId,
          span: branchDraft.span,
          excerpt: branchDraft.excerpt,
          content,
          attachmentIds: draftAttachments.map(
            (attachment) => attachment.id,
          ),
        });
        setBranchDraft(null);
        updateAttachmentsByBranch((current) => {
          const next = { ...current };
          delete next[BRANCH_DRAFT_ATTACHMENT_KEY];
          return next;
        });
        setScreen((current) =>
          current.kind === "ready" &&
          current.conversationId === result.conversationId
            ? {
                ...current,
                snapshot: result.snapshot,
                activeBranchId: result.branch.id,
                messagesByBranch: addMessagesByBranch(
                  current.messagesByBranch,
                  result.appendedMessages.map(toRenderedMessage),
                ),
              }
            : current,
        );
        notify("Branch note saved.", "success");
      } catch (error) {
        notify(
          errorMessage(error, "Branchy could not save this branch note."),
          "error",
        );
      } finally {
        setBusyAction(null);
      }
    },
    [
      attachmentsByBranch,
      branchDraft,
      notify,
      ready,
      updateAttachmentsByBranch,
    ],
  );

  const chooseFiles = useCallback(
    async (branchId: BranchId, files: File[]) => {
      if (!ready) return;
      let constraints;
      try {
        constraints = await window.branchy.getAttachmentConstraints();
      } catch (error) {
        notify(
          errorMessage(error, "Attachment limits could not be checked."),
          "error",
        );
        return;
      }
      const existing = attachmentsByBranch[branchId] ?? [];
      const available = Math.max(0, constraints.maxAttachments - existing.length);
      const selected = files.slice(0, available);
      if (selected.length < files.length) {
        notify(
          `You can attach up to ${constraints.maxAttachments} files per message.`,
          "error",
        );
      }
      for (const file of selected) {
        const localId = `upload-${crypto.randomUUID()}`;
        const draft: AttachmentDraft = {
          id: localId,
          name: file.name,
          contentType: file.type || "application/octet-stream",
          size: file.size,
          status: "uploading",
          error: null,
        };
        updateAttachmentsByBranch((current) => ({
          ...current,
          [branchId]: [...(current[branchId] ?? []), draft],
        }));
        if (file.size > constraints.maxSizeBytes) {
          updateAttachmentsByBranch((current) => ({
            ...current,
            [branchId]: (current[branchId] ?? []).map((attachment) =>
              attachment.id === localId
                ? {
                    ...attachment,
                    status: "error",
                    error: "This file is larger than the attachment limit.",
                  }
                : attachment,
            ),
          }));
          continue;
        }
        const uploadConversationId = ready.conversationId;
        pendingUploadsRef.current.begin(
          localId,
          uploadConversationId,
          branchId,
        );
        void file
          .arrayBuffer()
          .then((bytes) =>
            window.branchy.createAttachment({
              conversationId: uploadConversationId,
              fileName: file.name,
              contentType: file.type || "application/octet-stream",
              bytes,
            }),
          )
          .then((attachment) => {
            const pending = pendingUploadsRef.current.settle(localId);
            if (!pending || pending.discarded) {
              return window.branchy
                .removeAttachment({
                  conversationId:
                    pending?.conversationId ?? uploadConversationId,
                  attachmentId: attachment.id,
                })
                .catch((error: unknown) => {
                  notify(
                    errorMessage(
                      error,
                      "A cancelled upload could not be cleaned up.",
                    ),
                    "error",
                  );
                });
            }
            updateAttachmentsByBranch((current) => ({
              ...current,
              [branchId]: (current[branchId] ?? []).map((candidate) =>
                candidate.id === localId
                  ? {
                      ...candidate,
                      id: attachment.id,
                      status: "ready",
                    }
                  : candidate,
              ),
            }));
          })
          .catch((error: unknown) => {
            pendingUploadsRef.current.settle(localId);
            updateAttachmentsByBranch((current) => ({
              ...current,
              [branchId]: (current[branchId] ?? []).map((candidate) =>
                candidate.id === localId
                  ? {
                      ...candidate,
                      status: "error",
                      error: errorMessage(error, "Upload failed."),
                    }
                  : candidate,
              ),
            }));
          });
      }
    },
    [
      attachmentsByBranch,
      notify,
      ready,
      updateAttachmentsByBranch,
    ],
  );

  const removeAttachment = useCallback(
    (branchId: BranchId, attachmentId: string) => {
      if (!ready) return;
      updateAttachmentsByBranch((current) => ({
        ...current,
        [branchId]: (current[branchId] ?? []).filter(
          (attachment) => attachment.id !== attachmentId,
        ),
      }));
      if (attachmentId.startsWith("upload-")) {
        pendingUploadsRef.current.discard(attachmentId);
      } else {
        void window.branchy
          .removeAttachment({
            conversationId: ready.conversationId,
            attachmentId,
          })
          .catch((error: unknown) => {
            notify(errorMessage(error, "Could not remove attachment."), "error");
          });
      }
    },
    [notify, ready, updateAttachmentsByBranch],
  );

  const transcribe = useCallback(
    async (audio: Uint8Array, contentType: string): Promise<string> => {
      if (contentType !== "audio/wav") {
        throw new Error("Branchy expected a WAV recording.");
      }
      const result = await window.branchy.transcribeAudio({
        contentType: "audio/wav",
        bytes: audio,
      });
      return result.transcript;
    },
    [],
  );

  const downloadImage = useCallback(
    async (messageId: string, imageId: string) => {
      if (!ready) return;
      try {
        const result = await window.branchy.saveGeneratedImage({
          conversationId: ready.conversationId,
          messageId,
          imageId,
          suggestedFileName: `branchy-${imageId}.png`,
        });
        if (result.saved) {
          notify(`Saved ${result.fileName ?? "image"}.`, "success");
        }
      } catch (error) {
        notify(errorMessage(error, "Could not save this image."), "error");
      }
    },
    [notify, ready],
  );

  const retryImage = useCallback(
    (
      branchId: BranchId,
      messageId: string,
      imageId: string,
      prompt: string,
    ) => {
      if (!ready) return;
      setDraftsByBranch((current) => ({ ...current, [branchId]: prompt }));
      queueDraftSave(ready.conversationId, branchId, prompt);
      setRetryByBranch((current) => ({
        ...current,
        [branchId]: { messageId, imageId },
      }));
      setFocusTokensByBranch((current) => ({
        ...current,
        [branchId]: (current[branchId] ?? 0) + 1,
      }));
      openBranch(branchId);
    },
    [openBranch, queueDraftSave, ready],
  );

  const rename = useCallback(
    async (value: string) => {
      if (!ready || !renameTarget) return;
      setBusyAction("rename");
      try {
        if (renameTarget.kind === "conversation") {
          const result = await window.branchy.renameConversation({
            conversationId: ready.conversationId,
            title: value,
          });
          setScreen((current) =>
            current.kind === "ready"
              ? { ...current, title: value, snapshot: result.snapshot }
              : current,
          );
          await refreshDirectory();
        } else {
          const result = await window.branchy.renameBranch({
            conversationId: ready.conversationId,
            branchId: renameTarget.id,
            title: value,
          });
          setScreen((current) =>
            current.kind === "ready"
              ? { ...current, snapshot: result.snapshot }
              : current,
          );
        }
        setRenameTarget(null);
      } catch (error) {
        notify(errorMessage(error, "Could not save the new name."), "error");
      } finally {
        setBusyAction(null);
      }
    },
    [notify, ready, refreshDirectory, renameTarget],
  );

  const removeTarget = useCallback(async () => {
    if (!ready || !deleteTarget) return;
    setBusyAction("delete");
    try {
      if (deleteTarget.kind === "conversation") {
        await window.branchy.deleteConversation({
          conversationId: deleteTarget.id,
        });
        setDeleteTarget(null);
        await loadBootstrap();
      } else {
        const result = await window.branchy.deleteBranch({
          conversationId: ready.conversationId,
          branchId: deleteTarget.id,
        });
        const survivingBranchIds = new Set(
          Object.keys(result.snapshot.branches),
        );
        removeDiscardedAttachments(
          ready.conversationId,
          survivingBranchIds,
        );
        pendingUploadsRef.current.reconcile(
          ready.conversationId,
          survivingBranchIds,
        );
        setDraftsByBranch((current) =>
          retainBranchRecords(current, result.snapshot.branches),
        );
        updateAttachmentsByBranch((current) =>
          retainBranchRecords(current, result.snapshot.branches),
        );
        setRetryByBranch((current) =>
          retainBranchRecords(current, result.snapshot.branches),
        );
        setFocusTokensByBranch((current) =>
          retainBranchRecords(current, result.snapshot.branches),
        );
        setScreen((current) => {
          if (current.kind !== "ready") return current;
          return {
            ...current,
            snapshot: result.snapshot,
            activeBranchId: result.parentBranchId,
            messagesByBranch: retainBranchRecords(
              current.messagesByBranch,
              result.snapshot.branches,
            ),
          };
        });
        setDeleteTarget(null);
      }
      notify("Deleted.", "success");
    } catch (error) {
      notify(errorMessage(error, "Could not delete this item."), "error");
    } finally {
      setBusyAction(null);
    }
  }, [
    deleteTarget,
    loadBootstrap,
    notify,
    ready,
    removeDiscardedAttachments,
    updateAttachmentsByBranch,
  ]);

  const startLogin = useCallback(async () => {
    setBusyAction("login");
    try {
      const challenge = await window.branchy.startChatGptLogin();
      setScreen((current) =>
        current.kind === "ready" || current.kind === "empty"
          ? {
              ...current,
              account: {
                status: "signing_in",
                email: null,
                plan: null,
                error: null,
                login: {
                  loginId: challenge.loginId,
                  verificationUrl: challenge.verificationUrl,
                  userCode: challenge.userCode,
                  expiresAt: challenge.expiresAt,
                },
              },
            }
          : current,
      );
    } catch (error) {
      setScreen((current) =>
        current.kind === "ready" || current.kind === "empty"
          ? {
              ...current,
              account: {
                ...current.account,
                status: "error",
                error: errorMessage(error, "ChatGPT sign-in could not start."),
              },
            }
          : current,
      );
    } finally {
      setBusyAction(null);
    }
  }, []);

  const cancelLogin = useCallback(async () => {
    const loginId = account.login?.loginId;
    if (!loginId) return;
    setBusyAction("cancel-login");
    try {
      await window.branchy.cancelChatGptLogin({ loginId });
      setScreen((current) =>
        current.kind === "ready" || current.kind === "empty"
          ? { ...current, account: { ...FALLBACK_ACCOUNT } }
          : current,
      );
    } finally {
      setBusyAction(null);
    }
  }, [account.login?.loginId]);

  const logout = useCallback(async () => {
    setBusyAction("logout");
    try {
      const state = await window.branchy.logoutChatGpt();
      setScreen((current) =>
        current.kind === "ready" || current.kind === "empty"
          ? { ...current, account: accountView(state) }
          : current,
      );
      notify("Signed out of Branchy.", "success");
    } catch (error) {
      notify(errorMessage(error, "Could not sign out."), "error");
    } finally {
      setBusyAction(null);
    }
  }, [notify]);

  const openExternal = useCallback((url: string) => {
    void window.branchy.openExternal({ url });
  }, []);

  const exportArchive = useCallback(async () => {
    setHeaderMenuOpen(false);
    try {
      const result = await window.branchy.exportArchive();
      if (result.saved) {
        notify(
          `Exported ${result.conversationCount} ${
            result.conversationCount === 1 ? "conversation" : "conversations"
          }.`,
          "success",
        );
      }
    } catch (error) {
      notify(errorMessage(error, "Could not export the archive."), "error");
    }
  }, [notify]);

  const importArchive = useCallback(async () => {
    setHeaderMenuOpen(false);
    try {
      const result = await window.branchy.importArchive({
        conflictPolicy: "duplicate",
      });
      if (!result.cancelled) {
        await refreshDirectory();
        notify(
          `Imported ${result.importedConversationIds.length} ${
            result.importedConversationIds.length === 1
              ? "conversation"
              : "conversations"
          }.`,
          "success",
        );
      }
    } catch (error) {
      notify(errorMessage(error, "Could not import this archive."), "error");
    }
  }, [notify, refreshDirectory]);

  const resolveImageUrl = useCallback(
    (messageId: string, imageId: string, fallback: string | null) => {
      const cached = imageUrls[`${messageId}:${imageId}`];
      return fallback ?? cached ?? null;
    },
    [imageUrls],
  );

  const sidebar = (
    <Sidebar
      conversations={conversations}
      activeConversationId={ready?.conversationId ?? null}
      account={account}
      collapsed={false}
      overlay={screen.kind === "ready"}
      hideToggle={screen.kind === "empty"}
      theme={theme}
      busy={busyAction === "create-conversation"}
      onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
      onNewConversation={() => {
        setSidebarCollapsed(true);
        void createConversation();
      }}
      onOpenConversation={(conversationId) => void openConversation(conversationId)}
      onArchiveConversation={(conversationId) =>
        void archiveConversation(conversationId)
      }
      onUnarchiveConversation={(conversationId) =>
        void unarchiveConversation(conversationId)
      }
      onOpenAccount={() => setAccountOpen(true)}
      onToggleTheme={() =>
        setTheme((current) => (current === "dark" ? "light" : "dark"))
      }
    />
  );

  return (
    <div className="app-shell">
      {screen.kind === "empty" ? sidebar : null}
      {screen.kind === "ready" && !sidebarCollapsed ? (
        <>
          <button
            className="sidebar-scrim"
            type="button"
            aria-label="Close conversation drawer"
            onClick={() => setSidebarCollapsed(true)}
          />
          {sidebar}
        </>
      ) : null}

      {screen.kind === "loading" ? (
        <main className="screen-state" aria-busy="true">
          <BrandMark className="brand-mark--large" size={44} />
          <span className="spinner spinner--large" />
          <p>Opening your branch map…</p>
        </main>
      ) : screen.kind === "error" ? (
        <main className="screen-state">
          <span className="screen-state__error">
            <Icon name="info" size={22} />
          </span>
          <h1>Branchy could not start</h1>
          <p>{screen.message}</p>
          <button
            className="primary-button"
            type="button"
            onClick={() => window.location.reload()}
          >
            Try again
          </button>
        </main>
      ) : screen.kind === "empty" ? (
        <main className="empty-workspace empty-workspace--start">
          <section className="empty-start">
            <BrandMark className="empty-workspace__mark" size={54} />
            <h1>Sign in once, keep branching</h1>
            <p>
              Start a conversation here. Any reply can become a connected path
              without losing the context that led there.
            </p>
            <form
              className="start-composer"
              onSubmit={(event) => {
                event.preventDefault();
                void startConversationFromDraft();
              }}
            >
              <fieldset className="start-composer__presets">
                <legend>Start mode</legend>
                {(
                  [
                    {
                      id: "fast",
                      label: "Fast",
                      detail: "GPT‑5.6 Terra · medium",
                      model: "gpt-5.6-terra",
                      effort: "medium",
                      tools: ["web-search"],
                    },
                    {
                      id: "reasoning",
                      label: "Reasoning",
                      detail: "GPT‑5.6 Sol · high",
                      model: "gpt-5.6-sol",
                      effort: "high",
                      tools: ["web-search"],
                    },
                    {
                      id: "study",
                      label: "Study",
                      detail: "GPT‑5.6 Sol · medium",
                      model: "gpt-5.6-sol",
                      effort: "medium",
                      tools: ["study-and-learn", "web-search"],
                    },
                    {
                      id: "custom",
                      label: "Custom",
                      detail: "Choose model, effort & tools",
                      model: null,
                      effort: null,
                      tools: null,
                    },
                  ] as const
                ).map((option) => (
                  <button
                    className={
                      startPreset === option.id ? "is-selected" : ""
                    }
                    key={option.id}
                    type="button"
                    onClick={() => {
                      setStartPreset(option.id);
                      if (option.model && option.effort && option.tools) {
                        setStartModel(option.model);
                        setStartReasoningEffort(option.effort);
                        setStartTools([...option.tools]);
                      } else {
                        setStartAdvancedOpen(true);
                      }
                    }}
                  >
                    <strong>{option.label}</strong>
                    <span>{option.detail}</span>
                  </button>
                ))}
              </fieldset>

              <button
                className="start-composer__advanced-toggle"
                type="button"
                aria-expanded={startAdvancedOpen}
                onClick={() =>
                  setStartAdvancedOpen((current) => !current)
                }
              >
                <Icon
                  name={
                    startAdvancedOpen
                      ? "chevron-down"
                      : "chevron-right"
                  }
                  size={14}
                />
                Advanced
              </button>
              {startAdvancedOpen ? (
                <div className="start-composer__advanced">
                  <label>
                    <span>Model</span>
                    <select
                      value={startModel}
                      onChange={(event) => {
                        setStartPreset("custom");
                        setStartModel(event.target.value);
                      }}
                    >
                      <option value="gpt-5.6-terra">
                        GPT‑5.6 Terra · faster
                      </option>
                      <option value="gpt-5.6-luna">
                        GPT‑5.6 Luna · efficient
                      </option>
                      <option value="gpt-5.6-sol">
                        GPT‑5.6 Sol · deeper reasoning
                      </option>
                    </select>
                  </label>
                  <label>
                    <span>Reasoning</span>
                    <select
                      value={startReasoningEffort}
                      onChange={(event) => {
                        setStartPreset("custom");
                        setStartReasoningEffort(
                          event.target.value as ReasoningEffort,
                        );
                      }}
                    >
                      {(
                        [
                          "low",
                          "medium",
                          "high",
                          "xhigh",
                          "max",
                          "ultra",
                        ] as const
                      ).map((effort) => (
                        <option value={effort} key={effort}>
                          {effort === "xhigh"
                            ? "Extra high"
                            : `${effort[0]?.toUpperCase()}${effort.slice(1)}`}
                        </option>
                      ))}
                    </select>
                  </label>
                  <fieldset className="start-composer__tools">
                    <legend>Tools</legend>
                    {(
                      [
                        {
                          id: "web-search",
                          label: "Web search",
                          detail: "Current source lookup",
                        },
                        {
                          id: "study-and-learn",
                          label: "Study & learn",
                          detail: "Guided explanations",
                        },
                        {
                          id: "file-upload",
                          label: "File context",
                          detail: "Enable attachments",
                        },
                      ] as const
                    ).map((tool) => (
                      <label
                        className="start-composer__tool-toggle"
                        key={tool.id}
                      >
                        <input
                          type="checkbox"
                          checked={startTools.includes(tool.id)}
                          onChange={(event) => {
                            setStartPreset("custom");
                            setStartTools((current) =>
                              event.target.checked
                                ? current.includes(tool.id)
                                  ? current
                                  : [...current, tool.id]
                                : current.filter(
                                    (candidate) => candidate !== tool.id,
                                  ),
                            );
                          }}
                        />
                        <span>
                          <strong>{tool.label}</strong>
                          <small>{tool.detail}</small>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                </div>
              ) : null}

              <div className="start-composer__input">
                <span className="start-composer__input-mark">
                  <Icon name="pencil" size={17} />
                </span>
                <label className="sr-only" htmlFor="start-conversation-prompt">
                  Start a new conversation
                </label>
                <textarea
                  id="start-conversation-prompt"
                  rows={2}
                  value={startDraft}
                  disabled={busyAction === "start-conversation"}
                  onChange={(event) => setStartDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      void startConversationFromDraft();
                    }
                  }}
                  placeholder="Ask to explore a new direction…"
                />
                <button
                  className="start-composer__send"
                  type="submit"
                  disabled={
                    !startDraft.trim() ||
                    busyAction === "start-conversation" ||
                    account.status !== "signed_in"
                  }
                >
                  {busyAction === "start-conversation" ? (
                    <span className="spinner" />
                  ) : (
                    <Icon name="send" size={17} />
                  )}
                  <span>Start chat</span>
                </button>
              </div>
            </form>
            <p className="empty-start__hint">
              {startTools.length > 0
                ? `${startTools.length} ${
                    startTools.length === 1 ? "tool" : "tools"
                  } selected.`
                : "No tools selected."}{" "}
              Your first message is sent immediately.
            </p>
            {account.status !== "signed_in" ? (
              <button
                className="text-button"
                type="button"
                onClick={() => setAccountOpen(true)}
              >
                <Icon name="user" size={15} />
                Connect ChatGPT to start
              </button>
            ) : null}
          </section>
        </main>
      ) : (
        <main className="workspace">
          <header className="workspace__header">
            <div className="workspace__title">
              <button
                className="workspace__canvas-selector"
                type="button"
                onClick={() => setSidebarCollapsed(false)}
                aria-label="Open conversation drawer"
                title="Conversations (⌘B)"
              >
                <Icon name="sidebar" size={16} />
                <span>{screen.title}</span>
                <Icon name="chevron-down" size={14} />
              </button>
              <span className="workspace__branch-count">
                {Object.keys(screen.snapshot.branches).length}{" "}
                {Object.keys(screen.snapshot.branches).length === 1
                  ? "branch"
                  : "branches"}
              </span>
            </div>
            <div className="workspace__actions">
              <button
                className="icon-button icon-button--quiet"
                type="button"
                onClick={() =>
                  setTheme((current) =>
                    current === "dark" ? "light" : "dark",
                  )
                }
                aria-label={`Use ${theme === "dark" ? "light" : "dark"} theme`}
                title={`Use ${theme === "dark" ? "light" : "dark"} theme`}
              >
                <Icon name={theme === "dark" ? "sun" : "moon"} size={17} />
              </button>
              {account.status !== "signed_in" ? (
                <button
                  className="connect-button"
                  type="button"
                  onClick={() => setAccountOpen(true)}
                >
                  <span className="account-status account-status--signed_out" />
                  Connect ChatGPT
                </button>
              ) : (
                <button
                  className="account-pill"
                  type="button"
                  onClick={() => setAccountOpen(true)}
                  title={account.email ?? "ChatGPT account"}
                >
                  <span className="account-status account-status--signed_in" />
                  ChatGPT
                </button>
              )}
              <button
                className="new-canvas-button"
                type="button"
                disabled={busyAction === "create-conversation"}
                onClick={() => void createConversation()}
              >
                {busyAction === "create-conversation" ? (
                  <span className="spinner" />
                ) : (
                  <Icon name="plus" size={15} />
                )}
                New canvas
              </button>
              <div className="menu-anchor">
                <button
                  className="icon-button"
                  type="button"
                  aria-label="Conversation actions"
                  aria-expanded={headerMenuOpen}
                  onClick={() => setHeaderMenuOpen((current) => !current)}
                >
                  <Icon name="more" />
                </button>
                {headerMenuOpen ? (
                  <div className="context-menu context-menu--header">
                    <button
                      type="button"
                      onClick={() => {
                        setHeaderMenuOpen(false);
                        setRenameTarget({
                          kind: "conversation",
                          id: screen.conversationId,
                          title: screen.title,
                        });
                      }}
                    >
                      <Icon name="pencil" size={15} />
                      Rename conversation
                    </button>
                    <button type="button" onClick={() => void exportArchive()}>
                      <Icon name="arrow-down" size={15} />
                      Export archive
                    </button>
                    <button type="button" onClick={() => void importArchive()}>
                      <Icon name="arrow-up" size={15} />
                      Import archive
                    </button>
                    <span className="context-menu__separator" />
                    <button
                      type="button"
                      onClick={() => {
                        setHeaderMenuOpen(false);
                        void archiveConversation(screen.conversationId);
                      }}
                    >
                      <Icon name="archive" size={15} />
                      Archive conversation
                    </button>
                    <button
                      className="is-danger"
                      type="button"
                      onClick={() => {
                        setHeaderMenuOpen(false);
                        setDeleteTarget({
                          kind: "conversation",
                          id: screen.conversationId,
                          title: screen.title,
                        });
                      }}
                    >
                      <Icon name="trash" size={15} />
                      Delete conversation
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </header>

          <section className="canvas-shell">
            <BranchCanvas
              snapshot={screen.snapshot}
              activeBranchId={screen.activeBranchId}
              messagesByBranch={screen.messagesByBranch}
              streamsByBranch={streamsByBranch}
              draftsByBranch={draftsByBranch}
              attachmentsByBranch={attachmentsByBranch}
              focusTokensByBranch={focusTokensByBranch}
              settingsSaving={settingsSaving}
              branchDraft={branchDraft}
              branchDraftAttachments={
                attachmentsByBranch[BRANCH_DRAFT_ATTACHMENT_KEY] ?? []
              }
              isCreatingBranch={
                busyAction === "create-branch" ||
                busyAction === "save-branch-note"
              }
              signedIn={account.status === "signed_in"}
              onOpenBranch={openBranch}
              onPatchCanvas={patchCanvas}
              onRenameBranch={(branchId) => {
                const branch = screen.snapshot.branches[branchId];
                if (branch) {
                  setRenameTarget({
                    kind: "branch",
                    id: branchId,
                    title: branch.title,
                  });
                }
              }}
              onDeleteBranch={(branchId) => {
                const branch = screen.snapshot.branches[branchId];
                if (branch) {
                  setDeleteTarget({
                    kind: "branch",
                    id: branchId,
                    title: branch.title,
                  });
                }
              }}
              onCreateBranch={beginBranchDraft}
              onCancelBranchDraft={discardBranchDraft}
              onCreateBranchPrompt={(prompt) =>
                void createChildBranch(prompt)
              }
              onSaveBranchNote={(prompt) =>
                void saveChildBranchNote(prompt)
              }
              onChooseBranchDraftFiles={(files) =>
                void chooseFiles(BRANCH_DRAFT_ATTACHMENT_KEY, files)
              }
              onRemoveBranchDraftAttachment={(attachmentId) =>
                removeAttachment(
                  BRANCH_DRAFT_ATTACHMENT_KEY,
                  attachmentId,
                )
              }
              onChangeDraft={(branchId, value) => {
                setDraftsByBranch((current) => ({
                  ...current,
                  [branchId]: value,
                }));
                queueDraftSave(
                  screen.conversationId,
                  branchId,
                  value,
                );
              }}
              onSend={(branchId) => void sendOnBranch(branchId)}
              onStop={(branchId, mode) => void stopBranch(branchId, mode)}
              onChooseFiles={(branchId, files) =>
                void chooseFiles(branchId, files)
              }
              onRemoveAttachment={removeAttachment}
              onTranscribe={transcribe}
              onSettingsChange={updateComposerSettings}
              onDownloadImage={(messageId, imageId) =>
                void downloadImage(messageId, imageId)
              }
              onRetryImage={retryImage}
              onOpenExternal={openExternal}
              resolveImageUrl={resolveImageUrl}
            />
          </section>
        </main>
      )}

      <AccountPanel
        account={account}
        open={accountOpen}
        busy={Boolean(busyAction?.includes("login") || busyAction === "logout")}
        onClose={() => setAccountOpen(false)}
        onStartLogin={() => void startLogin()}
        onCancelLogin={() => void cancelLogin()}
        onLogout={() => void logout()}
        onOpenExternal={openExternal}
      />

      {renameTarget ? (
        <RenameDialog
          title={`Rename ${renameTarget.kind}`}
          label="Name"
          initialValue={renameTarget.title}
          busy={busyAction === "rename"}
          onCancel={() => setRenameTarget(null)}
          onSave={(value) => void rename(value)}
        />
      ) : null}
      {deleteTarget ? (
        <ConfirmDialog
          title={`Delete ${deleteTarget.kind}?`}
          description={`“${deleteTarget.title}” ${
            deleteTarget.kind === "branch"
              ? "and all of its descendants"
              : "and every branch in it"
          } will be removed from this Mac.`}
          confirmLabel={`Delete ${deleteTarget.kind}`}
          busy={busyAction === "delete"}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void removeTarget()}
        />
      ) : null}
      <ToastRegion
        toasts={toasts}
        onDismiss={(id) =>
          setToasts((current) => current.filter((toast) => toast.id !== id))
        }
      />
    </div>
  );
}
