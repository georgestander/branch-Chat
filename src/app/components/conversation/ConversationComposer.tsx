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
} from "lucide-react";

import {
  createAttachmentUploadAction,
  deleteComposerByokKey,
  finalizeAttachmentUploadAction,
  getComposerAccountState,
  getConversationSummary,
  removeAttachmentUploadAction,
  saveComposerByokKey,
  sendMessage,
  type ComposerByokProvider,
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
import type { ComposerPreset } from "@/lib/conversation";
import type { ConversationComposerTool } from "@/lib/conversation/tools";
import {
  isWebSearchSupportedModel,
  supportsReasoningEffortModel,
} from "@/lib/openai/models";
import { useToast } from "@/app/components/ui/Toast";
import {
  isOpenRouterModel,
  stripOpenRouterPrefix,
  type OpenRouterModelOption,
} from "@/lib/openrouter/models";
import {
  readComposerLanePreference,
  subscribeComposerLanePreference,
  writeComposerLanePreference,
  type ComposerLane,
} from "@/app/components/conversation/lanePreference";

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
    reasoningEffort: "low" | "medium" | "high" | null;
    tools: ConversationComposerTool[];
  }
> = {
  fast: {
    model: "gpt-5-chat-latest",
    reasoningEffort: null,
    tools: [],
  },
  reasoning: {
    model: "gpt-5-mini",
    reasoningEffort: "medium",
    tools: [],
  },
  study: {
    model: "gpt-5-mini",
    reasoningEffort: "medium",
    tools: ["study-and-learn"],
  },
};
const DEFAULT_DEMO_PASS_TOTAL = 3;
const DEMO_PASS_WARNING_THRESHOLD = 2;
const DEMO_PASS_CRITICAL_THRESHOLD = 1;

type ComposerAccountStateResponse = Awaited<
  ReturnType<typeof getComposerAccountState>
>;

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

