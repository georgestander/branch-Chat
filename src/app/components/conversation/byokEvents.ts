"use client";

export const BYOK_STATUS_CHANGED_EVENT = "connexus:byok:status-changed";

export type ByokStatusChangedDetail = {
  provider: "openai" | "openrouter" | null;
  connected: boolean;
  updatedAt: string | null;
  source: "composer" | "sidebar";
};

export function emitByokStatusChanged(detail: ByokStatusChangedDetail): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<ByokStatusChangedDetail>(BYOK_STATUS_CHANGED_EVENT, {
      detail,
    }),
  );
}
