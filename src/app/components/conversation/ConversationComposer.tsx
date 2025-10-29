"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from "react";
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
  Upload,
  X,
} from "lucide-react";

import {
  createAttachmentUploadAction,
  finalizeAttachmentUploadAction,
  getConversationSummary,
  removeAttachmentUploadAction,
  sendMessage,
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
} from "@/app/components/conversation/messageEvents";
import { emitStartStreaming } from "@/app/components/conversation/streamingEvents";
import type { ConversationComposerTool } from "@/lib/conversation/tools";
import { useToast } from "@/app/components/ui/Toast";

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

interface ConversationComposerProps {
  branchId: string;
  conversationId: string;
  autoFocus?: boolean;
  className?: string;
  conversationModel: string;
  reasoningEffort: "low" | "medium" | "high" | null;
  onConversationSettingsChange: (
    model: string,
    effort: "low" | "medium" | "high" | null,
  ) => Promise<boolean>;
  conversationSettingsSaving: boolean;
  conversationSettingsError: string | null;
  onClearConversationSettingsError: () => void;
}

export function ConversationComposer({
  branchId,
  conversationId,
  autoFocus = false,
  className,
  conversationModel,
  reasoningEffort,
  onConversationSettingsChange,
  conversationSettingsSaving,
  conversationSettingsError,
  onClearConversationSettingsError,
}: ConversationComposerProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [selectedTools, setSelectedTools] = useState<ConversationComposerTool[]>(
    [],
  );
  const [isToolMenuOpen, setIsToolMenuOpen] = useState(false);
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingRefreshTimers = useRef<number[]>([]);
  const toolMenuRef = useRef<HTMLDivElement | null>(null);
  const toolMenuId = useId();
  const modelMenuId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const attachmentsRef = useRef<ComposerAttachment[]>([]);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const modelButtonRef = useRef<HTMLButtonElement | null>(null);
  const { notify } = useToast();
  const reasoningOptions: Array<"low" | "medium" | "high"> = [
    "low",
    "medium",
    "high",
  ];
  const effortLabels: Record<"low" | "medium" | "high", string> = {
    low: "Low",
    medium: "Medium",
    high: "High",
  };
  const currentReasoningEffort = (reasoningEffort ?? "low") as "low" | "medium" | "high";
  const isReasoningModel = !conversationModel.includes("chat");
  const currentModelLabel = isReasoningModel
    ? `Reasoning · ${effortLabels[currentReasoningEffort]}`
    : "Fast chat";

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
    const node = textareaRef.current;
    if (!node) {
      return;
    }

    node.style.height = "auto";
    const next = Math.min(node.scrollHeight, 160);
    node.style.height = `${next}px`;
  }, [value]);

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
      if (attachments.length === 0 && hasFileUpload) {
        return previous.filter((value) => value !== "file-upload");
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

  const handleToolSelect = useCallback(
    (tool: ToolOption["id"]) => {
      setSelectedTools((previous) => {
        if (tool === "file-upload") {
          if (attachmentsRef.current.length >= UPLOAD_MAX_ATTACHMENTS) {
            setError(
              `You can upload up to ${UPLOAD_MAX_ATTACHMENTS} files per message.`,
            );
            return previous.includes(tool) ? previous : previous;
          }
          const next = previous.includes(tool) ? previous : [...previous, tool];
          setIsToolMenuOpen(false);
          openFilePicker();
          return next;
        }

        if (previous.includes(tool)) {
          return previous.filter((value) => value !== tool);
        }
        return [...previous, tool];
      });

      if (tool !== "file-upload") {
        setIsToolMenuOpen(false);
      }
    },
    [openFilePicker],
  );

  const handleClearTool = useCallback(() => {
    setSelectedTools([]);
    void clearAllAttachments();
  }, [clearAllAttachments]);

  const handleModelSelection = useCallback(
    async (
      nextModel: string,
      nextEffort: "low" | "medium" | "high" | null,
    ) => {
      const success = await onConversationSettingsChange(nextModel, nextEffort);
      if (success) {
        setIsModelMenuOpen(false);
        if (!nextModel.includes("chat")) {
          const effortLabel = effortLabels[(nextEffort ?? "low") as "low" | "medium" | "high"];
          notify({
            variant: "warning",
            title: "Deep reasoning is slower",
            description: `Responses may take longer (${effortLabel} effort). Switch back to Fast chat for lower latency.`,
          });
        }
      }
    },
    [notify, onConversationSettingsChange],
  );

  const activeToolOptions = TOOL_OPTIONS.filter((option) =>
    selectedTools.includes(option.id),
  );
  const MAX_VISIBLE_TOOL_ICONS = 3;
  const visibleToolOptions = activeToolOptions.slice(0, MAX_VISIBLE_TOOL_ICONS);
  const overflowCount = activeToolOptions.length - visibleToolOptions.length;
  const hasSelectedTools = activeToolOptions.length > 0;
  const hasPendingAttachments = attachments.some(
    (attachment) => attachment.status === "pending" || attachment.status === "uploading",
  );
  const hasErroredAttachments = attachments.some(
    (attachment) => attachment.status === "error",
  );
  const canAddMoreAttachments = attachments.length < UPLOAD_MAX_ATTACHMENTS;
  const isSendDisabled = isPending || hasPendingAttachments || hasErroredAttachments;

  const submitMessage = () => {
    if (isPending) {
      return;
    }

    if (
      attachments.some(
        (attachment) =>
          attachment.status === "pending" || attachment.status === "uploading",
      )
    ) {
      setError("Please wait for files to finish uploading before sending.");
      return;
    }

    if (attachments.some((attachment) => attachment.status === "error")) {
      setError("Remove or retry failed uploads before sending.");
      return;
    }

    const content = value.trim();
    if (!content) {
      setError("Enter a message before sending.");
      return;
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
          tools: selectedTools,
          attachmentIds: readyAttachmentIds,
        });
        setValue("");
        setAttachments([]);

        const branchCount = Object.keys(result.snapshot.branches).length;
        const rootBranch =
          result.snapshot.branches[result.snapshot.conversation.rootBranchId];
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
        setError("We couldn't send that message. Please try again.");
      }
    });
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitMessage();
  };

  return (
    <div className={cn("mx-auto flex w-full max-w-3xl flex-col gap-2", className)}>
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
      <form
        onSubmit={handleSubmit}
        className="flex items-end gap-3 rounded-full border border-border/70 bg-card/95 px-1 py-2"
      >
        <div className="relative" ref={toolMenuRef}>
          <button
            type="button"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-background"
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
              className="absolute left-0 bottom-full z-20 mb-2 w-56 rounded-xl border border-border/70 bg-popover p-1 shadow-lg"
            >
              {TOOL_OPTIONS.map((option) => {
                const isSelected = selectedTools.includes(option.id);
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={isSelected}
                    onClick={() => handleToolSelect(option.id)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      isSelected
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-muted/60",
                    )}
                  >
                    <span
                      className={cn(
                        "inline-flex h-7 w-7 items-center justify-center rounded-full border border-transparent",
                        isSelected
                          ? "bg-primary/20 text-primary"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {isSelected ? (
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <option.icon className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                    </span>
                    <span className="flex-1">
                      <span className="block font-medium">{option.label}</span>
                      {option.description ? (
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {option.description}
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
                  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  hasSelectedTools
                    ? "hover:bg-muted/60"
                    : "cursor-default text-muted-foreground",
                )}
              >
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                <span className="flex-1 font-medium">Clear selection</span>
              </button>
            </div>
          ) : null}
        </div>

        <div className="inline-flex h-10 w-14 shrink-0 items-center justify-center">
          {hasSelectedTools ? (
            <div className="flex items-center gap-1">
              <div className="flex -space-x-2">
                {visibleToolOptions.map((option) => (
                  <span
                    key={`composer-tool-${option.id}`}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-primary/40 bg-primary/15 text-primary"
                    aria-label={`${option.label} tool selected`}
                  >
                    <option.icon className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                ))}
              </div>
              {overflowCount > 0 ? (
                <span className="inline-flex h-6 items-center justify-center rounded-full bg-primary/20 px-2 text-[10px] font-semibold uppercase tracking-wide text-primary">
                  +{overflowCount}
                </span>
              ) : null}
            </div>
          ) : (
            <span className="inline-flex h-6 w-6 items-center justify-center opacity-0">
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-2">
          {attachments.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              {attachments.map((attachment) => {
                const statusIcon = (() => {
                  if (attachment.status === "ready") {
                    return <Paperclip className="h-4 w-4 text-primary" aria-hidden="true" />;
                  }
                  if (attachment.status === "error") {
                    return <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden="true" />;
                  }
                  return <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />;
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
                    className="flex items-center gap-2 rounded-full border border-border/70 bg-card/90 px-3 py-1 text-xs"
                  >
                    <span className="inline-flex h-5 w-5 items-center justify-center">
                      {statusIcon}
                    </span>
                    <div className="flex max-w-[160px] flex-col">
                      <span className="truncate font-medium text-foreground">
                        {attachment.name}
                      </span>
                      <span className="text-[11px] text-muted-foreground">{subtitle}</span>
                      {attachment.status === "error" && attachment.error ? (
                        <span className="text-[11px] text-destructive">
                          {attachment.error}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1">
                      {attachment.status === "error" ? (
                        <button
                          type="button"
                          onClick={() => handleRetryAttachment(attachment.tempId)}
                          className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-transparent text-muted-foreground transition hover:text-foreground"
                          aria-label={`Retry ${attachment.name}`}
                        >
                          <RotateCcw className="h-3 w-3" aria-hidden="true" />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => handleRemoveAttachment(attachment.tempId)}
                        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-transparent text-muted-foreground transition hover:text-foreground"
                        aria-label={`Remove ${attachment.name}`}
                      >
                        <X className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                );
              })}
              {canAddMoreAttachments ? (
                <button
                  type="button"
                  onClick={openFilePicker}
                  className="inline-flex items-center gap-2 rounded-full border border-dashed border-primary/60 px-3 py-1 text-xs text-primary transition hover:bg-primary/10"
                >
                  <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Add files</span>
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="relative">
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
              className="w-full resize-none border-none bg-transparent px-0 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none disabled:cursor-not-allowed disabled:opacity-70"
              disabled={isPending}
              aria-disabled={isPending}
              aria-invalid={error ? true : undefined}
              style={{ maxHeight: 160 }}
            />
          </div>
        </div>

        <div className="relative flex flex-col items-end gap-1">
          <button
            type="button"
            ref={modelButtonRef}
            onClick={() => setIsModelMenuOpen((value) => !value)}
            className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-background px-2 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground transition hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-70"
            aria-haspopup="menu"
            aria-expanded={isModelMenuOpen}
            aria-controls={isModelMenuOpen ? modelMenuId : undefined}
            disabled={conversationSettingsSaving}
          >
            <span className="text-xs font-semibold text-foreground">
              {currentModelLabel}
            </span>
            <ChevronDown
              className={cn(
                "h-3 w-3 transition-transform text-muted-foreground",
                isModelMenuOpen ? "rotate-180" : "rotate-0",
              )}
              aria-hidden="true"
            />
          </button>
          {conversationSettingsSaving ? (
            <span className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
              Saving…
            </span>
          ) : conversationSettingsError ? (
            <span className="text-[10px] text-destructive">
              {conversationSettingsError}
            </span>
          ) : null}
          {isModelMenuOpen ? (
            <div
              ref={modelMenuRef}
              id={modelMenuId}
              role="menu"
              className="absolute bottom-full right-0 z-30 mb-2 w-64 rounded-xl border border-border/70 bg-popover p-2 shadow-lg"
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
                  "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  !isReasoningModel ? "bg-primary/10 text-primary" : "hover:bg-muted/60",
                )}
              >
                <span className="font-medium">Fast chat</span>
                {!isReasoningModel ? (
                  <Check className="h-4 w-4" aria-hidden="true" />
                ) : null}
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
                      void handleModelSelection("gpt-5-nano", option);
                    }}
                    disabled={conversationSettingsSaving}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      isSelected ? "bg-primary/10 text-primary" : "hover:bg-muted/60",
                    )}
                  >
                    <span className="font-medium">{`Reasoning · ${effortLabels[option]}`}</span>
                    {isSelected ? (
                      <Check className="h-4 w-4" aria-hidden="true" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        <button
          type="submit"
          disabled={isSendDisabled}
          className={cn(
            "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70",
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

      <div className="flex items-center justify-center px-2">
        {error ? (
          <p className="text-xs text-destructive" role="status">
            {error}
          </p>
        ) : (
          <span className="text-xs text-muted-foreground">
            Enter to send · Shift+Enter for line break
          </span>
        )}
      </div>
    </div>
  );
}
