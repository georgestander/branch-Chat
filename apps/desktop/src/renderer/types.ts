import type {
  BranchId,
  ConversationGraphSnapshot,
  Message,
  ToolInvocation,
} from "@branchy/conversation-core";
import type { RenderedMessage } from "@branchy/conversation-core/presentation";

export type DirectoryConversation = {
  id: string;
  title: string;
  preview: string | null;
  updatedAt: string;
  archivedAt: string | null;
};

export type AccountState = {
  status: "signed_out" | "signing_in" | "signed_in" | "error";
  email: string | null;
  plan: string | null;
  error: string | null;
  login?: {
    loginId: string;
    verificationUrl: string;
    userCode: string;
    expiresAt: string | null;
  } | null;
};

export type ReadyWorkspace = {
  conversationId: string;
  title: string;
  snapshot: ConversationGraphSnapshot;
  activeBranchId: BranchId;
  messagesByBranch: Record<BranchId, RenderedMessage[]>;
  conversations: DirectoryConversation[];
  account: AccountState;
};

export type AttachmentDraft = {
  id: string;
  name: string;
  contentType: string;
  size: number;
  status: "uploading" | "ready" | "error";
  error: string | null;
};

export type BranchSelectionDraft = {
  parentBranchId: string;
  messageId: string;
  excerpt: string;
  span: { start: number; end: number } | null;
};

export type StreamStatus =
  | "starting"
  | "streaming"
  | "generating_image"
  | "saving_image"
  | "complete"
  | "cancelled"
  | "error";

export type StreamState = {
  streamId: string;
  branchId: BranchId;
  assistantMessageId?: string | null;
  status: StreamStatus;
  text: string;
  reasoningSummary: string | null;
  toolProgress: string | null;
  imageId: string | null;
  imageUrl: string | null;
  error: string | null;
};

export type RendererStreamEvent =
  | { type: "opened" | "start" }
  | { type: "delta"; delta?: string; text?: string }
  | { type: "reasoning_summary"; summary?: string; text?: string }
  | {
      type: "tool_progress";
      label?: string;
      message?: string;
      toolType?: string;
      status?: string;
    }
  | {
      type: "image_ready";
      imageId?: string;
      url?: string;
      imageUrl?: string;
    }
  | {
      type: "complete";
      message?: Message | RenderedMessage;
      assistantMessage?: Message | RenderedMessage;
    }
  | { type: "cancelled" }
  | { type: "error"; message?: string; error?: string };

export type GeneratedImageView = {
  id: string;
  url: string | null;
  prompt: string | null;
  status: "pending" | "running" | "succeeded" | "failed";
  error: string | null;
};

export function generatedImageDisplayState(
  status: GeneratedImageView["status"],
  source: string | null,
): "running" | "resolving" | "ready" | "failed" {
  if (status === "pending" || status === "running") return "running";
  if (status !== "succeeded" || source === "__unavailable__") return "failed";
  if (!source || source === "__loading__") return "resolving";
  return "ready";
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstString(
  value: Record<string, unknown> | null,
  keys: string[],
): string | null {
  for (const key of keys) {
    const candidate = value?.[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

export function generatedImagesForMessage(
  message: Pick<Message, "toolInvocations">,
): GeneratedImageView[] {
  return (message.toolInvocations ?? [])
    .filter((invocation) => invocation.toolType === "image_generation")
    .map((invocation) => {
      const input = record(invocation.input);
      const output = record(invocation.output);
      return {
        id:
          firstString(output, ["imageId", "id", "assetId"]) ??
          invocation.id,
        url: firstString(output, ["url", "imageUrl", "assetUrl"]),
        prompt:
          firstString(input, ["revisedPrompt", "prompt"]) ??
          firstString(output, ["revisedPrompt", "prompt"]),
        status: invocation.status,
        error: invocation.error?.message?.trim() || null,
      };
    });
}

export function hasRunningImage(
  message: Pick<Message, "toolInvocations">,
): boolean {
  return generatedImagesForMessage(message).some(
    (image) => image.status === "pending" || image.status === "running",
  );
}

export function toolLabel(invocation: ToolInvocation): string {
  if (invocation.toolName?.trim()) return invocation.toolName.trim();
  return invocation.toolType
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
