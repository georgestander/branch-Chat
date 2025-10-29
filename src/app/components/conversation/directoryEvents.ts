"use client";

import { useEffect } from "react";

export const DIRECTORY_UPDATE_EVENT = "connexus:directory:update";

export interface DirectoryUpdateDetail {
  conversationId: string;
  title?: string;
  branchCount?: number;
  lastActiveAt?: string;
  archivedAt?: string | null;
}

export function emitDirectoryUpdate(detail: DirectoryUpdateDetail) {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<DirectoryUpdateDetail>(DIRECTORY_UPDATE_EVENT, {
      detail,
    }),
  );
}

export function useDirectoryUpdate(
  handler: (detail: DirectoryUpdateDetail) => void,
) {
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const listener = (event: Event) => {
      const custom = event as CustomEvent<DirectoryUpdateDetail>;
      if (!custom.detail) {
        return;
      }
      handler(custom.detail);
    };

    window.addEventListener(DIRECTORY_UPDATE_EVENT, listener);
    return () => {
      window.removeEventListener(DIRECTORY_UPDATE_EVENT, listener);
    };
  }, [handler]);
}
