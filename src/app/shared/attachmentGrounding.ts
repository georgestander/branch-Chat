import {
  ATTACHMENT_RETRIEVAL_TOOL_NAME,
  type AttachmentCitationSource,
} from "../../lib/conversation/attachmentCitations.ts";
import type {
  RetrievedContextChunk,
  ToolInvocation,
} from "../../lib/conversation/model.ts";
import { formatGroundedPromptBlocks } from "./retrieval.prompt.ts";

export interface PreparedAttachmentGrounding {
  prompt: string;
  sources: AttachmentCitationSource[];
  invocation: ToolInvocation;
}

export function prepareAttachmentGrounding(options: {
  blocks: RetrievedContextChunk[];
  invocationId: string;
  timestamp: string;
}): PreparedAttachmentGrounding | null {
  const attachmentBlocks = options.blocks.filter(
    (block): block is RetrievedContextChunk & { attachmentId: string } =>
      block.type === "attachment" && Boolean(block.attachmentId),
  );
  const prompt = formatGroundedPromptBlocks(attachmentBlocks);
  if (!prompt) {
    return null;
  }

  const sources = attachmentBlocks.map((block, index) => ({
    id: `A${index + 1}`,
    attachmentId: block.attachmentId,
    name: readString(block.metadata?.fileName) ?? block.title,
    pageNumber: readPageNumber(block.metadata?.pageNumber),
    excerpt: block.content,
    contentType: readString(block.metadata?.contentType),
    sourceId: readString(block.metadata?.sourceId) ?? block.id,
  } satisfies AttachmentCitationSource));

  return {
    prompt,
    sources,
    invocation: {
      id: options.invocationId,
      toolType: ATTACHMENT_RETRIEVAL_TOOL_NAME,
      toolName: ATTACHMENT_RETRIEVAL_TOOL_NAME,
      callId: options.invocationId,
      input: { sourceCount: sources.length },
      output: { sources },
      status: "succeeded",
      startedAt: options.timestamp,
      completedAt: options.timestamp,
      error: null,
    },
  };
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function readPageNumber(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
    ? value
    : null;
}
