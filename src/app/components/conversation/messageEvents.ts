"use client";

import { useEffect } from "react";
import type {
  MessageAttachment,
  ToolInvocation,
} from "@/lib/conversation";

export const OPTIMISTIC_MESSAGE_EVENT = "connexus:message:optimistic";
export const CLEAR_OPTIMISTIC_MESSAGE_EVENT =
  "connexus:message:optimistic:clear";
export const PERSISTED_MESSAGES_EVENT = "connexus:message:persisted";

export interface OptimisticMessageDetail {
  conversationId: string;
  branchId: string;
  messageId: string;
  content: string;
  createdAt: string;
}

export interface ClearOptimisticMessageDetail {
  conversationId: string;
  branchId: string;
  messageId: string;
  reason: "resolved" | "failed";
  replacementMessageId?: string | null;
}

export interface PersistedBranchMessage {
  id: string;
  branchId: string;
  role: "user" | "assistant";
  content: string;
  renderedHtml?: string | null;
  createdAt: string;
  tokenUsage?: {
    prompt: number;
    completion: number;
    cost: number;
  } | null;
  attachments?: MessageAttachment[] | null;
  toolInvocations?: ToolInvocation[] | null;
}

export interface PersistedMessagesDetail {
  conversationId: string;
  branchId: string;
  messages: PersistedBranchMessage[];
}

export function emitOptimisticUserMessage(detail: OptimisticMessageDetail) {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<OptimisticMessageDetail>(OPTIMISTIC_MESSAGE_EVENT, {
      detail,
    }),
  );
}

export function emitOptimisticMessageClear(
  detail: ClearOptimisticMessageDetail,
) {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<ClearOptimisticMessageDetail>(
      CLEAR_OPTIMISTIC_MESSAGE_EVENT,
      {
        detail,
      },
    ),
  );
}

export function emitPersistedMessages(detail: PersistedMessagesDetail) {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<PersistedMessagesDetail>(PERSISTED_MESSAGES_EVENT, {
      detail,
    }),
  );
}

export function useOptimisticMessageEvents({
  conversationId,
  branchId,
  onAppend,
  onClear,
}: {
  conversationId: string;
  branchId: string;
  onAppend: (detail: OptimisticMessageDetail) => void;
  onClear?: (detail: ClearOptimisticMessageDetail) => void;
}) {
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleAppend = (event: Event) => {
      const custom = event as CustomEvent<OptimisticMessageDetail>;
      const detail = custom.detail;
      if (!detail) {
        return;
      }
      if (
        detail.conversationId !== conversationId ||
        detail.branchId !== branchId
      ) {
        return;
      }
      onAppend(detail);
    };

    const handleClear = (event: Event) => {
      if (!onClear) {
        return;
      }
      const custom = event as CustomEvent<ClearOptimisticMessageDetail>;
      const detail = custom.detail;
      if (!detail) {
        return;
      }
      if (
        detail.conversationId !== conversationId ||
        detail.branchId !== branchId
      ) {
        return;
      }
      onClear(detail);
    };

    window.addEventListener(OPTIMISTIC_MESSAGE_EVENT, handleAppend as EventListener);
    if (onClear) {
      window.addEventListener(
        CLEAR_OPTIMISTIC_MESSAGE_EVENT,
        handleClear as EventListener,
      );
    }

    return () => {
      window.removeEventListener(
        OPTIMISTIC_MESSAGE_EVENT,
        handleAppend as EventListener,
      );
      if (onClear) {
        window.removeEventListener(
          CLEAR_OPTIMISTIC_MESSAGE_EVENT,
          handleClear as EventListener,
        );
      }
    };
  }, [branchId, conversationId, onAppend, onClear]);
}
