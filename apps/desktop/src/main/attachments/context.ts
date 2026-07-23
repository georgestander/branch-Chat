import { strFromU8, unzipSync } from "fflate";
import { extractText } from "unpdf";

export const LEGACY_WORD_MIME_TYPE = "application/msword";
export const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const PDF_MIME_TYPE = "application/pdf";
export const MAX_ATTACHMENT_CONTEXT_CHARACTERS = 40_000;
export const MAX_ATTACHMENT_DOCUMENT_BYTES = 12 * 1024 * 1024;

const MAX_DOCX_XML_BYTES = 8 * 1024 * 1024;

function normalizeText(value: string): string {
  return value
    .replace(/\r\n?/gu, "\n")
    .replace(/[\t\f\v ]+/gu, " ")
    .replace(/ *\n */gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim()
    .slice(0, MAX_ATTACHMENT_CONTEXT_CHARACTERS);
}

function decodeXmlEntities(value: string): string {
  return value.replace(
    /&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/giu,
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
          const hexadecimal = entity.toLowerCase().startsWith("&#x");
          const raw = entity.slice(hexadecimal ? 3 : 2, -1);
          const codePoint = Number.parseInt(raw, hexadecimal ? 16 : 10);
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

function extractDocxText(bytes: Uint8Array): string {
  const entries = unzipSync(bytes, {
    filter: (entry) =>
      entry.name === "word/document.xml" &&
      entry.originalSize > 0 &&
      entry.originalSize <= MAX_DOCX_XML_BYTES,
  });
  const documentXml = entries["word/document.xml"];
  if (!documentXml) {
    throw new Error(
      "The DOCX does not contain readable document text or exceeds the extraction limit.",
    );
  }
  return normalizeText(
    decodeXmlEntities(
      strFromU8(documentXml)
        .replace(/<w:tab\b[^>]*\/?\s*>/giu, "\t")
        .replace(/<w:(?:br|cr)\b[^>]*\/?\s*>/giu, "\n")
        .replace(/<\/w:tc\s*>/giu, "\t")
        .replace(/<\/w:(?:p|tr)\s*>/giu, "\n")
        .replace(/<[^>]+>/gu, ""),
    ),
  );
}

export async function extractAttachmentContext(input: {
  bytes: Uint8Array;
  contentType: string;
  fileName: string;
}): Promise<string | null> {
  if (input.bytes.byteLength > MAX_ATTACHMENT_DOCUMENT_BYTES) {
    throw new Error(
      `${input.fileName} is too large for document extraction. Use a file under 12 MB.`,
    );
  }
  if (input.contentType.startsWith("image/")) {
    return null;
  }
  if (input.contentType.startsWith("text/")) {
    return normalizeText(
      new TextDecoder("utf-8", { fatal: true }).decode(input.bytes),
    );
  }
  if (input.contentType === LEGACY_WORD_MIME_TYPE) {
    throw new Error(
      "Legacy .doc attachments are not supported. Convert the file to DOCX, PDF, or plain text.",
    );
  }
  if (input.contentType === DOCX_MIME_TYPE) {
    return extractDocxText(input.bytes);
  }
  if (input.contentType === PDF_MIME_TYPE) {
    const result = await extractText(input.bytes, { mergePages: false });
    return normalizeText(
      result.text
        .map((page, index) => `Page ${index + 1}\n${page}`)
        .join("\n\n"),
    );
  }
  throw new Error(`${input.fileName} is not a supported attachment type.`);
}
