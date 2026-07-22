export const BRANCH_TONES = [
  { key: "cyan", color: "#0891b2" },
  { key: "emerald", color: "#059669" },
  { key: "amber", color: "#d97706" },
  { key: "rose", color: "#e11d48" },
  { key: "violet", color: "#7c3aed" },
  { key: "blue", color: "#2563eb" },
] as const;

export type BranchTone = (typeof BRANCH_TONES)[number];
export type BranchToneKey = BranchTone["key"];

function branchToneIndexForId(branchId: string): number {
  let hash = 2166136261;
  for (let index = 0; index < branchId.length; index += 1) {
    hash ^= branchId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % BRANCH_TONES.length;
}

export function branchToneForId(branchId: string): BranchTone {
  return BRANCH_TONES[branchToneIndexForId(branchId)]!;
}

export function branchToneByKey(key: BranchToneKey): BranchTone {
  return BRANCH_TONES.find((tone) => tone.key === key) ?? BRANCH_TONES[0];
}

export function branchLineageId(
  snapshot: Pick<ConversationGraphSnapshot, "conversation" | "branches">,
  branchId: BranchId,
): BranchId | null {
  const rootBranchId = snapshot.conversation.rootBranchId;
  if (branchId === rootBranchId) return null;

  let current = snapshot.branches[branchId];
  const visited = new Set<BranchId>();
  while (current?.parentId && current.parentId !== rootBranchId) {
    if (visited.has(current.id)) return null;
    visited.add(current.id);
    current = snapshot.branches[current.parentId];
  }
  return current?.parentId === rootBranchId ? current.id : null;
}

export function branchToneForBranch(
  snapshot: Pick<ConversationGraphSnapshot, "conversation" | "branches">,
  branchId: BranchId,
): BranchTone | null {
  const rootBranchId = snapshot.conversation.rootBranchId;
  if (branchId === rootBranchId) return null;

  const visited = new Set<BranchId>();
  const resolveTone = (currentBranchId: BranchId): BranchTone | null => {
    if (currentBranchId === rootBranchId || visited.has(currentBranchId)) {
      return null;
    }
    visited.add(currentBranchId);
    const branch = snapshot.branches[currentBranchId];
    if (!branch?.parentId) return null;

    const preferredIndex = branchToneIndexForId(currentBranchId);
    const parentTone = resolveTone(branch.parentId);
    if (!parentTone || BRANCH_TONES[preferredIndex]?.key !== parentTone.key) {
      return BRANCH_TONES[preferredIndex]!;
    }
    return BRANCH_TONES[(preferredIndex + 1) % BRANCH_TONES.length]!;
  };

  return resolveTone(branchId);
}
import type {
  BranchId,
  ConversationGraphSnapshot,
} from "./model";
