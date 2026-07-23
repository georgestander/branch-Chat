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
  type ConversationCanvasPatch,
  type ConversationGraphSnapshot,
  type Message,
} from "@branchy/conversation-core";
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
import { BranchCanvas } from "./BranchCanvas.tsx";
import { Icon } from "./icons.tsx";
import {
  BranchDraftDialog,
  ConfirmDialog,
  RenameDialog,
  ToastRegion,
  type ToastMessage,
} from "./Overlays.tsx";
import { Sidebar } from "./Sidebar.tsx";
import {
  initialStreamState,
  isStreamActive,
  mergeRenderedMessage,
  reduceStreamState,
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
        login: previous?.login ?? null,
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem("branchy:sidebar-collapsed") === "true";
    } catch {
      return false;
    }
  });
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
  const [renameTarget, setRenameTarget] = useState<RenameTarget>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [branchDraft, setBranchDraft] =
    useState<BranchSelectionDraft | null>(null);
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
  const loginIdRef = useRef<string | null>(null);
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

  const loadBootstrap = useCallback(
    async (input?: { conversationId?: string; branchId?: string }) => {
      for (const unsubscribe of subscriptionsRef.current.values()) {
        unsubscribe();
      }
      subscriptionsRef.current.clear();
      streamBranchesRef.current.clear();
      const bootstrap = await window.branchy.bootstrap(input);
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
      setDraftsByBranch({});
      setAttachmentsByBranch({});
      setRetryByBranch({});
      return bootstrap;
    },
    [],
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
          setScreen(screenFromBootstrap(bootstrap));
          setStreamsToResume(
            bootstrap.kind === "ready" ? bootstrap.activeStreams : [],
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
    try {
      window.localStorage.setItem(
        "branchy:sidebar-collapsed",
        String(sidebarCollapsed),
      );
    } catch {
      // Local preference persistence is best effort.
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) {
        if (event.key === "Escape") {
          setHeaderMenuOpen(false);
          setAccountOpen(false);
        }
        return;
      }
      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        void createConversation();
      } else if (event.key.toLowerCase() === "b") {
        event.preventDefault();
        setSidebarCollapsed((current) => !current);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  });

  useEffect(() => {
    if (
      (screen.kind !== "ready" && screen.kind !== "empty") ||
      screen.account.status !== "signing_in" ||
      !loginIdRef.current
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
            loginIdRef.current = null;
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
                  snapshot: result.snapshot,
                  activeBranchId: branchId,
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
    ) => {
      streamBranchesRef.current.set(streamId, branchId);
      setStreamsByBranch((current) => ({
        ...current,
        [branchId]: initialStreamState(streamId, branchId),
      }));
      const unsubscribe = window.branchy.subscribeStream(streamId, (event) => {
        const currentBranchId =
          streamBranchesRef.current.get(streamId) ?? branchId;
        setStreamsByBranch((current) => {
          const existing =
            current[currentBranchId] ??
            initialStreamState(streamId, currentBranchId);
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
            setStreamsByBranch((current) => {
              const next = { ...current };
              delete next[canonical.branchId];
              return next;
            });
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
              setStreamsByBranch((current) => {
                const next = { ...current };
                delete next[currentBranchId];
                return next;
              });
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
      setAttachmentsByBranch((current) => ({ ...current, [branchId]: [] }));
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
      ready,
      reconcileSend,
      retryByBranch,
      streamsByBranch,
      subscribeToStream,
    ],
  );

  const stopBranch = useCallback(
    async (branchId: BranchId) => {
      if (!ready) return;
      const stream = streamsByBranch[branchId];
      if (!stream) return;
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
      } catch (error) {
        notify(errorMessage(error, "Could not stop this response."), "error");
      }
    },
    [notify, ready, streamsByBranch],
  );

  const createChildBranch = useCallback(
    async (prompt: string) => {
      if (!ready || !branchDraft) return;
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
      loadBootstrap,
      notify,
      ready,
      reconcileSend,
      subscribeToStream,
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
        setAttachmentsByBranch((current) => ({
          ...current,
          [branchId]: [...(current[branchId] ?? []), draft],
        }));
        if (file.size > constraints.maxSizeBytes) {
          setAttachmentsByBranch((current) => ({
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
        void file
          .arrayBuffer()
          .then((bytes) =>
            window.branchy.createAttachment({
              conversationId: ready.conversationId,
              fileName: file.name,
              contentType: file.type || "application/octet-stream",
              bytes,
            }),
          )
          .then((attachment) => {
            setAttachmentsByBranch((current) => ({
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
            setAttachmentsByBranch((current) => ({
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
    [attachmentsByBranch, notify, ready],
  );

  const removeAttachment = useCallback(
    (branchId: BranchId, attachmentId: string) => {
      if (!ready) return;
      setAttachmentsByBranch((current) => ({
        ...current,
        [branchId]: (current[branchId] ?? []).filter(
          (attachment) => attachment.id !== attachmentId,
        ),
      }));
      if (!attachmentId.startsWith("upload-")) {
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
    [notify, ready],
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
    [openBranch, ready],
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
        setScreen((current) => {
          if (current.kind !== "ready") return current;
          const nextMessages = { ...current.messagesByBranch };
          delete nextMessages[deleteTarget.id];
          return {
            ...current,
            snapshot: result.snapshot,
            activeBranchId: result.parentBranchId,
            messagesByBranch: nextMessages,
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
  }, [deleteTarget, loadBootstrap, notify, ready]);

  const startLogin = useCallback(async () => {
    setBusyAction("login");
    try {
      const challenge = await window.branchy.startChatGptLogin();
      loginIdRef.current = challenge.loginId;
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
    const loginId = loginIdRef.current;
    if (!loginId) return;
    setBusyAction("cancel-login");
    try {
      await window.branchy.cancelChatGptLogin({ loginId });
      loginIdRef.current = null;
      setScreen((current) =>
        current.kind === "ready" || current.kind === "empty"
          ? { ...current, account: { ...FALLBACK_ACCOUNT } }
          : current,
      );
    } finally {
      setBusyAction(null);
    }
  }, []);

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
      return fallback ?? (cached?.startsWith("__") ? null : cached) ?? null;
    },
    [imageUrls],
  );

  const sidebar = (
    <Sidebar
      conversations={conversations}
      activeConversationId={ready?.conversationId ?? null}
      account={account}
      collapsed={sidebarCollapsed}
      theme={theme}
      busy={busyAction === "create-conversation"}
      onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
      onNewConversation={() => void createConversation()}
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
      {sidebar}

      {screen.kind === "loading" ? (
        <main className="screen-state" aria-busy="true">
          <span className="brand__mark brand__mark--large">
            <Icon name="branch" size={23} />
          </span>
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
        <main className="empty-workspace">
          <section className="empty-workspace__content">
            <span className="empty-workspace__mark">
              <Icon name="branch" size={28} />
            </span>
            <span className="eyebrow">Your conversation canvas</span>
            <h1>Start somewhere.<br />Branch anywhere.</h1>
            <p>
              Each reply can become a new path without losing the conversation
              that led there.
            </p>
            <button
              className="primary-button primary-button--large"
              type="button"
              disabled={busyAction === "create-conversation"}
              onClick={() => void createConversation()}
            >
              {busyAction === "create-conversation" ? (
                <span className="spinner" />
              ) : (
                <Icon name="plus" size={17} />
              )}
              New conversation
            </button>
            {account.status !== "signed_in" ? (
              <button
                className="text-button empty-workspace__account"
                type="button"
                onClick={() => setAccountOpen(true)}
              >
                <Icon name="user" size={15} />
                Connect ChatGPT first
              </button>
            ) : null}
          </section>
          <div className="empty-workspace__map" aria-hidden="true">
            <span className="ghost-node ghost-node--root" />
            <span className="ghost-edge ghost-edge--one" />
            <span className="ghost-node ghost-node--one" />
            <span className="ghost-edge ghost-edge--two" />
            <span className="ghost-node ghost-node--two" />
            <span className="ghost-edge ghost-edge--three" />
            <span className="ghost-node ghost-node--three" />
          </div>
        </main>
      ) : (
        <main className="workspace">
          <header className="workspace__header">
            <div className="workspace__title">
              <span className="workspace__title-mark">
                <Icon name="branch" size={15} />
              </span>
              <div>
                <h1>{screen.title}</h1>
                <p>
                  {Object.keys(screen.snapshot.branches).length}{" "}
                  {Object.keys(screen.snapshot.branches).length === 1
                    ? "branch"
                    : "branches"}
                </p>
              </div>
            </div>
            <div className="workspace__actions">
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
              onCreateBranch={setBranchDraft}
              onChangeDraft={(branchId, value) => {
                setDraftsByBranch((current) => ({
                  ...current,
                  [branchId]: value,
                }));
              }}
              onSend={(branchId) => void sendOnBranch(branchId)}
              onStop={(branchId) => void stopBranch(branchId)}
              onChooseFiles={(branchId, files) =>
                void chooseFiles(branchId, files)
              }
              onRemoveAttachment={removeAttachment}
              onTranscribe={transcribe}
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
      {branchDraft ? (
        <BranchDraftDialog
          excerpt={branchDraft.excerpt}
          busy={busyAction === "create-branch"}
          onCancel={() => setBranchDraft(null)}
          onCreate={(prompt) => void createChildBranch(prompt)}
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
