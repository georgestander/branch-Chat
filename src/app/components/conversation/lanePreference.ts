export type ComposerLane = "demo" | "byok";

const GLOBAL_LANE_STORAGE_KEY = "connexus:composer:lane";
const LEGACY_CONVERSATION_LANE_STORAGE_PREFIX = "connexus:composer:lane:";
const LANE_CHANGED_EVENT = "connexus:composer:lane:changed";

function normalizeLane(value: unknown): ComposerLane | null {
  return value === "demo" || value === "byok" ? value : null;
}

function getLegacyConversationLaneStorageKey(conversationId: string): string {
  return `${LEGACY_CONVERSATION_LANE_STORAGE_PREFIX}${conversationId}`;
}

export function readComposerLanePreference(options?: {
  conversationId?: string;
}): ComposerLane | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const globalLane = normalizeLane(window.localStorage.getItem(GLOBAL_LANE_STORAGE_KEY));
    if (globalLane) {
      return globalLane;
    }
  } catch {
    // Best effort only.
  }

  const conversationId = options?.conversationId?.trim();
  if (!conversationId) {
    return null;
  }

  try {
    const legacyLane = normalizeLane(
      window.sessionStorage.getItem(getLegacyConversationLaneStorageKey(conversationId)),
    );
    return legacyLane;
  } catch {
    return null;
  }
}

export function writeComposerLanePreference(
  lane: ComposerLane,
  options?: { conversationId?: string },
): void {
  if (typeof window === "undefined") {
    return;
  }

  const normalizedLane = normalizeLane(lane);
  if (!normalizedLane) {
    return;
  }

  try {
    window.localStorage.setItem(GLOBAL_LANE_STORAGE_KEY, normalizedLane);
  } catch {
    // Best effort only.
  }

  const conversationId = options?.conversationId?.trim();
  if (conversationId) {
    try {
      window.sessionStorage.setItem(
        getLegacyConversationLaneStorageKey(conversationId),
        normalizedLane,
      );
    } catch {
      // Best effort only.
    }
  }

  window.dispatchEvent(
    new CustomEvent<{ lane: ComposerLane }>(LANE_CHANGED_EVENT, {
      detail: { lane: normalizedLane },
    }),
  );
}

export function subscribeComposerLanePreference(
  listener: (lane: ComposerLane) => void,
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleChange = (event: Event) => {
    const detail = (event as CustomEvent<{ lane?: unknown }>).detail;
    const lane = normalizeLane(detail?.lane);
    if (!lane) {
      return;
    }
    listener(lane);
  };

  window.addEventListener(LANE_CHANGED_EVENT, handleChange);
  return () => {
    window.removeEventListener(LANE_CHANGED_EVENT, handleChange);
  };
}
