import type { ToolInvocation } from "./model.ts";

export const ATTACHMENT_RETRIEVAL_TOOL_NAME = "attachment_retrieval";

export interface AttachmentCitationSource {
  id: string;
  attachmentId: string;
  sourceId?: string | null;
  name: string;
  pageNumber?: number | null;
  excerpt: string;
  contentType?: string | null;
}

export interface AttachmentCitationManifest {
  messageId?: string | null;
  sources: AttachmentCitationSource[];
}

export function extractAttachmentCitationSources(
  invocations?: ToolInvocation[] | null,
): AttachmentCitationSource[] {
  if (!Array.isArray(invocations) || invocations.length === 0) {
    return [];
  }

  const sourcesById = new Map<string, AttachmentCitationSource>();

  for (const invocation of invocations) {
    if (invocation.toolType !== ATTACHMENT_RETRIEVAL_TOOL_NAME) {
      continue;
    }

    const output = asRecord(invocation.output);
    if (!output || !Array.isArray(output.sources)) {
      continue;
    }

    for (const value of output.sources) {
      const source = parseAttachmentCitationSource(value);
      if (source && !sourcesById.has(source.id)) {
        sourcesById.set(source.id, source);
      }
    }
  }

  return Array.from(sourcesById.values()).sort(compareCitationIds);
}

export function buildAttachmentCitationManifest(
  messageId: string | null | undefined,
  invocations?: ToolInvocation[] | null,
): AttachmentCitationManifest | undefined {
  const sources = extractAttachmentCitationSources(invocations);
  if (sources.length === 0) {
    return undefined;
  }

  return {
    messageId,
    sources,
  };
}

export function attachmentCitationFragmentId(
  messageId: string | null | undefined,
  citationId: string,
): string {
  const citationToken = citationId.toLowerCase();
  if (!messageId) {
    return `attachment-source-${citationToken}`;
  }

  return `attachment-source-${safeDomToken(messageId)}-${citationToken}`;
}

function parseAttachmentCitationSource(
  value: unknown,
): AttachmentCitationSource | null {
  const source = asRecord(value);
  if (!source) {
    return null;
  }

  const id = readTrimmedString(source.id);
  const attachmentId = readTrimmedString(source.attachmentId);
  const name = readTrimmedString(source.name);
  const excerpt = readTrimmedString(source.excerpt);

  if (
    !id ||
    !/^A[1-9]\d*$/.test(id) ||
    !attachmentId ||
    !name ||
    !excerpt
  ) {
    return null;
  }

  const pageNumber =
    typeof source.pageNumber === "number" &&
    Number.isSafeInteger(source.pageNumber) &&
    source.pageNumber > 0
      ? source.pageNumber
      : null;
  const contentType = readTrimmedString(source.contentType);
  const sourceId = readTrimmedString(source.sourceId);

  return {
    id,
    attachmentId,
    ...(sourceId ? { sourceId } : {}),
    name,
    pageNumber,
    excerpt,
    contentType,
  };
}

function compareCitationIds(
  left: AttachmentCitationSource,
  right: AttachmentCitationSource,
): number {
  const leftNumber = Number.parseInt(left.id.slice(1), 10);
  const rightNumber = Number.parseInt(right.id.slice(1), 10);
  return leftNumber - rightNumber || left.id.localeCompare(right.id);
}

function safeDomToken(value: string): string {
  const readable = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36) || "message";

  return `${readable}-${hashString(value)}`;
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}
