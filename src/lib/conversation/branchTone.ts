export const BRANCH_TONES = [
  { key: "cyan", color: "#0891b2" },
  { key: "emerald", color: "#059669" },
  { key: "amber", color: "#d97706" },
  { key: "rose", color: "#e11d48" },
  { key: "violet", color: "#7c3aed" },
  { key: "blue", color: "#2563eb" },
] as const;

export type BranchTone = (typeof BRANCH_TONES)[number];

export function branchToneForId(branchId: string): BranchTone {
  let hash = 2166136261;
  for (let index = 0; index < branchId.length; index += 1) {
    hash ^= branchId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return BRANCH_TONES[(hash >>> 0) % BRANCH_TONES.length]!;
}
