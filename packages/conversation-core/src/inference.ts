import type {
  BranchId,
  ConversationGraphSnapshot,
  ConversationSettings,
} from "./model.ts";

export type CodexInferenceTarget =
  | { mode: "resume"; threadId: string }
  | { mode: "fork"; threadId: string; turnId: string }
  | { mode: "rebuild" };

/**
 * Resolve the fastest safe Codex context path without making provider state
 * canonical. Existing branches resume their own thread. A brand-new child can
 * fork the exact source assistant turn. Legacy or repaired state rebuilds from
 * the canonical Branchy lineage.
 */
export function resolveCodexInferenceTarget(
  snapshot: ConversationGraphSnapshot,
  branchId: BranchId,
): CodexInferenceTarget {
  const branch = snapshot.branches[branchId];
  if (!branch) {
    throw new Error(`Branch ${branchId} not found`);
  }

  if (branch.inferenceContext?.threadId) {
    return {
      mode: "resume",
      threadId: branch.inferenceContext.threadId,
    };
  }

  if (branch.parentId && branch.messageIds.length === 0) {
    const sourceMessage = snapshot.messages[branch.createdFrom.messageId];
    const sourceContext = sourceMessage?.inferenceContext;
    if (sourceContext?.threadId && sourceContext.turnId) {
      return {
        mode: "fork",
        threadId: sourceContext.threadId,
        turnId: sourceContext.turnId,
      };
    }
  }

  return { mode: "rebuild" };
}

export function selectCodexServiceTier(
  settings: Pick<ConversationSettings, "reasoningEffort" | "composerDefaults">,
): "priority" | null {
  return settings.reasoningEffort === "low" ||
    settings.composerDefaults.preset === "fast"
    ? "priority"
    : null;
}

export function listCodexThreadIdsForBranchSubtree(
  snapshot: ConversationGraphSnapshot,
  branchId: BranchId,
): string[] {
  if (!snapshot.branches[branchId]) {
    return [];
  }
  const included = new Set<BranchId>([branchId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const branch of Object.values(snapshot.branches)) {
      if (
        branch.parentId &&
        included.has(branch.parentId) &&
        !included.has(branch.id)
      ) {
        included.add(branch.id);
        changed = true;
      }
    }
  }
  return Array.from(
    new Set(
      Array.from(included)
        .map(
          (includedBranchId) =>
            snapshot.branches[includedBranchId]?.inferenceContext?.threadId,
        )
        .filter((threadId): threadId is string => Boolean(threadId)),
    ),
  );
}
