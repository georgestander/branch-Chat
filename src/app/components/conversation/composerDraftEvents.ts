"use client";

export const COMPOSER_DRAFT_EVENT = "connexus:composer:draft";
const COMPOSER_DRAFT_STORAGE_PREFIX = "connexus:composer:draft:";

export type ComposerDraftDetail = {
  conversationId: string;
  branchId: string;
  content: string;
};

function composerDraftStorageKey(conversationId: string, branchId: string): string {
  return `${COMPOSER_DRAFT_STORAGE_PREFIX}${conversationId}:${branchId}`;
}

export function readComposerDraft(
  conversationId: string,
  branchId: string,
): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(
      composerDraftStorageKey(conversationId, branchId),
    );
  } catch {
    return null;
  }
}

export function clearComposerDraft(conversationId: string, branchId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(composerDraftStorageKey(conversationId, branchId));
  } catch {
    // Best effort only.
  }
}

export function emitComposerDraft(detail: ComposerDraftDetail): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      composerDraftStorageKey(detail.conversationId, detail.branchId),
      detail.content,
    );
  } catch {
    // The mounted composer can still receive the event.
  }
  window.dispatchEvent(new CustomEvent(COMPOSER_DRAFT_EVENT, { detail }));
}
