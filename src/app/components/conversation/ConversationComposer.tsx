"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  ChevronDown,
  Check,
  Globe,
  GraduationCap,
  Loader2,
  Paperclip,
  Plus,
  RotateCcw,
  SendHorizontal,
  Maximize,
  SlidersHorizontal,
  Upload,
  X,
  Zap,
} from "lucide-react";

import {
  createAttachmentUploadAction,
  deleteComposerByokKey,
  finalizeAttachmentUploadAction,
  getComposerAccountState,
  getConversationSummary,
  removeAttachmentUploadAction,
  saveBranchNote,
  saveComposerByokKey,
  sendMessage,
  type ComposerByokProvider,
  type SaveBranchNoteResponse,
  type SendMessageResponse,
} from "@/app/pages/conversation/functions";
import {
  formatBytes,
  isAttachmentMimeTypeAllowed,
  UPLOAD_MAX_ATTACHMENTS,
  UPLOAD_MAX_SIZE_BYTES,
} from "@/app/shared/uploads.config";
import { cn } from "@/lib/utils";
import { emitDirectoryUpdate } from "@/app/components/conversation/directoryEvents";
import {
  emitOptimisticUserMessage,
  emitOptimisticMessageClear,
  emitPersistedMessages,
} from "@/app/components/conversation/messageEvents";
import { emitStartStreaming } from "@/app/components/conversation/streamingEvents";
import {
  BYOK_STATUS_CHANGED_EVENT,
  emitByokStatusChanged,
  type ByokStatusChangedDetail,
} from "@/app/components/conversation/byokEvents";
import {
  DEFAULT_CONVERSATION_MODEL,
  type ComposerPreset,
  type ReasoningEffort,
} from "@/lib/conversation";
import type { ConversationComposerTool } from "@/lib/conversation/tools";
import {
  CHATGPT_MODEL_OPTIONS,
  getChatGPTModelOption,
  isWebSearchSelectableModel,
  REASONING_EFFORT_LABELS,
  resolveReasoningEffortForModel,
  supportsReasoningEffortModel,
} from "@/lib/openai/models";
import { useToast } from "@/app/components/ui/Toast";
import {
  OPENROUTER_DEFAULT_CHAT_MODEL_CANDIDATES,
  OPENROUTER_DEFAULT_REASONING_MODEL_CANDIDATES,
  OPENROUTER_WEB_SEARCH_SUFFIX,
  isOpenRouterModel,
  stripOpenRouterPrefix,
  type OpenRouterModelOption,
} from "@/lib/openrouter/models";

type ToolOption = {
  id: ConversationComposerTool;
  label: string;
  description?: string;
  icon: LucideIcon;
};

type ComposerAttachmentStatus = "pending" | "uploading" | "ready" | "error";

type ComposerAttachment = {
  tempId: string;
  id: string | null;
  name: string;
  size: number;
  contentType: string;
  status: ComposerAttachmentStatus;
  error: string | null;
  file: File | null;
};

type SessionByokCredential = {
  provider: ComposerByokProvider;
  apiKey: string;
};

const TOOL_OPTIONS: ToolOption[] = [
  {
    id: "study-and-learn",
    label: "Study & Learn",
    description: "Guided tutoring agent",
    icon: GraduationCap,
  },
  {
    id: "web-search",
    label: "Web Search",
    description: "Pull in live sources",
    icon: Globe,
  },
  {
    id: "file-upload",
    label: "File Upload",
    description: "Attach reference files",
    icon: Upload,
  },
];

const ALLOWED_COMPOSER_TOOLS = new Set<ConversationComposerTool>([
  "study-and-learn",
  "web-search",
  "file-upload",
]);
const START_MODE_DEFAULTS: Record<
  Exclude<ComposerPreset, "custom">,
  {
    model: string;
    reasoningEffort: ReasoningEffort | null;
    tools: ConversationComposerTool[];
  }
> = {
  fast: {
    model: DEFAULT_CONVERSATION_MODEL,
    reasoningEffort: "medium",
    tools: ["web-search"],
  },
  reasoning: {
    model: "gpt-5.6-sol",
    reasoningEffort: "high",
    tools: ["web-search"],
  },
  study: {
    model: "gpt-5.6-sol",
    reasoningEffort: "medium",
    tools: ["study-and-learn", "web-search"],
  },
};
type ComposerAccountStateResponse = Awaited<
  ReturnType<typeof getComposerAccountState>
>;

let inMemorySessionByokCredential: SessionByokCredential | null = null;

function readInMemorySessionByokCredential(): SessionByokCredential | null {
  return inMemorySessionByokCredential;
}

function writeInMemorySessionByokCredential(
  credential: SessionByokCredential,
): void {
  inMemorySessionByokCredential = credential;
}

function clearInMemorySessionByokCredential(): void {
  inMemorySessionByokCredential = null;
}

function getProviderForModel(model: string): ComposerByokProvider {
  return isOpenRouterModel(model) ? "openrouter" : "openai";
}

function extractErrorMessage(cause: unknown): string {
  if (cause instanceof Error && typeof cause.message === "string") {
    return cause.message;
  }
  if (typeof cause === "string") {
    return cause;
  }
  return "Unknown error";
}

function sanitizeStoredComposerTools(value: unknown): ConversationComposerTool[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const tools: ConversationComposerTool[] = [];
  for (const item of value) {
    if (
      typeof item === "string" &&
      ALLOWED_COMPOSER_TOOLS.has(item as ConversationComposerTool) &&
      !tools.includes(item as ConversationComposerTool)
    ) {
      tools.push(item as ConversationComposerTool);
    }
  }
  return tools;
}

