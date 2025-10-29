"use client";

import { useEffect } from "react";

export const OPTIMISTIC_MESSAGE_EVENT = "connexus:message:optimistic";
export const CLEAR_OPTIMISTIC_MESSAGE_EVENT =
  "connexus:message:optimistic:clear";

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
