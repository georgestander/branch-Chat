import assert from "node:assert/strict";
import test from "node:test";

import { strToU8, zipSync } from "fflate";

import {
  DOCX_MIME_TYPE,
  LEGACY_WORD_MIME_TYPE,
  MAX_ATTACHMENT_CONTEXT_CHARACTERS,
  extractAttachmentContext,
} from "./context.ts";

test("extracts and bounds untrusted plain-text context", async () => {
  const context = await extractAttachmentContext({
    bytes: new TextEncoder().encode(
      `first\r\n${"x".repeat(MAX_ATTACHMENT_CONTEXT_CHARACTERS + 100)}`,
    ),
    contentType: "text/plain",
    fileName: "notes.txt",
  });

  assert.equal(context?.startsWith("first\n"), true);
  assert.equal(context?.length, MAX_ATTACHMENT_CONTEXT_CHARACTERS);
});

test("extracts readable DOCX document text without expanding other entries", async () => {
  const bytes = zipSync({
    "[Content_Types].xml": strToU8("<Types />"),
    "word/document.xml": strToU8(
      "<w:document><w:body><w:p><w:r><w:t>Hello &amp; goodbye</w:t></w:r></w:p></w:body></w:document>",
    ),
    "media/ignored.bin": new Uint8Array(1024),
  });

  assert.equal(
    await extractAttachmentContext({
      bytes,
      contentType: DOCX_MIME_TYPE,
      fileName: "brief.docx",
    }),
    "Hello & goodbye",
  );
});

test("rejects legacy DOC instead of silently omitting it", async () => {
  await assert.rejects(
    extractAttachmentContext({
      bytes: new Uint8Array([0xd0, 0xcf]),
      contentType: LEGACY_WORD_MIME_TYPE,
      fileName: "legacy.doc",
    }),
    /Convert the file to DOCX, PDF, or plain text/u,
  );
});