function isSameToolSelection(
  left: ConversationComposerTool[],
  right: ConversationComposerTool[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function normalizeOpenRouterRawModelId(rawModelId: string): string {
  const normalized = rawModelId.trim().toLowerCase();
  if (normalized.endsWith(OPENROUTER_WEB_SEARCH_SUFFIX)) {
    return normalized.slice(0, -OPENROUTER_WEB_SEARCH_SUFFIX.length);
  }
  return normalized;
}

function isReasoningCapableOpenRouterRawModel(rawModelId: string): boolean {
  const normalizedRaw = normalizeOpenRouterRawModelId(rawModelId);
  const modelId = normalizedRaw.includes("/")
    ? (normalizedRaw.split("/").at(-1) ?? normalizedRaw)
    : normalizedRaw;

  if (modelId.includes("chat")) {
    return false;
  }

  return modelId === "gpt-5" || modelId.startsWith("gpt-5-");
}

function resolveOpenRouterPresetModelId(
  models: OpenRouterModelOption[],
  fallbackModel: string,
  preset: "fast" | "reasoning",
): string | null {
  const modelsByRawId = new Map(
    models.map((model) => [model.rawId.trim().toLowerCase(), model] as const),
  );
  const candidates =
    preset === "reasoning"
      ? OPENROUTER_DEFAULT_REASONING_MODEL_CANDIDATES
      : OPENROUTER_DEFAULT_CHAT_MODEL_CANDIDATES;

  if (preset === "reasoning" && isOpenRouterModel(fallbackModel)) {
    const fallbackRaw = stripOpenRouterPrefix(fallbackModel);
    if (isReasoningCapableOpenRouterRawModel(fallbackRaw)) {
      return fallbackModel;
    }
  }

  for (const rawId of candidates) {
    const match = modelsByRawId.get(rawId);
    if (match) {
      return match.id;
    }
  }

  if (preset === "reasoning") {
    const reasoningMatch = models.find((model) =>
      isReasoningCapableOpenRouterRawModel(model.rawId),
    );
    if (reasoningMatch) {
      return reasoningMatch.id;
    }
    return null;
  }

  if (isOpenRouterModel(fallbackModel)) {
    return fallbackModel;
  }
  const autoModel = models.find((model) => model.rawId === "openrouter/auto");
  if (autoModel) {
    return autoModel.id;
  }
  return models[0]?.id ?? null;
}

function inferComposerPreset(options: {
  model: string;
  reasoningEffort: ReasoningEffort | null;
  tools: ConversationComposerTool[];
}): ComposerPreset {
  const normalizedTools = sanitizeStoredComposerTools(options.tools);
  const normalizedEffort = supportsReasoningEffortModel(options.model)
    ? (options.reasoningEffort ?? "low")
    : null;

  const fastDefaults = START_MODE_DEFAULTS.fast;
  if (
    options.model === fastDefaults.model &&
    normalizedEffort === fastDefaults.reasoningEffort &&
    isSameToolSelection(normalizedTools, fastDefaults.tools)
  ) {
    return "fast";
  }

  const reasoningDefaults = START_MODE_DEFAULTS.reasoning;
  if (
    options.model === reasoningDefaults.model &&
    normalizedEffort === reasoningDefaults.reasoningEffort &&
    isSameToolSelection(normalizedTools, reasoningDefaults.tools)
  ) {
    return "reasoning";
  }

  const studyDefaults = START_MODE_DEFAULTS.study;
  if (
    options.model === studyDefaults.model &&
    normalizedEffort === studyDefaults.reasoningEffort &&
    isSameToolSelection(normalizedTools, studyDefaults.tools)
  ) {
    return "study";
  }

  return "custom";
}

interface ConversationComposerProps {
  branchId: string;
  conversationId: string;
  autoFocus?: boolean;
  className?: string;
  conversationModel: string;
  reasoningEffort: ReasoningEffort | null;
  composerPreset: ComposerPreset;
  composerTools: ConversationComposerTool[];
  openRouterModels: OpenRouterModelOption[];
  onConversationSettingsChange: (
    model: string,
    effort: ReasoningEffort | null,
    options?: {
      preset?: ComposerPreset;
      tools?: ConversationComposerTool[];
    },
  ) => Promise<boolean>;
  conversationSettingsSaving: boolean;
  conversationSettingsError: string | null;
  onClearConversationSettingsError: () => void;
  branchContextExcerpt?: string | null;
  bootstrapMessage?: string | null;
  onBootstrapConsumed?: () => void;
  onStreamStart?: (streamId: string) => void;
  branchDraft?: {
    parentBranchId: string;
    messageId: string;
    span?: { start: number; end: number } | null;
    excerpt?: string | null;
  } | null;
  onDraftCreated?: (
    response: SendMessageResponse | SaveBranchNoteResponse,
  ) => Promise<void> | void;
  variant?: "default" | "branch-draft";
  onPendingChange?: (pending: boolean) => void;
}

export function ConversationComposer({
  branchId,
  conversationId,
  autoFocus = false,
  className,
  conversationModel,
  reasoningEffort,
  composerPreset,
  composerTools,
  openRouterModels,
  onConversationSettingsChange,
  conversationSettingsSaving,
  conversationSettingsError,
  onClearConversationSettingsError,
  branchContextExcerpt,
  bootstrapMessage,
  onBootstrapConsumed,
  onStreamStart,
  branchDraft = null,
  onDraftCreated,
  variant = "default",
  onPendingChange,
}: ConversationComposerProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [selectedTools, setSelectedTools] = useState<ConversationComposerTool[]>(
    sanitizeStoredComposerTools(composerTools),
  );
  const [isToolMenuOpen, setIsToolMenuOpen] = useState(false);
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [isComposerModalOpen, setIsComposerModalOpen] = useState(false);
  const [isBrowser, setIsBrowser] = useState(false);
  const [accountState, setAccountState] =
    useState<ComposerAccountStateResponse | null>(null);
  const [isAccountStateLoading, setIsAccountStateLoading] = useState(true);
  const [isByokPanelOpen, setIsByokPanelOpen] = useState(false);
  const [isAdvancedControlsOpen, setIsAdvancedControlsOpen] = useState(false);
  const [byokProvider, setByokProvider] = useState<ComposerByokProvider>(
    getProviderForModel(conversationModel),
  );
  const [byokApiKey, setByokApiKey] = useState("");
  const [isByokSaving, setIsByokSaving] = useState(false);
  const [sessionByokCredential, setSessionByokCredential] =
    useState<SessionByokCredential | null>(() =>
      readInMemorySessionByokCredential(),
    );
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingRefreshTimers = useRef<number[]>([]);
  const accountStateRequestIdRef = useRef(0);
  const lastConnectedByokProviderRef = useRef<ComposerByokProvider | null>(null);
  const toolMenuRef = useRef<HTMLDivElement | null>(null);
  const toolMenuId = useId();
  const modelMenuId = useId();
  const byokProviderId = useId();
  const byokApiKeyId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const attachmentsRef = useRef<ComposerAttachment[]>([]);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const modelButtonRef = useRef<HTMLButtonElement | null>(null);
  const autoSendRef = useRef(false);
  const autoSendPendingRef = useRef<string | null>(null);
  const webSearchSelectable = isWebSearchSelectableModel(conversationModel);
  const { notify } = useToast();
  const isBranchDraft = variant === "branch-draft" && branchDraft !== null;
  useEffect(() => {
    onPendingChange?.(isPending);
  }, [isPending, onPendingChange]);
  const selectedChatGPTModel = getChatGPTModelOption(conversationModel);
  const reasoningOptions: readonly ReasoningEffort[] =
    selectedChatGPTModel?.supportedReasoningEfforts ?? ["low", "medium", "high"];
  const modelEmojis = {
    fast: "🚀",
    low: "🧠",
    medium: "🧠🧠",
    high: "🧠🧠🧠",
    xhigh: "🧠⁴",
    max: "🔥",
    ultra: "⚡",
  } as const;

  useEffect(() => {
    if (!isAdvancedControlsOpen) {
      setIsModelMenuOpen(false);
    }
  }, [isAdvancedControlsOpen]);
  const presetLabels: Record<ComposerPreset, string> = {
    fast: "Fast",
    reasoning: "Reasoning",
    study: "Study",
    custom: "Custom",
  };
  const currentPresetLabel = presetLabels[composerPreset];
  const isFastPreset = composerPreset === "fast";
  const currentReasoningEffort = reasoningEffort ?? "low";
  const selectedOpenRouterModel = openRouterModels.find(
    (model) => model.id === conversationModel,
  );
  const openRouterSelected = isOpenRouterModel(conversationModel);
  const isReasoningModel = supportsReasoningEffortModel(conversationModel);
  const reasoningLabel = isReasoningModel
    ? `Reasoning ${REASONING_EFFORT_LABELS[currentReasoningEffort]}`
    : null;
  const currentModelLabel = selectedOpenRouterModel
    ? reasoningLabel
      ? `${selectedOpenRouterModel.name} · ${reasoningLabel}`
      : selectedOpenRouterModel.name
    : openRouterSelected
      ? reasoningLabel
        ? `${stripOpenRouterPrefix(conversationModel)} · ${reasoningLabel}`
        : stripOpenRouterPrefix(conversationModel)
      : `${selectedChatGPTModel?.label ?? conversationModel} · ${REASONING_EFFORT_LABELS[currentReasoningEffort]}`;
  const modelBadgeClassName =
    "inline-flex w-10 shrink-0 items-center justify-end text-[10px] leading-none text-current";
  const BASE_TEXTAREA_HEIGHT = 20;
  const branchContextLabel = useMemo(() => {
    if (!branchContextExcerpt) {
      return null;
    }
    const normalized = branchContextExcerpt.replace(/\s+/g, " ").trim();
    if (!normalized) {
      return null;
    }
    if (normalized.length <= 110) {
      return normalized;
    }
    return `${normalized.slice(0, 110).trimEnd()}…`;
  }, [branchContextExcerpt]);

  useEffect(() => {
    if (!autoFocus) {
      return;
    }

    const node = textareaRef.current;
    if (!node) {
      return;
    }

    node.focus({ preventScroll: true });
    const length = node.value.length;
    node.setSelectionRange(length, length);
  }, [autoFocus, branchId]);

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined") {
        pendingRefreshTimers.current.forEach((timer) => {
          window.clearTimeout(timer);
        });
      }
      pendingRefreshTimers.current = [];
    };
  }, []);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => {
    const defaults = sanitizeStoredComposerTools(composerTools).filter((tool) =>
      webSearchSelectable ? true : tool !== "web-search",
    );
    setSelectedTools((previous) =>
      isSameToolSelection(previous, defaults) ? previous : defaults,
    );
  }, [composerTools, webSearchSelectable]);

  useEffect(() => {
    if (!bootstrapMessage) {
      return;
    }
    if (autoSendRef.current) {
      return;
    }
    if (value.trim().length > 0) {
      return;
    }
    autoSendRef.current = true;
    autoSendPendingRef.current = bootstrapMessage;
    setValue(bootstrapMessage);
  }, [bootstrapMessage, value]);

  const loadComposerAccountState = useCallback(
    async (options?: { showLoading?: boolean }) => {
      const showLoading = options?.showLoading ?? true;
      const requestId = accountStateRequestIdRef.current + 1;
      accountStateRequestIdRef.current = requestId;
      if (showLoading) {
        setIsAccountStateLoading(true);
      }
      try {
        const nextState = await getComposerAccountState();
        if (accountStateRequestIdRef.current !== requestId) {
          return null;
        }
        setAccountState(nextState);
        return nextState;
      } catch (loadError) {
        console.error("[Composer] account state load failed", loadError);
        if (accountStateRequestIdRef.current !== requestId) {
          return null;
        }
        setError((previous) => previous ?? "We couldn't load account settings.");
        return null;
      } finally {
        if (showLoading && accountStateRequestIdRef.current === requestId) {
          setIsAccountStateLoading(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    void loadComposerAccountState({ showLoading: true });
  }, [conversationId, loadComposerAccountState]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handleByokStatusChanged = (event: Event) => {
      const customEvent = event as CustomEvent<ByokStatusChangedDetail>;
      if (customEvent.detail?.source === "composer") {
        return;
      }
      void loadComposerAccountState({ showLoading: false });
    };
    window.addEventListener(
      BYOK_STATUS_CHANGED_EVENT,
      handleByokStatusChanged as EventListener,
    );
    return () => {
      window.removeEventListener(
        BYOK_STATUS_CHANGED_EVENT,
        handleByokStatusChanged as EventListener,
      );
    };
  }, [loadComposerAccountState]);

  useEffect(() => {
    if (accountState?.byok.provider) {
      setByokProvider(accountState.byok.provider);
      return;
    }
    setByokProvider(getProviderForModel(conversationModel));
  }, [accountState?.byok.provider, conversationModel]);

  const handleSaveByokKey = useCallback(async () => {
    if (isByokSaving) {
      return;
    }
    if (isAccountStateLoading && !accountState) {
      setError("Account status is still loading. Try again in a moment.");
      return;
    }
    const nextByokEnabled = accountState?.byok.enabled ?? false;
    const nextByokUnavailableReason = accountState?.byok.unavailableReason ?? null;
    const normalizedKey = byokApiKey.trim();
    if (!normalizedKey) {
      setError("Enter an API key before connecting BYOK.");
      setIsByokPanelOpen(true);
      return;
    }

    if (!nextByokEnabled) {
      const nextCredential: SessionByokCredential = {
        provider: byokProvider,
        apiKey: normalizedKey,
      };
      writeInMemorySessionByokCredential(nextCredential);
      setSessionByokCredential(nextCredential);
      setByokApiKey("");
      setError(null);
      notify({
        title: "Session BYOK connected",
        description:
          nextByokUnavailableReason ||
          "This key stays in this tab only and clears on reload.",
      });
      return;
    }

    setIsByokSaving(true);
    setError(null);
    try {
      const status = await saveComposerByokKey({
        provider: byokProvider,
        apiKey: normalizedKey,
      });
      setAccountState((previous) =>
        previous
          ? {
              ...previous,
              byok: status,
            }
          : previous,
      );
      setByokApiKey("");
      emitByokStatusChanged({
        source: "composer",
        provider: status.provider,
        connected: status.connected,
        updatedAt: status.updatedAt,
      });
      await loadComposerAccountState({ showLoading: false });
    } catch (saveError) {
      console.error("[Composer] save BYOK key failed", saveError);
      const message = extractErrorMessage(saveError);
      setError(message || "We couldn't connect your BYOK key. Verify the key and try again.");
      setIsByokPanelOpen(true);
    } finally {
      setIsByokSaving(false);
    }
  }, [
    accountState,
    byokApiKey,
    byokProvider,
    isAccountStateLoading,
    isByokSaving,
    loadComposerAccountState,
    notify,
  ]);

  const handleDeleteByokKey = useCallback(async () => {
    if (isByokSaving) {
      return;
    }
    const nextByokEnabled = accountState?.byok.enabled ?? false;
    if (!nextByokEnabled) {
      clearInMemorySessionByokCredential();
      setSessionByokCredential(null);
      setByokApiKey("");
      setError(null);
      notify({
        title: "Session BYOK removed",
        description: "Add a new key to continue sending in this tab.",
      });
      return;
    }
    setIsByokSaving(true);
    setError(null);
    try {
      await deleteComposerByokKey();
      setAccountState((previous) =>
        previous
          ? {
              ...previous,
              byok: {
                provider: null,
                connected: false,
                updatedAt: null,
                enabled: previous.byok.enabled,
                unavailableReason: previous.byok.unavailableReason,
              },
            }
          : previous,
      );
      setByokApiKey("");
      emitByokStatusChanged({
        source: "composer",
        provider: null,
        connected: false,
        updatedAt: null,
      });
      await loadComposerAccountState({ showLoading: false });
    } catch (deleteError) {
      console.error("[Composer] delete BYOK key failed", deleteError);
      setError("We couldn't disconnect your BYOK key. Please try again.");
    } finally {
      setIsByokSaving(false);
    }
  }, [accountState?.byok.enabled, isByokSaving, loadComposerAccountState, notify]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setIsBrowser(true);
    }
  }, []);

  useEffect(() => {
    if (!isToolMenuOpen) {
      return;
    }
    if (typeof document === "undefined") {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const container = toolMenuRef.current;
      if (!container) {
        return;
      }
      if (!container.contains(event.target as Node)) {
        setIsToolMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isToolMenuOpen]);

  useEffect(() => {
    if (!isToolMenuOpen) {
      return;
    }
    if (typeof document === "undefined") {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsToolMenuOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isToolMenuOpen]);

  useEffect(() => {
    if (!isModelMenuOpen) {
      return;
    }
    if (typeof document === "undefined") {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const menuNode = modelMenuRef.current;
      const buttonNode = modelButtonRef.current;
      if (
        menuNode?.contains(event.target as Node) ||
        buttonNode?.contains(event.target as Node)
      ) {
        return;
      }
      setIsModelMenuOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isModelMenuOpen]);

  useEffect(() => {
    if (!isModelMenuOpen) {
      return;
    }
    if (typeof document === "undefined") {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsModelMenuOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isModelMenuOpen]);

  useEffect(() => {
    if (isModelMenuOpen) {
      onClearConversationSettingsError();
    }
  }, [isModelMenuOpen, onClearConversationSettingsError]);

  useEffect(() => {
    setSelectedTools((previous) => {
      const hasFileUpload = previous.includes("file-upload");
      if (attachments.length > 0 && !hasFileUpload) {
        return [...previous, "file-upload"];
      }
      return previous;
    });
  }, [attachments.length]);

  const openFilePicker = useCallback(() => {
    const input = fileInputRef.current;
    if (!input) {
      return;
    }
    input.value = "";
    input.click();
  }, []);

  const processAttachment = useCallback(
    async (tempId: string, file: File) => {
      let stagedAttachmentId: string | null = null;
      try {
        setAttachments((previous) =>
          previous.map((attachment) =>
            attachment.tempId === tempId
              ? {
                  ...attachment,
                  status: "uploading",
                  error: null,
                  file,
                }
              : attachment,
          ),
        );

        const creation = await createAttachmentUploadAction({
          conversationId,
          fileName: file.name,
          size: file.size,
          contentType: file.type || "application/octet-stream",
        });

        stagedAttachmentId = creation.attachment.id;

        setAttachments((previous) =>
          previous.map((attachment) =>
            attachment.tempId === tempId
              ? {
                  ...attachment,
                  id: creation.attachment.id,
                  name: creation.attachment.name,
                  size: creation.attachment.size ?? file.size,
                  contentType: creation.attachment.contentType,
                  status: "uploading",
                  error: null,
                  file,
                }
              : attachment,
          ),
        );

        if (!attachmentsRef.current.some((attachment) => attachment.tempId === tempId)) {
          await removeAttachmentUploadAction({
            conversationId,
            attachmentId: creation.attachment.id,
          }).catch(() => {});
          return;
        }

        const response = await fetch(creation.uploadUrl, {
          method: "PUT",
          headers: creation.uploadHeaders,
          body: file,
        });

        if (!response.ok) {
          throw new Error(`Upload failed with status ${response.status}`);
        }

        if (!attachmentsRef.current.some((attachment) => attachment.tempId === tempId)) {
          await removeAttachmentUploadAction({
            conversationId,
            attachmentId: creation.attachment.id,
          }).catch(() => {});
          return;
        }

        const finalized = await finalizeAttachmentUploadAction({
          conversationId,
          attachmentId: creation.attachment.id,
        });

        setAttachments((previous) =>
          previous.map((attachment) =>
            attachment.tempId === tempId
              ? {
                  ...attachment,
                  id: finalized.id,
                  name: finalized.name,
                  size: finalized.size,
                  contentType: finalized.contentType,
                  status: "ready",
                  error: null,
                  file: null,
                }
              : attachment,
          ),
        );
        console.info("[Composer] attachment upload finalized", {
          conversationId,
          attachmentId: finalized.id,
        });
      } catch (caught) {
        console.error("[Composer] attachment upload failed", caught);
        const message =
          caught instanceof Error
            ? caught.message
            : "Upload failed. Please try again.";
        setAttachments((previous) =>
          previous.map((attachment) =>
            attachment.tempId === tempId
              ? { ...attachment, status: "error", error: message }
              : attachment,
          ),
        );
        if (stagedAttachmentId) {
          await removeAttachmentUploadAction({
            conversationId,
            attachmentId: stagedAttachmentId,
          }).catch(() => {});
        }
        setError(message);
      }
    },
    [conversationId],
  );

  const handleFilesSelected = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList) {
        return;
      }

      const files = Array.from(fileList);
      let availableSlots = UPLOAD_MAX_ATTACHMENTS - attachmentsRef.current.length;

      for (const file of files) {
        if (availableSlots <= 0) {
          setError(`You can upload up to ${UPLOAD_MAX_ATTACHMENTS} files per message.`);
          break;
        }

        if (!isAttachmentMimeTypeAllowed(file.type)) {
          setError(`Unsupported file type: ${file.type || "unknown"}.`);
          continue;
        }

        if (file.size > UPLOAD_MAX_SIZE_BYTES) {
          setError(
            `"${file.name}" exceeds the ${formatBytes(UPLOAD_MAX_SIZE_BYTES)} limit.`,
          );
          continue;
        }

        const tempId = crypto.randomUUID();
        availableSlots -= 1;
        setAttachments((previous) => [
          ...previous,
          {
            tempId,
            id: null,
            name: file.name,
            size: file.size,
            contentType: file.type || "application/octet-stream",
            status: "pending",
            error: null,
            file,
          },
        ]);
        setError(null);
        void processAttachment(tempId, file);
      }
    },
    [processAttachment],
  );

  const handleRemoveAttachment = useCallback(
    async (tempId: string) => {
      const target = attachmentsRef.current.find((attachment) => attachment.tempId === tempId);
      setAttachments((previous) =>
        previous.filter((attachment) => attachment.tempId !== tempId),
      );

      if (target?.id && target.status !== "pending" && target.status !== "uploading") {
        try {
          await removeAttachmentUploadAction({
            conversationId,
            attachmentId: target.id,
          });
        } catch (error) {
          console.error("[Composer] remove attachment failed", error);
        }
      }
    },
    [conversationId],
  );

  const handleRetryAttachment = useCallback(
    (tempId: string) => {
      const target = attachmentsRef.current.find(
        (attachment) => attachment.tempId === tempId,
      );
      if (!target || !target.file) {
        return;
      }

      setAttachments((previous) =>
        previous.map((attachment) =>
          attachment.tempId === tempId
            ? {
                ...attachment,
                status: "pending",
                error: null,
              }
            : attachment,
        ),
      );
      void processAttachment(tempId, target.file);
    },
    [processAttachment],
  );

  const clearAllAttachments = useCallback(async () => {
    const snapshot = attachmentsRef.current;
    if (snapshot.length === 0) {
      setAttachments([]);
      return;
    }

    setAttachments([]);

    await Promise.all(
      snapshot
        .filter(
          (attachment) =>
            attachment.id &&
            attachment.status !== "pending" &&
            attachment.status !== "uploading",
        )
        .map((attachment) =>
          removeAttachmentUploadAction({
            conversationId,
            attachmentId: attachment.id as string,
          }).catch((error) => {
            console.error("[Composer] clear attachment failed", error);
          }),
        ),
    );
  }, [conversationId]);

  useEffect(() => {
    return () => {
      if (attachmentsRef.current.length > 0) {
        void clearAllAttachments();
      }
    };
  }, [clearAllAttachments]);

  const persistComposerDefaults = useCallback(
    (
      nextToolsInput: ConversationComposerTool[],
      options?: {
        model?: string;
        reasoningEffort?: ReasoningEffort | null;
      },
    ) => {
      const nextModel = options?.model ?? conversationModel;
      const nextEffort = options?.reasoningEffort ?? reasoningEffort;
      const normalizedEffort = supportsReasoningEffortModel(nextModel)
        ? (nextEffort ?? "low")
        : null;
      const webSearchSupportedForModel = isWebSearchSelectableModel(nextModel);
      const normalizedTools = sanitizeStoredComposerTools(nextToolsInput).filter((tool) =>
        webSearchSupportedForModel ? true : tool !== "web-search",
      );
      const inferredPreset = inferComposerPreset({
        model: nextModel,
        reasoningEffort: normalizedEffort,
        tools: normalizedTools,
      });

      void onConversationSettingsChange(nextModel, normalizedEffort, {
        preset: inferredPreset,
        tools: normalizedTools,
      });
      return normalizedTools;
    },
    [conversationModel, onConversationSettingsChange, reasoningEffort],
  );

  useEffect(() => {
    if (webSearchSelectable) {
      return;
    }
    if (!selectedTools.includes("web-search")) {
      return;
    }
    const nextTools = selectedTools.filter((tool) => tool !== "web-search");
    setSelectedTools(nextTools);
    persistComposerDefaults(nextTools);
  }, [persistComposerDefaults, selectedTools, webSearchSelectable]);

  const handleToolSelect = useCallback(
    (tool: ToolOption["id"]) => {
      if (tool === "web-search" && !webSearchSelectable) {
        setError("Web search is unavailable for this model.");
        setIsToolMenuOpen(false);
        return;
      }

      if (tool === "file-upload" && attachmentsRef.current.length >= UPLOAD_MAX_ATTACHMENTS) {
        setError(
          `You can upload up to ${UPLOAD_MAX_ATTACHMENTS} files per message.`,
        );
        return;
      }

      const nextTools = (() => {
        if (tool === "file-upload") {
          return selectedTools.includes(tool)
            ? selectedTools
            : [...selectedTools, tool];
        }
        if (selectedTools.includes(tool)) {
          return selectedTools.filter((value) => value !== tool);
        }
        return [...selectedTools, tool];
      })();

      if (!isSameToolSelection(nextTools, selectedTools)) {
        setSelectedTools(nextTools);
        persistComposerDefaults(nextTools);
      }

      if (tool === "file-upload") {
        openFilePicker();
      }

      setIsToolMenuOpen(false);
    },
    [
      openFilePicker,
      persistComposerDefaults,
      selectedTools,
      webSearchSelectable,
    ],
  );

  const handleClearTool = useCallback(() => {
    if (!isSameToolSelection(selectedTools, [])) {
      setSelectedTools([]);
      persistComposerDefaults([]);
    }
    void clearAllAttachments();
  }, [clearAllAttachments, persistComposerDefaults, selectedTools]);

  const handleRemoveTool = useCallback(
    (tool: ConversationComposerTool) => {
      const nextTools = selectedTools.filter((value) => value !== tool);
      if (!isSameToolSelection(nextTools, selectedTools)) {
        setSelectedTools(nextTools);
        persistComposerDefaults(nextTools);
      }
      if (tool === "file-upload") {
        void clearAllAttachments();
      }
    },
    [clearAllAttachments, persistComposerDefaults, selectedTools],
  );

  const handleModelSelection = useCallback(
    async (
      nextModel: string,
      nextEffort: ReasoningEffort | null,
      presetOverride?: ComposerPreset,
    ) => {
      const normalizedEffort = supportsReasoningEffortModel(nextModel)
        ? (nextEffort ?? "low")
        : null;
      const nextTools = sanitizeStoredComposerTools(selectedTools).filter((tool) =>
        isWebSearchSelectableModel(nextModel) ? true : tool !== "web-search",
      );
      const inferredPreset =
        presetOverride ??
        inferComposerPreset({
          model: nextModel,
          reasoningEffort: normalizedEffort,
          tools: nextTools,
        });
      const success = await onConversationSettingsChange(nextModel, normalizedEffort, {
        preset: inferredPreset,
        tools: nextTools,
      });
      if (success) {
        setSelectedTools(nextTools);
        setIsModelMenuOpen(false);
        if (supportsReasoningEffortModel(nextModel)) {
          const effortLabel = REASONING_EFFORT_LABELS[nextEffort ?? "low"];
          notify({
            variant: "warning",
            title: "Deep reasoning is slower",
            description: `Responses may take longer (${effortLabel} effort). Switch back to Fast chat for lower latency.`,
          });
        }
      }
    },
    [notify, onConversationSettingsChange, selectedTools],
  );

  const activeToolOptions = TOOL_OPTIONS.filter((option) =>
    selectedTools.includes(option.id),
  );
  const fileUploadSelected = selectedTools.includes("file-upload");
  const hasSelectedTools = activeToolOptions.length > 0;
  const hasPendingAttachments = attachments.some(
    (attachment) => attachment.status === "pending" || attachment.status === "uploading",
  );
  const hasErroredAttachments = attachments.some(
    (attachment) => attachment.status === "error",
  );
  const canAddMoreAttachments = attachments.length < UPLOAD_MAX_ATTACHMENTS;
  const byokEnabled = true;
  const byokUnavailableReason = accountState?.chatgpt.planType ?? null;
  const persistedByokConnected = Boolean(accountState?.chatgpt.connected);
  const sessionByokConnected = false;
  const byokConnected = persistedByokConnected;
  const connectedByokProvider: ComposerByokProvider | null = byokConnected
    ? "openai"
    : null;
  const byokProviderLabel = "ChatGPT";
  const isByokProviderModelMismatch = false;
  const byokProviderModelMismatchMessage = "This model is unavailable for the connected ChatGPT account.";
  const byokProviderModelHint = null;
  const byokChipText = byokConnected ? "ChatGPT Connected" : "ChatGPT Sign-in Required";
  const byokChipClassName = byokConnected
    ? "border-border text-foreground"
    : "border-amber-400/70 text-amber-600 dark:text-amber-400";
  const byokIndicatorText = isAccountStateLoading
    ? "Checking ChatGPT account..."
    : byokConnected
      ? `${accountState?.chatgpt.email ?? "ChatGPT account"} ready.`
      : "Start Branch Chat locally and sign in to Codex with ChatGPT.";
  const openRouterFastPresetModelId = useMemo(
    () => resolveOpenRouterPresetModelId(openRouterModels, conversationModel, "fast"),
    [conversationModel, openRouterModels],
  );
  const openRouterReasoningPresetModelId = useMemo(
    () =>
      resolveOpenRouterPresetModelId(
        openRouterModels,
        conversationModel,
        "reasoning",
      ),
    [conversationModel, openRouterModels],
  );
  const shouldRoutePresetsToOpenRouter = false;
  const applyPresetModelSelection = useCallback(
    (
      preset: "fast" | "reasoning",
      effort: ReasoningEffort | null,
    ) => {
      if (shouldRoutePresetsToOpenRouter) {
        const openRouterPresetModelId =
          preset === "fast"
            ? openRouterFastPresetModelId
            : openRouterReasoningPresetModelId;
        if (!openRouterPresetModelId) {
          setError(
            preset === "reasoning"
              ? "No OpenRouter reasoning-capable model is available yet. Choose Fast or pick a specific OpenRouter model."
              : "OpenRouter models are still loading. Please try again in a moment.",
          );
          return;
        }
        const presetLabel: ComposerPreset = preset === "fast" ? "fast" : "reasoning";
        void handleModelSelection(
          openRouterPresetModelId,
          preset === "fast" ? START_MODE_DEFAULTS.fast.reasoningEffort : effort,
          presetLabel,
        );
        return;
      }
      const baseModel = START_MODE_DEFAULTS[preset].model;
      void handleModelSelection(
        baseModel,
        preset === "fast" ? START_MODE_DEFAULTS.fast.reasoningEffort : effort,
      );
    },
    [
      handleModelSelection,
      openRouterFastPresetModelId,
      openRouterReasoningPresetModelId,
      shouldRoutePresetsToOpenRouter,
    ],
  );
  useEffect(() => {
    if (!byokConnected || !connectedByokProvider) {
      lastConnectedByokProviderRef.current = null;
      return;
    }

    const previousProvider = lastConnectedByokProviderRef.current;
    lastConnectedByokProviderRef.current = connectedByokProvider;
    if (previousProvider === connectedByokProvider) {
      return;
    }

    const currentModelProvider: ComposerByokProvider = isOpenRouterModel(conversationModel)
      ? "openrouter"
      : "openai";
    if (currentModelProvider === connectedByokProvider) {
      return;
    }

    if (connectedByokProvider === "openai") {
      void handleModelSelection(
        START_MODE_DEFAULTS.fast.model,
        START_MODE_DEFAULTS.fast.reasoningEffort,
        "fast",
      );
      return;
    }

    if (!openRouterFastPresetModelId) {
      setError("OpenRouter models are still loading. Please try again in a moment.");
      return;
    }

    void handleModelSelection(openRouterFastPresetModelId, null, "fast");
  }, [
    byokConnected,
    connectedByokProvider,
    conversationModel,
    handleModelSelection,
    openRouterFastPresetModelId,
  ]);
  const sendDisabledReason = isPending
    ? "Sending..."
    : hasPendingAttachments
      ? "Attachments uploading"
      : hasErroredAttachments
        ? "Resolve failed attachments"
        : !byokConnected
          ? "Sign in with ChatGPT"
          : null;
  const isSendDisabled = sendDisabledReason !== null;

  const submitMessage = (): boolean => {
    if (isPending) {
      return false;
    }

    if (!byokConnected) {
      setIsByokPanelOpen(true);
      setError("Sign in to Codex with ChatGPT, then restart Branch Chat locally.");
      return false;
    }

    if (isByokProviderModelMismatch) {
      setError(byokProviderModelMismatchMessage);
      setIsAdvancedControlsOpen(true);
      return false;
    }

    if (
      attachments.some(
        (attachment) =>
          attachment.status === "pending" || attachment.status === "uploading",
      )
    ) {
      setError("Please wait for files to finish uploading before sending.");
      return false;
    }

    if (attachments.some((attachment) => attachment.status === "error")) {
      setError("Remove or retry failed uploads before sending.");
      return false;
    }

    const content = value.trim();
    if (!content) {
      setError("Enter a message before sending.");
      return false;
    }

    setError(null);
    const readyAttachmentIds = attachments
      .filter((attachment) => attachment.status === "ready" && attachment.id)
      .map((attachment) => attachment.id as string);
    const optimisticId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `optimistic-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    if (!isBranchDraft) {
      emitOptimisticUserMessage({
        conversationId,
        branchId,
        messageId: optimisticId,
        content,
        createdAt: new Date().toISOString(),
      });
    }

    startTransition(async () => {
      try {
        const streamId =
          typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `stream-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        if (!isBranchDraft) {
          onStreamStart?.(streamId);
          emitStartStreaming({ conversationId, branchId, streamId });
        }
        const result = await sendMessage({
          conversationId,
          branchId: isBranchDraft ? undefined : branchId,
          branchDraft: isBranchDraft ? branchDraft : undefined,
          content,
          streamId: isBranchDraft ? undefined : streamId,
          byok: true,
          sessionByok:
            !byokEnabled && sessionByokCredential
              ? sessionByokCredential
              : undefined,
          tools: selectedTools,
          attachmentIds: readyAttachmentIds,
        });
        setValue("");
        setAttachments([]);
        attachmentsRef.current = [];

        if (isBranchDraft) {
          await onDraftCreated?.(result);
          return;
        }

        const branchCount = Object.keys(result.snapshot.branches).length;
        const rootBranch =
          result.snapshot.branches[result.snapshot.conversation.rootBranchId];
        const persistedAssistantMessage = result.appendedMessages.find(
          (message) => message.role === "assistant" && message.branchId === branchId,
        );
        const assistantRenderedHtml =
          persistedAssistantMessage &&
          typeof result.assistantRenderedHtml === "string" &&
          result.assistantRenderedHtml.length > 0
            ? result.assistantRenderedHtml
            : null;
        const persistedBranchMessages = result.appendedMessages.filter(
          (
            message,
          ): message is (typeof result.appendedMessages)[number] & {
            role: "user" | "assistant";
          } =>
            message.branchId === branchId &&
            (message.role === "user" || message.role === "assistant"),
        );
        if (persistedBranchMessages.length > 0) {
          emitPersistedMessages({
            conversationId,
            branchId,
            messages: persistedBranchMessages.map((message) => ({
              id: message.id,
              branchId: message.branchId,
              role: message.role,
              content: message.content,
              renderedHtml:
                message.role === "assistant" &&
                persistedAssistantMessage?.id === message.id
                  ? assistantRenderedHtml
                  : null,
              createdAt: message.createdAt,
              tokenUsage: message.tokenUsage ?? null,
              attachments: message.attachments ?? null,
              toolInvocations: message.toolInvocations ?? null,
            })),
          });
        }
        const persistedUserMessage = result.appendedMessages.find(
          (message) => message.role === "user" && message.branchId === branchId,
        );
        emitOptimisticMessageClear({
          conversationId,
          branchId,
          messageId: optimisticId,
          reason: "resolved",
          replacementMessageId: persistedUserMessage?.id ?? null,
        });
        emitDirectoryUpdate({
          conversationId,
          title: rootBranch?.title ?? conversationId,
          branchCount,
          lastActiveAt: new Date().toISOString(),
          archivedAt: null,
        });

        if (typeof window !== "undefined") {
          const scheduleRefresh = (delay: number) => {
            const timer = window.setTimeout(async () => {
              try {
                const summary = await getConversationSummary({
                  conversationId,
                });
                emitDirectoryUpdate(summary);
              } catch (refreshError) {
                console.error(
                  "[Composer] refresh conversation summary failed",
                  refreshError,
                );
              } finally {
                pendingRefreshTimers.current = pendingRefreshTimers.current.filter(
                  (value) => value !== timer,
                );
              }
            }, delay);
            pendingRefreshTimers.current.push(timer);
          };

          scheduleRefresh(1500);
          scheduleRefresh(4000);
        }
      } catch (cause) {
        if (!isBranchDraft) {
          emitOptimisticMessageClear({
            conversationId,
            branchId,
            messageId: optimisticId,
            reason: "failed",
          });
        }
        console.error("[Composer] sendMessage failed", cause);
        const errorMessage = extractErrorMessage(cause);
        if (
          errorMessage.includes("Switch models or update your BYOK key") ||
          errorMessage.includes("model requires")
        ) {
          setIsAdvancedControlsOpen(true);
        }
        setError(errorMessage || "We couldn't send that message. Please try again.");
      }
    });
    return true;
  };

  const saveNote = (): void => {
    if (!isBranchDraft || !branchDraft || isPending) return;
    const content = value.trim();
    if (!content) {
      setError("Enter a note before saving.");
      return;
    }
    if (hasPendingAttachments) {
      setError("Please wait for files to finish uploading before saving.");
      return;
    }
    if (hasErroredAttachments) {
      setError("Remove or retry failed uploads before saving.");
      return;
    }
    const attachmentIds = attachments
      .filter((attachment) => attachment.status === "ready" && attachment.id)
      .map((attachment) => attachment.id as string);
    setError(null);
    startTransition(async () => {
      try {
        const result = await saveBranchNote({
          conversationId,
          ...branchDraft,
          content,
          attachmentIds,
        });
        setValue("");
        setAttachments([]);
        attachmentsRef.current = [];
        await onDraftCreated?.(result);
      } catch (cause) {
        console.error("[Composer] save branch note failed", cause);
        setError(extractErrorMessage(cause) || "We couldn't save that note. Try again.");
      }
    });
  };

  useEffect(() => {
    const pending = autoSendPendingRef.current;
    if (!pending) {
      return;
    }
    if (isPending) {
      return;
    }
    if (value.trim().length === 0) {
      return;
    }
    if (value.trim() !== pending.trim()) {
      autoSendPendingRef.current = null;
      return;
    }
    const didStart = submitMessage();
    if (didStart) {
      autoSendPendingRef.current = null;
      if (onBootstrapConsumed) {
        onBootstrapConsumed();
      }
    }
  }, [isPending, onBootstrapConsumed, submitMessage, value]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitMessage();
  };

  return (
    <div className={cn("flex w-full flex-col gap-2", className)}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.doc,.docx,.txt,image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          void handleFilesSelected(event.target.files);
        }}
      />
      {branchContextLabel ? (
        <div className="px-1">
          <div
            className="rounded border border-border bg-secondary px-3 py-1.5"
            title={`From parent selection: “${branchContextLabel}”`}
          >
            <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              From parent selection
            </p>
            <p className="mt-0.5 truncate text-[11px] font-semibold text-foreground">
              “{branchContextLabel}”
            </p>
          </div>
        </div>
      ) : null}
      {isBrowser && isByokPanelOpen
        ? createPortal(
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
              role="dialog"
              aria-modal="true"
            >
              <div className="mx-4 w-full max-w-3xl rounded border border-border bg-card p-6 shadow-2xl">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      ChatGPT account
                    </p>
                    <p className="mt-2 text-sm font-medium text-foreground">
                      {byokConnected
                        ? accountState?.chatgpt.email ?? "Connected through Codex"
                        : "Not connected"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {byokConnected
                        ? `${accountState?.chatgpt.planType ?? "ChatGPT"} plan · authenticated by the local Codex app-server`
                        : "Run `codex login`, choose ChatGPT, then restart the local app."}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsByokPanelOpen(false)}
                    className="interactive-target inline-flex h-8 items-center rounded-full border border-border/70 bg-background px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
      {isAdvancedControlsOpen ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-border bg-card px-3 py-2">
          <button
            type="button"
            onClick={() => setIsByokPanelOpen(true)}
            className="interactive-target inline-flex items-center rounded border border-border px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-foreground hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {byokConnected ? "ChatGPT connected" : "ChatGPT sign-in"}
          </button>
        </div>
      ) : null}
      <form
        onSubmit={handleSubmit}
        className={cn(
          "rounded border border-border bg-background text-foreground",
          isBranchDraft
            ? "flex min-h-0 flex-1 flex-col shadow-none"
            : "shadow-sm",
        )}
      >
        {(hasSelectedTools || isReasoningModel) ? (
          <div className="flex items-center gap-0.5 border-b border-border px-2 py-1">
            {activeToolOptions.map((option) => (
              <button
                key={`status-${option.id}`}
                type="button"
                onClick={() => handleRemoveTool(option.id)}
                className="interactive-target inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-foreground/70 hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                title={`${option.label} — click to remove`}
                aria-label={`${option.label} active, click to remove`}
              >
                <option.icon className="h-3.5 w-3.5" aria-hidden="true" />
                <X className="h-2.5 w-2.5 opacity-50" aria-hidden="true" />
              </button>
            ))}
            {isReasoningModel ? (
              <button
                type="button"
                onClick={() => applyPresetModelSelection("fast", null)}
                className="interactive-target inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-foreground/70 hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                title={
                  isFastPreset
                    ? `Fast · GPT-5.6 Terra · ${REASONING_EFFORT_LABELS[currentReasoningEffort]}`
                    : `Reasoning (${REASONING_EFFORT_LABELS[currentReasoningEffort]}) — click to switch to fast`
                }
                aria-label={
                  isFastPreset
                    ? `Fast mode active with medium reasoning`
                    : `Reasoning mode active, click to switch to fast`
                }
              >
                <Zap className="h-3.5 w-3.5" aria-hidden="true" />
                <X className="h-2.5 w-2.5 opacity-50" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        ) : null}

        <div
          className={cn(
            "flex items-center gap-2 px-3",
            isBranchDraft
              ? "min-h-0 flex-1 flex-wrap content-start py-3"
              : "h-12",
          )}
        >
          {isBranchDraft ? (
            <span
              className="order-1 mr-auto max-w-[14rem] truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
              title={currentModelLabel}
            >
              {currentModelLabel}
            </span>
          ) : null}
          <div className={cn("relative", isBranchDraft ? "order-2" : null)} ref={toolMenuRef}>
            <button
              type="button"
              className="interactive-target inline-flex h-9 w-9 shrink-0 items-center justify-center rounded border border-border bg-background text-foreground hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label="New prompt options"
              aria-expanded={isToolMenuOpen}
              aria-controls={isToolMenuOpen ? toolMenuId : undefined}
              aria-haspopup="menu"
              onClick={() => setIsToolMenuOpen((prev) => !prev)}
            >
              <Plus className="h-5 w-5" aria-hidden="true" />
            </button>

            {isToolMenuOpen ? (
            <div
              id={toolMenuId}
              role="menu"
              className={cn(
                "absolute left-0 z-20 w-56 rounded border border-border bg-popover p-1 shadow-xl",
                isBranchDraft ? "top-full mt-2" : "bottom-full mb-2",
              )}
            >
              {TOOL_OPTIONS.map((option) => {
                const isSelected = selectedTools.includes(option.id);
                const isDisabled =
                  option.id === "web-search" && !webSearchSelectable;
                const optionDescription =
                  option.id === "web-search" && !webSearchSelectable
                    ? "Unavailable for this model"
                    : option.description;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={isSelected}
                    aria-disabled={isDisabled ? true : undefined}
                    disabled={isDisabled}
                    onClick={() => {
                      if (isDisabled) {
                        setError(
                          "Web search is unavailable for this model.",
                        );
                        setIsToolMenuOpen(false);
                        return;
                      }
                      handleToolSelect(option.id);
                    }}
                    className={cn(
                      "interactive-target flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
                      isSelected
                        ? "state-selected font-semibold text-primary-foreground"
                        : isDisabled
                          ? "cursor-not-allowed text-muted-foreground"
                          : "hover:bg-muted/70",
                    )}
                  >
                    <span
                    className={cn(
                      "interactive-target inline-flex h-7 w-7 items-center justify-center rounded-full border border-transparent",
                      isSelected
                          ? "border-primary/40 bg-primary/20 text-primary-foreground"
                          : isDisabled
                            ? "bg-muted text-muted-foreground/60"
                            : "bg-muted text-muted-foreground/80",
                    )}
                  >
                    {isSelected ? (
                      <Check className="h-3.5 w-3.5 text-primary-foreground" aria-hidden="true" />
                    ) : (
                      <option.icon className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                  </span>
                    <span className="flex-1">
                      <span className="block font-medium">{option.label}</span>
                      {optionDescription ? (
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {optionDescription}
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}

              <div className="my-1 border-t border-border/60" aria-hidden="true" />

              <button
                type="button"
                role="menuitem"
                onClick={handleClearTool}
                disabled={!hasSelectedTools}
                className={cn(
                  "interactive-target flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
                  hasSelectedTools
                    ? "hover:bg-muted/70"
                    : "cursor-default text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "inline-flex h-6 w-6 items-center justify-center rounded-full",
                    hasSelectedTools
                      ? "bg-primary/25 text-primary-foreground"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                <span className="flex-1 font-medium">Clear selection</span>
              </button>
            </div>
          ) : null}
          </div>

          <div
            className={cn(
              "relative flex flex-1 items-center",
              isBranchDraft
                ? "order-5 min-h-[150px] basis-full items-start border-t border-border pt-3"
                : null,
            )}
          >
            <label htmlFor="conversation-composer" className="sr-only">
              Message
            </label>
            <textarea
              id="conversation-composer"
              ref={textareaRef}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={
                isBranchDraft
                  ? "Write a note or ask the model…"
                  : "Ask Connexus to explore a new direction..."
              }
              rows={isBranchDraft ? 8 : 1}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  submitMessage();
                }
              }}
              className={cn(
                "w-full resize-none border-none bg-transparent px-0 text-sm text-foreground caret-foreground placeholder:text-muted-foreground/60 focus:outline-none disabled:cursor-not-allowed disabled:opacity-70",
                isBranchDraft ? "h-full min-h-[150px] leading-6" : "leading-tight",
              )}
              disabled={isPending}
              aria-disabled={isPending}
              aria-invalid={error ? true : undefined}
              style={isBranchDraft ? undefined : { height: BASE_TEXTAREA_HEIGHT }}
            />
            <button
              type="button"
              onClick={() => {
                setIsComposerModalOpen(true);
              }}
              className="absolute bottom-1 right-2 inline-flex h-3 w-3 items-center justify-center rounded border border-border bg-background text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label="Open large editor"
            >
              <Maximize className="h-2 w-2" aria-hidden="true" />
            </button>
          </div>

          {isAdvancedControlsOpen ? (
            <div className={cn("relative flex items-center gap-2", isBranchDraft ? "order-3" : null)}>
              <button
                type="button"
                ref={modelButtonRef}
                onClick={() => setIsModelMenuOpen((value) => !value)}
                className={cn(
                  "interactive-target inline-flex h-9 items-center gap-1 border border-border bg-background px-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-foreground hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-55",
                  isModelMenuOpen ? "bg-muted text-foreground" : null,
                )}
                aria-haspopup="menu"
                aria-expanded={isModelMenuOpen}
                aria-controls={isModelMenuOpen ? modelMenuId : undefined}
                disabled={conversationSettingsSaving}
              >
                <span className="text-xs font-semibold text-foreground">Model</span>
                <ChevronDown
                  className={cn(
                    "h-3 w-3 text-foreground transition-transform",
                    isModelMenuOpen ? "rotate-180 text-accent" : "rotate-0",
                  )}
                  aria-hidden="true"
                />
              </button>
              <div className="flex flex-col items-end justify-center">
                {conversationSettingsSaving ? (
                  <span className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
                    Saving…
                  </span>
                ) : conversationSettingsError ? (
                  <span className="text-[10px] text-destructive">
                    {conversationSettingsError}
                  </span>
                ) : null}
              </div>
              {isModelMenuOpen ? (
                <div
                  ref={modelMenuRef}
                  id={modelMenuId}
                  role="menu"
                  className={cn(
                    "absolute right-0 z-30 max-h-[calc(100vh-7rem)] w-72 overflow-y-auto rounded border border-border bg-popover p-2 shadow-xl",
                    isBranchDraft ? "top-full mt-2" : "bottom-full mb-2",
                  )}
                >
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={isFastPreset}
                  onClick={() => {
                    applyPresetModelSelection("fast", null);
                  }}
                  disabled={conversationSettingsSaving}
                  className={cn(
                    "interactive-target flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
                    isFastPreset ? "state-selected font-semibold text-primary-foreground" : "hover:bg-muted/70",
                  )}
                >
                  <span className="font-medium">Fast chat</span>
                  <span className={modelBadgeClassName} aria-hidden="true">
                    {modelEmojis.fast}
                  </span>
                </button>

                <div className="my-2 border-t border-border/60" aria-hidden="true" />
                <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  ChatGPT models
                </div>

                {CHATGPT_MODEL_OPTIONS.map((model) => {
                  const isSelected =
                    conversationModel === model.id && !isFastPreset;
                  return (
                    <button
                      key={`composer-chatgpt-${model.id}`}
                      type="button"
                      role="menuitemradio"
                      aria-checked={isSelected}
                      onClick={() => {
                        void handleModelSelection(
                          model.id,
                          resolveReasoningEffortForModel(
                            model.id,
                            reasoningEffort,
                          ),
                        );
                      }}
                      disabled={conversationSettingsSaving}
                      className={cn(
                        "interactive-target flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
                        isSelected ? "state-selected font-semibold text-primary-foreground" : "hover:bg-muted/70",
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{model.label}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {model.description}
                        </span>
                      </span>
                    </button>
                  );
                })}

                {selectedChatGPTModel ? (
                  <>
                    <div className="my-2 border-t border-border/60" aria-hidden="true" />
                    <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      Reasoning effort
                    </div>
                    {reasoningOptions.map((option) => {
                      const isSelected = currentReasoningEffort === option;
                      return (
                        <button
                          key={`composer-reasoning-${option}`}
                          type="button"
                          role="menuitemradio"
                          aria-checked={isSelected}
                          onClick={() => {
                            void handleModelSelection(conversationModel, option);
                          }}
                          disabled={conversationSettingsSaving}
                          className={cn(
                            "interactive-target flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
                            isSelected
                              ? "state-selected font-semibold text-primary-foreground"
                              : "hover:bg-muted/70",
                          )}
                        >
                          <span className="font-medium">
                            {REASONING_EFFORT_LABELS[option]}
                          </span>
                          <span className={modelBadgeClassName} aria-hidden="true">
                            {modelEmojis[option]}
                          </span>
                        </button>
                      );
                    })}
                  </>
                ) : null}

                {openRouterModels.length > 0 ? (
                  <>
                    <div className="my-2 border-t border-border/60" aria-hidden="true" />
                    <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      OpenRouter models
                    </div>
                    {openRouterModels.map((model) => {
                      const isSelected = conversationModel === model.id;
                      return (
                        <button
                          key={`composer-openrouter-${model.id}`}
                          type="button"
                          role="menuitemradio"
                          aria-checked={isSelected}
                          onClick={() => {
                            void handleModelSelection(model.id, null);
                          }}
                          disabled={conversationSettingsSaving}
                          className={cn(
                            "interactive-target flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
                            isSelected ? "state-selected font-semibold text-primary-foreground" : "hover:bg-muted/70",
                          )}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{model.name}</span>
                            <span className="block truncate text-[11px] text-muted-foreground">
                              {model.rawId}
                            </span>
                          </span>
                          {model.isFree ? (
                            <span className="rounded-full border border-border/70 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                              Free
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </>
                ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {sendDisabledReason && !error ? (
            <span
              className="hidden text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground md:inline-flex"
              aria-live="polite"
            >
              {sendDisabledReason}
            </span>
          ) : null}

          <button
            type="button"
            onClick={() => setIsAdvancedControlsOpen((previous) => !previous)}
            className={cn(
              "interactive-target inline-flex h-9 w-9 shrink-0 items-center justify-center rounded border border-border text-foreground hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              isAdvancedControlsOpen ? "bg-muted" : "bg-background",
              isBranchDraft ? "order-4" : null,
            )}
            aria-label={isAdvancedControlsOpen ? "Hide controls" : "Show controls"}
            aria-expanded={isAdvancedControlsOpen}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
          </button>

          {isBranchDraft ? (
            <button
              type="button"
              onClick={saveNote}
              disabled={isPending || hasPendingAttachments || hasErroredAttachments}
              className="interactive-target order-6 ml-auto inline-flex h-9 shrink-0 items-center justify-center rounded border border-border bg-background px-3 text-xs font-semibold text-foreground hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-55"
            >
              Save note
            </button>
          ) : null}

          <button
            type="submit"
            disabled={isSendDisabled}
            className={cn(
              "interactive-target inline-flex h-9 w-9 shrink-0 items-center justify-center rounded border border-border bg-foreground text-background hover:bg-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-55",
              isPending ? "animate-pulse" : "",
              isBranchDraft ? "order-7" : null,
            )}
            aria-label={isBranchDraft ? "Send to model and create branch" : "Send message"}
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <SendHorizontal className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>

        {(attachments.length > 0 || (fileUploadSelected && canAddMoreAttachments)) ? (
          <div className="border-t border-border px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              {attachments.map((attachment) => {
                const statusIcon = (() => {
                  if (attachment.status === "ready") {
                    return <Paperclip className="h-3.5 w-3.5 text-primary" aria-hidden="true" />;
                  }
                  if (attachment.status === "error") {
                    return <AlertTriangle className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />;
                  }
                  return (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden="true" />
                  );
                })();

                const subtitle =
                  attachment.status === "ready"
                    ? formatBytes(attachment.size)
                    : attachment.status === "error"
                      ? "Upload failed"
                      : `${formatBytes(attachment.size)} · Uploading…`;

                return (
                  <div
                    key={attachment.tempId}
                    className="flex items-center gap-2 rounded border border-border px-3 py-1 text-[11px]"
                  >
                    <span className="inline-flex h-5 w-5 items-center justify-center">
                      {statusIcon}
                    </span>
                    <div className="flex max-w-[160px] flex-col">
                      <span className="truncate text-[11px] font-semibold text-foreground">
                        {attachment.name}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{subtitle}</span>
                      {attachment.status === "error" && attachment.error ? (
                        <span className="text-[10px] text-destructive">{attachment.error}</span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1">
                      {attachment.status === "error" ? (
                        <button
                          type="button"
                          onClick={() => handleRetryAttachment(attachment.tempId)}
                          className="interactive-target inline-flex h-5 w-5 items-center justify-center rounded-full border border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                          aria-label={`Retry ${attachment.name}`}
                        >
                          <RotateCcw className="h-3 w-3" aria-hidden="true" />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => handleRemoveAttachment(attachment.tempId)}
                        className="interactive-target inline-flex h-5 w-5 items-center justify-center rounded-full border border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                        aria-label={`Remove ${attachment.name}`}
                      >
                        <X className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                );
              })}
              {fileUploadSelected && canAddMoreAttachments ? (
                <button
                  type="button"
                  onClick={openFilePicker}
                  className="interactive-target inline-flex items-center gap-2 rounded border border-dashed border-border px-3 py-1 text-[11px] font-medium text-foreground hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Add files</span>
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </form>

      {isBrowser && isComposerModalOpen
        ? createPortal(
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
              role="dialog"
              aria-modal="true"
            >
              <div className="mx-4 w-full max-w-3xl rounded border border-border bg-card p-6 shadow-2xl">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-foreground">
                    Expanded Composer
                  </h2>
                  <button
                    type="button"
                    onClick={() => setIsComposerModalOpen(false)}
                    className="interactive-target inline-flex h-7 w-7 items-center justify-center rounded border border-border text-muted-foreground transition hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    aria-label="Close expanded editor"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
                <textarea
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  autoFocus
                  placeholder="Ask Connexus to explore a new direction..."
                  className="h-64 w-full resize-none rounded border border-border bg-background px-4 py-3 text-base text-foreground shadow-inner focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setIsComposerModalOpen(false)}
                    className="interactive-target inline-flex items-center gap-2 rounded border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      <div className="flex items-center justify-between gap-2 px-2">
        {!isBranchDraft ? (
          <span
            className="truncate text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"
            title={currentModelLabel}
          >
            {`Model ${currentModelLabel}`}
          </span>
        ) : null}
        {error ? (
          <p className="text-right text-xs text-destructive" role="status">
            {error}
          </p>
        ) : sendDisabledReason ? (
          <span className="text-right text-xs text-muted-foreground">
            {sendDisabledReason}
          </span>
        ) : !isBranchDraft ? (
          <span className="text-right text-xs text-muted-foreground">
            Enter to send · Shift+Enter for line break
          </span>
        ) : null}
      </div>
      <p
        className="sr-only"
        role="status"
        aria-live={!byokConnected ? "assertive" : "polite"}
      >
        {byokIndicatorText}
      </p>
    </div>
  );
}
