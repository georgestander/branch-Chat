import { strFromU8, unzipSync } from "fflate";
import { extractText } from "unpdf";

export const LEGACY_WORD_MIME_TYPE = "application/msword";
export const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const PDF_MIME_TYPE = "application/pdf";

const MAX_EXTRACTED_TEXT_CHARS = 120_000;
const MAX_DOCX_XML_BYTES = 8 * 1024 * 1024;
const CHUNK_CHAR_LIMIT = 2_400;
const CHUNK_OVERLAP = 240;

export interface ExtractedAttachmentSection {
  text: string;
  pageNumber: number | null;
}

export interface ExtractedAttachmentChunk extends ExtractedAttachmentSection {
  sectionIndex: number;
  chunkIndex: number;
}

function normalizeExtractedText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeXmlEntities(value: string): string {
  return value.replace(
    /&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi,
    (entity) => {
      switch (entity.toLowerCase()) {
        case "&amp;":
          return "&";
        case "&lt;":
          return "<";
        case "&gt;":
          return ">";
        case "&quot;":
          return '"';
        case "&apos;":
          return "'";
        default: {
          const isHex = entity.toLowerCase().startsWith("&#x");
          const raw = entity.slice(isHex ? 3 : 2, -1);
          const codePoint = Number.parseInt(raw, isHex ? 16 : 10);
          return Number.isSafeInteger(codePoint) &&
            codePoint >= 0 &&
            codePoint <= 0x10ffff
            ? String.fromCodePoint(codePoint)
            : entity;
        }
      }
    },
  );
}

export function extractDocxText(data: Uint8Array): string {
  const entries = unzipSync(data, {
    filter: (entry) =>
      entry.name === "word/document.xml" &&
      entry.originalSize > 0 &&
      entry.originalSize <= MAX_DOCX_XML_BYTES,
  });
  const documentXml = entries["word/document.xml"];
  if (!documentXml) {
    throw new Error(
      "DOCX does not contain readable document text or exceeds the extraction limit.",
    );
  }

  const text = strFromU8(documentXml)
    .replace(/<w:tab\b[^>]*\/?\s*>/gi, "\t")
    .replace(/<w:(?:br|cr)\b[^>]*\/?\s*>/gi, "\n")
    .replace(/<\/w:tc\s*>/gi, "\t")
    .replace(/<\/w:(?:p|tr)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return normalizeExtractedText(decodeXmlEntities(text));
}

export async function extractAttachmentSections(options: {
  data: Uint8Array;
  contentType: string;
}): Promise<ExtractedAttachmentSection[]> {
  const { data, contentType } = options;
  if (contentType.startsWith("text/")) {
    const text = normalizeExtractedText(new TextDecoder().decode(data));
    return text ? [{ text, pageNumber: null }] : [];
  }
  if (contentType === LEGACY_WORD_MIME_TYPE) {
    throw new Error(
      "Legacy .doc files are not supported for text extraction. Convert the file to .docx, PDF, or plain text.",
    );
  }
  if (contentType === DOCX_MIME_TYPE) {
    const text = extractDocxText(data);
    return text ? [{ text, pageNumber: null }] : [];
  }
  if (contentType === PDF_MIME_TYPE) {
    const result = await extractText(data, { mergePages: false });
    return result.text
      .map((text, index) => ({
        text: normalizeExtractedText(text),
        pageNumber: index + 1,
      }))
      .filter((section) => section.text.length > 0);
  }
  throw new Error(`Unsupported text extraction type: ${contentType}`);
}

function chunkText(text: string): string[] {
  const sanitized = normalizeExtractedText(text);
  if (!sanitized) {
    return [];
  }

  const chunks: string[] = [];
  let pointer = 0;
  while (pointer < sanitized.length && pointer < MAX_EXTRACTED_TEXT_CHARS) {
    const cappedEnd = Math.min(
      pointer + CHUNK_CHAR_LIMIT,
      sanitized.length,
      MAX_EXTRACTED_TEXT_CHARS,
    );
    let end = cappedEnd;
    let slice = sanitized.slice(pointer, end);
    if (end < sanitized.length && end < MAX_EXTRACTED_TEXT_CHARS) {
      const breaks = [
        slice.lastIndexOf("\n\n"),
        slice.lastIndexOf(". "),
        slice.lastIndexOf("\n"),
      ];
      const bestBreak = Math.max(...breaks);
      if (bestBreak > CHUNK_CHAR_LIMIT * 0.4) {
        end = pointer + bestBreak + 1;
        slice = sanitized.slice(pointer, end);
      }
    }

    const chunk = slice.trim();
    if (chunk) {
      chunks.push(chunk);
    }
    if (end >= sanitized.length || end >= MAX_EXTRACTED_TEXT_CHARS) {
      break;
    }
    pointer = Math.max(pointer + 1, end - CHUNK_OVERLAP);
  }
  return chunks;
}

export function chunkAttachmentSections(
  sections: ExtractedAttachmentSection[],
): ExtractedAttachmentChunk[] {
  const chunks: ExtractedAttachmentChunk[] = [];
  let remainingChars = MAX_EXTRACTED_TEXT_CHARS;

  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
    const section = sections[sectionIndex];
    if (!section || remainingChars <= 0) {
      break;
    }
    const sectionText = section.text.slice(0, remainingChars);
    const sectionChunks = chunkText(sectionText);
    for (let chunkIndex = 0; chunkIndex < sectionChunks.length; chunkIndex += 1) {
      const text = sectionChunks[chunkIndex];
      if (!text) {
        continue;
      }
      chunks.push({
        text,
        pageNumber: section.pageNumber,
        sectionIndex,
        chunkIndex,
      });
    }
    remainingChars -= sectionText.length;
  }
  return chunks;
}

export function summarizeExtractedChunks(
  chunks: ExtractedAttachmentChunk[],
): string | null {
  const first = chunks[0]?.text.trim();
  if (!first) {
    return null;
  }
  if (first.length <= 500) {
    return first;
  }
  const candidate = first.slice(0, 500);
  const sentenceEnd = Math.max(
    candidate.lastIndexOf(". "),
    candidate.lastIndexOf("\n"),
  );
  return `${candidate.slice(0, sentenceEnd > 250 ? sentenceEnd + 1 : 500).trim()}…`;
}

export function buildAttachmentChunkId(options: {
  attachmentId: string;
  pageNumber: number | null;
  sectionIndex: number;
  chunkIndex: number;
}): string {
  const location = options.pageNumber
    ? `page-${options.pageNumber}`
    : `section-${options.sectionIndex + 1}`;
  return `${options.attachmentId}:${location}:chunk-${options.chunkIndex + 1}`;
}

export function imageExtractionUnavailableText(fileName: string): string {
  return `Image attachment "${fileName}" was uploaded, but OCR and image understanding are not enabled. Do not infer, describe, or quote its contents. Ask the user for a text description or a supported text document if the image contents are needed.`;
}
