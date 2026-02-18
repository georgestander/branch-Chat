"use client";

export const START_STREAMING_EVENT = "connexus:stream:start";
export const COMPLETE_STREAMING_EVENT = "connexus:stream:complete";
const STREAM_STORAGE_PREFIX = "connexus:stream:active:";

export type StartStreamingDetail = {
  conversationId: string;
  branchId: string;
  streamId: string;
};

export type CompleteStreamingDetail = {
  conversationId: string;
  branchId: string;
  streamId: string;
};

function getStreamStorageKey(conversationId: string, branchId: string): string {
  return `${STREAM_STORAGE_PREFIX}${conversationId}:${branchId}`;
}

export function readActiveStreamId(
  conversationId: string,
  branchId: string,
): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const stored = window.sessionStorage.getItem(
      getStreamStorageKey(conversationId, branchId),
    );
    return stored && stored.trim().length > 0 ? stored : null;
  } catch {
    return null;
  }
}

export function writeActiveStreamId(detail: StartStreamingDetail): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.setItem(
      getStreamStorageKey(detail.conversationId, detail.branchId),
      detail.streamId,
    );
  } catch {
    // Best effort only.
  }
}

export function clearActiveStreamId(options: {
  conversationId: string;
  branchId: string;
}): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.removeItem(
      getStreamStorageKey(options.conversationId, options.branchId),
    );
  } catch {
    // Best effort only.
  }
}

export function emitStartStreaming(detail: StartStreamingDetail) {
  if (typeof window === "undefined") return;
  writeActiveStreamId(detail);
  window.dispatchEvent(new CustomEvent(START_STREAMING_EVENT, { detail }));
}

export function emitCompleteStreaming(detail: CompleteStreamingDetail) {
  if (typeof window === "undefined") return;
  clearActiveStreamId({
    conversationId: detail.conversationId,
    branchId: detail.branchId,
  });
  window.dispatchEvent(new CustomEvent(COMPLETE_STREAMING_EVENT, { detail }));
}
