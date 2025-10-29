"use client";

export const START_STREAMING_EVENT = "connexus:stream:start";
export const COMPLETE_STREAMING_EVENT = "connexus:stream:complete";

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

export function emitStartStreaming(detail: StartStreamingDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(START_STREAMING_EVENT, { detail }));
}

export function emitCompleteStreaming(detail: CompleteStreamingDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(COMPLETE_STREAMING_EVENT, { detail }));
}

