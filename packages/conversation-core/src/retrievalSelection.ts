export interface AttachmentMatchIdentity {
  chunk: {
    id: string;
    attachmentId: string;
  };
}

export function selectAttachmentMatchesWithRequiredCoverage<
  Match extends AttachmentMatchIdentity,
>(options: {
  rankedMatches: Match[];
  limit: number;
  requiredAttachmentIds: string[];
}): {
  matches: Match[];
  missingRequiredAttachmentIds: string[];
} {
  const effectiveLimit = Math.max(
    Math.max(0, Math.floor(options.limit)),
    options.requiredAttachmentIds.length,
  );
  const matches: Match[] = [];
  const selectedChunkIds = new Set<string>();
  const missingRequiredAttachmentIds: string[] = [];

  for (const attachmentId of options.requiredAttachmentIds) {
    const match = options.rankedMatches.find(
      (candidate) => candidate.chunk.attachmentId === attachmentId,
    );
    if (!match) {
      missingRequiredAttachmentIds.push(attachmentId);
      continue;
    }
    matches.push(match);
    selectedChunkIds.add(match.chunk.id);
  }

  for (const match of options.rankedMatches) {
    if (matches.length >= effectiveLimit) {
      break;
    }
    if (selectedChunkIds.has(match.chunk.id)) {
      continue;
    }
    matches.push(match);
    selectedChunkIds.add(match.chunk.id);
  }

  return { matches, missingRequiredAttachmentIds };
}