function inferComposerPreset(options: {
  model: string;
  reasoningEffort: "low" | "medium" | "high" | null;
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
  reasoningEffort: "low" | "medium" | "high" | null;
  composerPreset: ComposerPreset;
  composerTools: ConversationComposerTool[];
  openRouterModels: OpenRouterModelOption[];
  onConversationSettingsChange: (
    model: string,
    effort: "low" | "medium" | "high" | null,
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
  const [selectedLane, setSelectedLane] = useState<ComposerLane>("demo");
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
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingRefreshTimers = useRef<number[]>([]);
  const previousDemoRemainingRef = useRef<number | null>(null);
  const accountStateRequestIdRef = useRef(0);
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
  const webSearchSupported = isWebSearchSupportedModel(conversationModel);
  const { notify } = useToast();
  const reasoningOptions: Array<"low" | "medium" | "high"> = [
    "low",
    "medium",
    "high",
  ];
  const modelEmojis = {
    fast: "🚀",
    low: "🧠",
    medium: "🧠🧠",
    high: "🧠🧠🧠",
  } as const;
  const effortLabels: Record<"low" | "medium" | "high", string> = {
    low: "Low",
    medium: "Medium",
    high: "High",
  };

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
  const currentReasoningEffort = (reasoningEffort ?? "low") as "low" | "medium" | "high";
  const selectedOpenRouterModel = openRouterModels.find(
    (model) => model.id === conversationModel,
  );
  const openRouterSelected = isOpenRouterModel(conversationModel);
  const isReasoningModel = supportsReasoningEffortModel(conversationModel);
  const currentModelLabel = selectedOpenRouterModel
    ? selectedOpenRouterModel.name
    : openRouterSelected
      ? stripOpenRouterPrefix(conversationModel)
      : isReasoningModel
        ? `Reasoning · ${effortLabels[currentReasoningEffort]}`
        : "Fast chat";
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
      webSearchSupported ? true : tool !== "web-search",
    );
    setSelectedTools((previous) =>
      isSameToolSelection(previous, defaults) ? previous : defaults,
    );
  }, [composerTools, webSearchSupported]);

  useEffect(() => {
    const storedLane = readComposerLanePreference({ conversationId });
    setSelectedLane(storedLane ?? "demo");
  }, [conversationId]);

  useEffect(() => {
    writeComposerLanePreference(selectedLane, { conversationId });
  }, [conversationId, selectedLane]);

  useEffect(() => {
    return subscribeComposerLanePreference((nextLane) => {
      setSelectedLane((previous) => (previous === nextLane ? previous : nextLane));
    });
  }, []);

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
        setError((previous) => previous ?? "We couldn't load account quota state.");
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
    previousDemoRemainingRef.current = null;
  }, [conversationId]);

  useEffect(() => {
    if (accountState?.byok.provider) {
      setByokProvider(accountState.byok.provider);
      return;
    }
    setByokProvider(getProviderForModel(conversationModel));
  }, [accountState?.byok.provider, conversationModel]);

  useEffect(() => {
    if (accountState && !accountState.byok.connected && selectedLane === "byok") {
      setSelectedLane("demo");
    }
  }, [accountState, selectedLane]);

  const handleSaveByokKey = useCallback(async () => {
    if (isByokSaving) {
      return;
    }
    const nextByokEnabled = accountState?.byok.enabled ?? false;
    const nextByokUnavailableReason = accountState?.byok.unavailableReason ?? null;
    if (!nextByokEnabled) {
      setError(
        nextByokUnavailableReason ||
          "BYOK is disabled for this environment.",
      );
      setIsByokPanelOpen(true);
      return;
    }
    const normalizedKey = byokApiKey.trim();
    if (!normalizedKey) {
      setError("Enter an API key before connecting BYOK.");
      setIsByokPanelOpen(true);
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
      setSelectedLane("byok");
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
    isByokSaving,
    loadComposerAccountState,
  ]);

  const handleDeleteByokKey = useCallback(async () => {
    if (isByokSaving) {
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
      setSelectedLane("demo");
      setByokApiKey("");
      await loadComposerAccountState({ showLoading: false });
    } catch (deleteError) {
      console.error("[Composer] delete BYOK key failed", deleteError);
      setError("We couldn't disconnect your BYOK key. Please try again.");
    } finally {
      setIsByokSaving(false);
    }
  }, [isByokSaving, loadComposerAccountState]);

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
        reasoningEffort?: "low" | "medium" | "high" | null;
      },
    ) => {
      const nextModel = options?.model ?? conversationModel;
      const nextEffort = options?.reasoningEffort ?? reasoningEffort;
      const normalizedEffort = supportsReasoningEffortModel(nextModel)
        ? (nextEffort ?? "low")
        : null;
      const webSearchSupportedForModel = isWebSearchSupportedModel(nextModel);
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
    if (webSearchSupported) {
      return;
    }
    if (!selectedTools.includes("web-search")) {
      return;
    }
    const nextTools = selectedTools.filter((tool) => tool !== "web-search");
    setSelectedTools(nextTools);
    persistComposerDefaults(nextTools);
  }, [persistComposerDefaults, selectedTools, webSearchSupported]);

  const handleToolSelect = useCallback(
    (tool: ToolOption["id"]) => {
      if (tool === "web-search" && !webSearchSupported) {
        setError("Web search is unavailable for this model. Switch to Fast chat or GPT-5 Mini.");
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
    [openFilePicker, persistComposerDefaults, selectedTools, webSearchSupported],
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
      nextEffort: "low" | "medium" | "high" | null,
    ) => {
      const normalizedEffort = supportsReasoningEffortModel(nextModel)
        ? (nextEffort ?? "low")
        : null;
      const nextTools = sanitizeStoredComposerTools(selectedTools).filter((tool) =>
        isWebSearchSupportedModel(nextModel) ? true : tool !== "web-search",
      );
      const inferredPreset = inferComposerPreset({
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
          const effortLabel = effortLabels[(nextEffort ?? "low") as "low" | "medium" | "high"];
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
  const byokEnabled = accountState?.byok.enabled ?? false;
  const byokUnavailableReason = accountState?.byok.unavailableReason ?? null;
  const byokConnected = Boolean(accountState?.byok.connected && byokEnabled);
  const connectedByokProvider = accountState?.byok.provider ?? null;
  const byokProviderLabel =
    connectedByokProvider === "openrouter" ? "OpenRouter" : "OpenAI";
  const isByokProviderModelMismatch =
    selectedLane === "byok" &&
    byokConnected &&
    ((connectedByokProvider === "openrouter" && !isOpenRouterModel(conversationModel)) ||
      (connectedByokProvider === "openai" && isOpenRouterModel(conversationModel)));
  const byokProviderModelMismatchMessage =
    connectedByokProvider === "openrouter"
      ? "Your BYOK key is OpenRouter. Switch to an OpenRouter model before sending."
      : connectedByokProvider === "openai"
        ? "Your BYOK key is OpenAI. Switch to an OpenAI model before sending."
        : "Switch to a model matching your BYOK provider before sending.";
  const byokProviderModelHint =
    connectedByokProvider === "openrouter"
      ? "Use an OpenRouter model when sending in BYOK lane."
      : connectedByokProvider === "openai"
        ? "Use an OpenAI model when sending in BYOK lane."
      : null;
  const demoTotalPasses = accountState?.quota.total ?? DEFAULT_DEMO_PASS_TOTAL;
  const demoRemainingPasses = accountState?.quota.remaining ?? null;
  const isDemoLaneExhausted =
    selectedLane === "demo" &&
    !isAccountStateLoading &&
    demoRemainingPasses !== null &&
    demoRemainingPasses <= 0;
  const quotaChipText =
    selectedLane === "byok" && byokConnected
      ? "Unlimited"
      : isAccountStateLoading
        ? "Passes --"
        : demoRemainingPasses === null
          ? "Passes ?"
          : `Passes ${demoRemainingPasses}/${demoTotalPasses}`;
  const quotaChipClassName =
    selectedLane === "byok" && byokConnected
      ? "border-emerald-400/40 text-emerald-200"
      : isDemoLaneExhausted
        ? "border-destructive/70 text-destructive"
        : demoRemainingPasses !== null && demoRemainingPasses <= DEMO_PASS_CRITICAL_THRESHOLD
          ? "border-amber-400/70 text-amber-200"
          : "border-background/35 text-background/85";
  const quotaIndicatorText =
    selectedLane === "byok" && byokConnected
      ? "BYOK lane: unlimited via your key."
      : isAccountStateLoading
        ? "Demo lane: loading pass balance..."
        : demoRemainingPasses === null
          ? "Demo lane: pass balance unavailable."
          : `Demo lane: ${demoRemainingPasses} pass${demoRemainingPasses === 1 ? "" : "es"} remaining.`;
  const sendDisabledReason = isPending
    ? "Sending..."
    : hasPendingAttachments
      ? "Attachments uploading"
      : hasErroredAttachments
        ? "Resolve failed attachments"
        : isDemoLaneExhausted
          ? "No demo passes left"
          : null;
  const isSendDisabled = sendDisabledReason !== null;

  useEffect(() => {
    if (!byokConnected) {
      return;
    }
    if (selectedLane !== "demo") {
      return;
    }
    if (isAccountStateLoading || demoRemainingPasses === null || demoRemainingPasses > 0) {
      return;
    }

    setSelectedLane("byok");
    notify({
      title: "Switched to BYOK lane",
      description: "Demo passes are exhausted, so new sends will use your connected key.",
    });
    console.info("[TRACE] quota:ui:auto-switch-byok", {
      conversationId,
      remaining: demoRemainingPasses,
    });
  }, [
    byokConnected,
    conversationId,
    demoRemainingPasses,
    isAccountStateLoading,
    notify,
    selectedLane,
  ]);

  useEffect(() => {
    if (isAccountStateLoading || demoRemainingPasses === null) {
      return;
    }

    const previousRemaining = previousDemoRemainingRef.current;
    previousDemoRemainingRef.current = demoRemainingPasses;

    if (
      previousRemaining === null ||
      demoRemainingPasses >= previousRemaining
    ) {
      return;
    }

    if (demoRemainingPasses === DEMO_PASS_WARNING_THRESHOLD) {
      notify({
        title: `${DEMO_PASS_WARNING_THRESHOLD} free passes left`,
        description: "You are nearing the demo cap.",
      });
      console.info("[TRACE] quota:ui:threshold", {
        conversationId,
        threshold: DEMO_PASS_WARNING_THRESHOLD,
        remaining: demoRemainingPasses,
      });
      return;
    }

    if (demoRemainingPasses === DEMO_PASS_CRITICAL_THRESHOLD) {
      notify({
        variant: "warning",
        title: "1 free pass left",
        description: "Your next demo message will consume the final pass.",
      });
      console.info("[TRACE] quota:ui:threshold", {
        conversationId,
        threshold: DEMO_PASS_CRITICAL_THRESHOLD,
        remaining: demoRemainingPasses,
      });
      return;
    }

    if (demoRemainingPasses === 0) {
      notify({
        variant: "destructive",
        title:
          previousRemaining === DEMO_PASS_CRITICAL_THRESHOLD
            ? "Last free pass used"
            : "Free passes exhausted",
        description: byokEnabled
          ? "Connect your API key and switch to BYOK lane to continue."
          : `All ${demoTotalPasses} demo passes are used for this account.`,
      });
      console.info("[TRACE] quota:ui:threshold", {
        conversationId,
        threshold: 0,
        remaining: demoRemainingPasses,
      });
    }
  }, [
    byokEnabled,
    conversationId,
    demoRemainingPasses,
    isAccountStateLoading,
    notify,
    demoTotalPasses,
  ]);

  const submitMessage = (): boolean => {
    if (isPending) {
      return false;
    }

    if (isByokProviderModelMismatch) {
      setError(byokProviderModelMismatchMessage);
      setIsAdvancedControlsOpen(true);
      return false;
    }

    if (isDemoLaneExhausted) {
      setError(
        byokEnabled
          ? "Demo passes are exhausted. Connect or switch to BYOK to continue."
          : "Demo passes are exhausted for this account.",
      );
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

    emitOptimisticUserMessage({
      conversationId,
      branchId,
      messageId: optimisticId,
      content,
      createdAt: new Date().toISOString(),
    });

    startTransition(async () => {
      try {
        const streamId =
          typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `stream-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        emitStartStreaming({ conversationId, branchId, streamId });
        const result = await sendMessage({
          conversationId,
          branchId,
          content,
          streamId,
          lane: selectedLane,
          tools: selectedTools,
          attachmentIds: readyAttachmentIds,
        });
        setValue("");
        setAttachments([]);
        if (result.quota.remainingDemoPasses !== null) {
          setAccountState((previous) => {
            if (!previous) {
              return previous;
            }
            const nextRemaining = Math.max(0, result.quota.remainingDemoPasses ?? 0);
            const nextUsed = Math.max(
              0,
              previous.quota.total - nextRemaining - previous.quota.reserved,
            );
            return {
              ...previous,
              quota: {
                ...previous.quota,
                used: nextUsed,
                remaining: nextRemaining,
              },
            };
          });
        }

        const branchCount = Object.keys(result.snapshot.branches).length;
        const rootBranch =
          result.snapshot.branches[result.snapshot.conversation.rootBranchId];
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
        emitOptimisticMessageClear({
          conversationId,
          branchId,
          messageId: optimisticId,
          reason: "failed",
        });
        console.error("[Composer] sendMessage failed", cause);
        const errorMessage = extractErrorMessage(cause);
        const demoCapReached =
          errorMessage.includes("Demo pass limit reached") ||
          errorMessage.includes("quota-exhausted");
        if (demoCapReached) {
          setAccountState((previous) =>
            previous
              ? {
                  ...previous,
                  quota: {
                    ...previous.quota,
                    remaining: 0,
                  },
                }
              : previous,
          );
          if (byokConnected) {
            setError(
              "Demo passes are exhausted. Switch to BYOK lane to keep chatting.",
            );
          } else if (byokEnabled) {
            setByokProvider(getProviderForModel(conversationModel));
            setIsByokPanelOpen(true);
            setError(
              "Demo passes are exhausted. Connect a BYOK key below, then switch to the BYOK lane to continue.",
            );
          } else {
            setError(
              byokUnavailableReason ||
                "Demo passes are exhausted and BYOK is disabled in this environment.",
            );
          }
          return;
        }
        setError(errorMessage || "We couldn't send that message. Please try again.");
      }
    });
    return true;
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
    <div className={cn("flex w-full flex-col gap-2 text-background", className)}>
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
            className="rounded-xl border border-background/30 bg-background/10 px-3 py-1.5"
            title={`From parent selection: “${branchContextLabel}”`}
          >
            <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-background/70">
              From parent selection
            </p>
            <p className="mt-0.5 truncate text-[11px] font-semibold text-background">
              “{branchContextLabel}”
            </p>
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <button
          type="button"
          onClick={() => setIsAdvancedControlsOpen((previous) => !previous)}
          className="interactive-target inline-flex items-center gap-2 rounded-full border border-background/35 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-background hover:bg-background/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          aria-expanded={isAdvancedControlsOpen}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{isAdvancedControlsOpen ? "Hide Controls" : "Show Controls"}</span>
        </button>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="inline-flex items-center rounded-full border border-background/35 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-background/85">
            {`Mode ${currentPresetLabel}`}
          </span>
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em]",
              quotaChipClassName,
            )}
          >
            {quotaChipText}
          </span>
        </div>
      </div>
      {isAdvancedControlsOpen ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-background/20 bg-foreground/90 px-3 py-2">
          <div
            role="group"
            aria-label="Message lane"
            className="inline-flex items-center rounded-full border border-background/30 bg-foreground/95 p-0.5 text-background"
          >
            <button
              type="button"
              onClick={() => setSelectedLane("demo")}
              aria-pressed={selectedLane === "demo"}
              className={cn(
                "interactive-target rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                selectedLane === "demo"
                  ? "bg-background text-foreground"
                  : "text-background/75 hover:text-background",
              )}
            >
              Demo
            </button>
            <button
              type="button"
              onClick={() => setSelectedLane("byok")}
              aria-pressed={selectedLane === "byok"}
              disabled={!byokEnabled || !byokConnected}
              className={cn(
                "interactive-target rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
                selectedLane === "byok"
                  ? "bg-background text-foreground"
                  : "text-background/75 hover:text-background",
              )}
            >
              BYOK
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              if (!byokEnabled) {
                setError(
                  byokUnavailableReason ||
                    "BYOK is disabled for this environment.",
                );
                return;
              }
              setIsByokPanelOpen(true);
            }}
            disabled={!byokEnabled}
            className="interactive-target inline-flex items-center rounded-full border border-background/35 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-background hover:bg-background/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {!byokEnabled
              ? "BYOK Disabled"
              : byokConnected
                ? "Manage BYOK"
                : "Connect BYOK"}
          </button>
        </div>
      ) : null}
      {isBrowser && isByokPanelOpen
        ? createPortal(
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
              role="dialog"
              aria-modal="true"
            >
              <div className="mx-4 w-full max-w-3xl rounded-2xl border border-border/70 bg-card p-6 shadow-2xl">
                <div className="flex flex-wrap items-end gap-2">
                  <div className="flex flex-col gap-1">
                    <label
                      htmlFor={byokProviderId}
                      className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground"
                    >
                      Provider
                    </label>
                    <select
                      id={byokProviderId}
                      value={byokProvider}
                      onChange={(event) =>
                        setByokProvider(event.target.value as ComposerByokProvider)
                      }
                      disabled={isByokSaving || !byokEnabled}
                      className="h-8 rounded-full border border-border/70 bg-background px-3 text-xs text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <option value="openai">OpenAI</option>
                      <option value="openrouter">OpenRouter</option>
                    </select>
                  </div>
                  <div className="flex min-w-[220px] flex-1 flex-col gap-1">
                    <label
                      htmlFor={byokApiKeyId}
                      className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground"
                    >
                      API key
                    </label>
                    <input
                      id={byokApiKeyId}
                      type="password"
                      value={byokApiKey}
                      onChange={(event) => setByokApiKey(event.target.value)}
                      placeholder="sk-..."
                      disabled={isByokSaving || !byokEnabled}
                      autoComplete="off"
                      className="h-8 rounded-full border border-border/70 bg-background px-3 text-xs text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleSaveByokKey()}
                    disabled={isByokSaving || !byokEnabled}
                    className="interactive-target inline-flex h-8 items-center rounded-full border border-border/70 bg-background px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {!byokEnabled
                      ? "Unavailable"
                      : isByokSaving
                        ? "Saving..."
                        : byokConnected
                          ? "Update key"
                          : "Connect"}
                  </button>
                  {byokConnected ? (
                    <button
                      type="button"
                      onClick={() => void handleDeleteByokKey()}
                      disabled={isByokSaving}
                      className="interactive-target inline-flex h-8 items-center rounded-full border border-border/70 bg-background px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Disconnect
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setIsByokPanelOpen(false)}
                    className="interactive-target inline-flex h-8 items-center rounded-full border border-border/70 bg-background px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    Close
                  </button>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {!byokEnabled
                    ? byokUnavailableReason ||
                      "BYOK is disabled for this environment."
                    : byokConnected
                    ? `Connected to ${byokProviderLabel}${accountState?.byok.updatedAt ? ` · updated ${accountState.byok.updatedAt}` : ""}.${byokProviderModelHint ? ` ${byokProviderModelHint}` : ""}`
                    : "Connect your API key, then switch lanes to BYOK for unlimited sends via your key."}
                </p>
              </div>
            </div>,
            document.body,
          )
        : null}
      {isDemoLaneExhausted ? (
        <div className="rounded-2xl border border-destructive/50 bg-destructive/10 px-3 py-2 text-foreground">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-destructive">
            Free passes exhausted
          </p>
          <p className="mt-1 text-xs text-foreground/90">
            {`You have used all ${demoTotalPasses} demo passes.`}
            {byokEnabled
              ? " Connect your API key and switch to BYOK lane to continue."
              : " BYOK is unavailable in this environment."}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (!byokEnabled) {
                  setError(
                    byokUnavailableReason ||
                      "BYOK is disabled for this environment.",
                  );
                  return;
                }
                setIsByokPanelOpen(true);
              }}
              disabled={!byokEnabled}
              className="interactive-target inline-flex items-center rounded-full border border-destructive/50 bg-background px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60"
            >
              {byokConnected ? "Manage BYOK key" : "Connect API key"}
            </button>
            {byokConnected ? (
              <button
                type="button"
                onClick={() => setSelectedLane("byok")}
                className="interactive-target inline-flex items-center rounded-full border border-border/70 bg-background px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                Switch to BYOK lane
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {(hasSelectedTools || attachments.length > 0) ? (
        <div className="rounded-2xl border border-background/20 bg-background/95 px-3 py-2 text-foreground shadow-sm">
          {hasSelectedTools ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {activeToolOptions.map((option) => (
                  <span
                    key={`composer-selected-tool-${option.id}`}
                    className="interactive-target state-selected inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-primary-foreground"
                  >
                    <option.icon className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{option.label}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveTool(option.id)}
                    className="interactive-target inline-flex h-4 w-4 items-center justify-center rounded-full border border-transparent text-primary-foreground/75 hover:bg-primary/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                      aria-label={`Remove ${option.label}`}
                    >
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </div>
              <button
                type="button"
                onClick={handleClearTool}
                className="interactive-target inline-flex items-center gap-1 rounded-full border border-border/60 bg-background px-2 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-55"
                disabled={!hasSelectedTools}
              >
                <X className="h-3 w-3" aria-hidden="true" />
                <span>Clear</span>
              </button>
            </div>
          ) : null}
          {(attachments.length > 0 || (fileUploadSelected && canAddMoreAttachments)) ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
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
                    className="flex items-center gap-2 rounded-full border border-border/60 bg-background/95 px-3 py-1 text-[11px] shadow-sm"
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
                  className="interactive-target inline-flex items-center gap-2 rounded-full border border-dashed border-primary/60 px-3 py-1 text-[11px] font-medium text-primary hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Add files</span>
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      <form
        onSubmit={handleSubmit}
        className="flex h-12 items-center gap-2 rounded-full border border-background/25 bg-foreground/95 px-3 text-background shadow-lg"
      >
        <div className="flex items-center gap-2">
          <div className="relative" ref={toolMenuRef}>
            <button
              type="button"
              className="interactive-target inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-background/35 bg-foreground text-background hover:bg-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              aria-label="New prompt options"
              aria-expanded={isToolMenuOpen}
              aria-controls={isToolMenuOpen ? toolMenuId : undefined}
              aria-haspopup="menu"
              onClick={() => setIsToolMenuOpen((prev) => !prev)}
            >
              <Plus className="h-5 w-5 text-background" aria-hidden="true" />
            </button>

            {isToolMenuOpen ? (
            <div
              id={toolMenuId}
              role="menu"
              className="absolute left-0 bottom-full z-20 mb-2 w-56 rounded-xl border border-border/80 bg-popover/95 p-1 shadow-xl backdrop-blur-[2px]"
            >
              {TOOL_OPTIONS.map((option) => {
                const isSelected = selectedTools.includes(option.id);
                const isDisabled = option.id === "web-search" && !webSearchSupported;
                const optionDescription =
                  option.id === "web-search" && !webSearchSupported
                    ? "Requires Fast chat or GPT-5 Mini"
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
                        setError("Web search is unavailable for this model. Switch to Fast chat or GPT-5 Mini.");
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

        </div>

        <div className="relative flex flex-1 items-center">
          <label htmlFor="conversation-composer" className="sr-only">
            Message
          </label>
          <textarea
            id="conversation-composer"
            ref={textareaRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Ask Connexus to explore a new direction..."
            rows={1}
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
            className="w-full resize-none border-none bg-transparent px-0 text-sm leading-tight text-background caret-background placeholder:text-background/60 focus:outline-none disabled:cursor-not-allowed disabled:opacity-70"
            disabled={isPending}
            aria-disabled={isPending}
            aria-invalid={error ? true : undefined}
            style={{ height: BASE_TEXTAREA_HEIGHT }}
          />
          <button
            type="button"
            onClick={() => {
              setIsComposerModalOpen(true);
            }}
            className="absolute bottom-1 right-2 inline-flex h-3 w-3 items-center justify-center rounded-full border border-background/35 bg-foreground text-background transition hover:bg-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            aria-label="Open large editor"
          >
            <Maximize className="h-2 w-2" aria-hidden="true" />
          </button>
        </div>

        {isAdvancedControlsOpen ? (
          <div className="relative flex items-center gap-2">
            <button
              type="button"
              ref={modelButtonRef}
              onClick={() => setIsModelMenuOpen((value) => !value)}
              className={cn(
                "interactive-target inline-flex h-9 items-center gap-1 border border-background/35 bg-foreground px-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-background hover:bg-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-55",
                isModelMenuOpen ? "bg-foreground/80 text-background" : null,
              )}
              aria-haspopup="menu"
              aria-expanded={isModelMenuOpen}
              aria-controls={isModelMenuOpen ? modelMenuId : undefined}
              disabled={conversationSettingsSaving}
            >
              <span className="text-xs font-semibold text-background">
                {currentModelLabel}
              </span>
              <ChevronDown
                className={cn(
                  "h-3 w-3 text-background transition-transform",
                  isModelMenuOpen ? "rotate-180 text-primary" : "rotate-0",
                )}
                aria-hidden="true"
              />
            </button>
            <div className="flex flex-col items-end justify-center">
              {conversationSettingsSaving ? (
                <span className="text-[10px] uppercase tracking-[0.24em] text-background/60">
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
                className="absolute bottom-full right-0 z-30 mb-2 max-h-96 w-72 overflow-y-auto rounded-xl border border-border/80 bg-popover/95 p-2 shadow-xl backdrop-blur-[2px]"
              >
              <button
                type="button"
                role="menuitemradio"
                aria-checked={!isReasoningModel}
                onClick={() => {
                  void handleModelSelection("gpt-5-chat-latest", null);
                }}
                disabled={conversationSettingsSaving}
                className={cn(
                  "interactive-target flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
                  !isReasoningModel ? "state-selected font-semibold text-primary-foreground" : "hover:bg-muted/70",
                )}
              >
                <span className="font-medium">Fast chat</span>
                <span className={modelBadgeClassName} aria-hidden="true">
                  {modelEmojis.fast}
                </span>
              </button>

              <div className="my-2 border-t border-border/60" aria-hidden="true" />
              <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Reasoning models
              </div>

              {reasoningOptions.map((option) => {
                const isSelected = isReasoningModel && currentReasoningEffort === option;
                return (
                  <button
                    key={`composer-reasoning-${option}`}
                    type="button"
                    role="menuitemradio"
                    aria-checked={isSelected}
                    onClick={() => {
                      void handleModelSelection("gpt-5-mini", option);
                    }}
                    disabled={conversationSettingsSaving}
                    className={cn(
                      "interactive-target flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
                      isSelected ? "state-selected font-semibold text-primary-foreground" : "hover:bg-muted/70",
                    )}
                  >
                    <span className="font-medium">{`Reasoning · ${effortLabels[option]}`}</span>
                    <span className={modelBadgeClassName} aria-hidden="true">
                      {modelEmojis[option]}
                    </span>
                  </button>
                );
              })}

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
            className="hidden text-[10px] font-medium uppercase tracking-[0.16em] text-background/65 md:inline-flex"
            aria-live="polite"
          >
            {sendDisabledReason}
          </span>
        ) : null}

        <button
          type="submit"
          disabled={isSendDisabled}
          className={cn(
            "interactive-target inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-background/35 bg-foreground text-background hover:bg-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-55",
            isPending ? "animate-pulse" : "",
          )}
          aria-label="Send message"
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <SendHorizontal className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </form>

      {isBrowser && isComposerModalOpen
        ? createPortal(
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
              role="dialog"
              aria-modal="true"
            >
              <div className="mx-4 w-full max-w-3xl rounded-2xl border border-border/70 bg-card p-6 shadow-2xl">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-foreground">
                    Expanded Composer
                  </h2>
                  <button
                    type="button"
                    onClick={() => setIsComposerModalOpen(false)}
                    className="interactive-target inline-flex h-7 w-7 items-center justify-center rounded-full border border-border/60 text-muted-foreground transition hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
                  className="h-64 w-full resize-none rounded-xl border border-border/80 bg-background px-4 py-3 text-base text-foreground shadow-inner focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setIsComposerModalOpen(false)}
                    className="interactive-target inline-flex items-center gap-2 rounded-full border border-border/70 bg-background px-4 py-2 text-sm font-medium text-foreground transition hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
        <span
          className="truncate text-[11px] font-semibold uppercase tracking-[0.16em] text-background/75"
          title={currentModelLabel}
        >
          {`Model ${currentModelLabel}`}
        </span>
        {error ? (
          <p className="text-right text-xs text-destructive" role="status">
            {error}
          </p>
        ) : sendDisabledReason ? (
          <span className="text-right text-xs text-background/75">
            {sendDisabledReason}
          </span>
        ) : (
          <span className="text-right text-xs text-background/70">
            {quotaIndicatorText} · Enter to send · Shift+Enter for line break
          </span>
        )}
      </div>
      <p
        className="sr-only"
        role="status"
        aria-live={isDemoLaneExhausted ? "assertive" : "polite"}
      >
        {quotaIndicatorText}
      </p>
    </div>
  );
}
