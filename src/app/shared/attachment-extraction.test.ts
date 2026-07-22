import assert from "node:assert/strict";
import test from "node:test";

import { strToU8, zipSync } from "fflate";

import {
  buildAttachmentChunkId,
  chunkAttachmentSections,
  DOCX_MIME_TYPE,
  extractAttachmentSections,
  extractDocxText,
  imageExtractionUnavailableText,
  LEGACY_WORD_MIME_TYPE,
  PDF_MIME_TYPE,
} from "./attachment-extraction.ts";

function createTextPdf(text: string): Uint8Array {
  const escaped = text.replace(/([\\()])/g, "\\$1");
  const stream = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

test("extracts DOCX paragraph text locally without a model", () => {
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    "<w:body>",
    '<w:p><w:r><w:t>Invoice &amp; approval</w:t></w:r></w:p>',
    '<w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p>',
    "</w:body></w:document>",
  ].join("");
  const docx = zipSync({ "word/document.xml": strToU8(xml) });

  assert.equal(
    extractDocxText(docx),
    "Invoice & approval\nSecond paragraph",
  );
});

test("extracts PDF text with one-based page metadata", async () => {
  const sections = await extractAttachmentSections({
    data: createTextPdf("Grounded PDF evidence"),
    contentType: PDF_MIME_TYPE,
  });

  assert.equal(sections.length, 1);
  assert.equal(sections[0]?.pageNumber, 1);
  assert.match(sections[0]?.text ?? "", /Grounded PDF evidence/);
});

test("extracts DOCX through the attachment content-type boundary", async () => {
  const docx = zipSync({
    "word/document.xml": strToU8(
      '<w:document><w:body><w:p><w:r><w:t>Local DOCX evidence</w:t></w:r></w:p></w:body></w:document>',
    ),
  });
  const sections = await extractAttachmentSections({
    data: docx,
    contentType: DOCX_MIME_TYPE,
  });
  assert.deepEqual(sections, [
    { text: "Local DOCX evidence", pageNumber: null },
  ]);
});

test("rejects legacy DOC explicitly instead of pretending to parse it", async () => {
  await assert.rejects(
    extractAttachmentSections({
      data: new Uint8Array([1, 2, 3]),
      contentType: LEGACY_WORD_MIME_TYPE,
    }),
    /Legacy \.doc files are not supported/,
  );
});

test("preserves page metadata and stable attachment source ids", () => {
  const chunks = chunkAttachmentSections([
    { text: "Page one evidence", pageNumber: 1 },
    { text: "Page two evidence", pageNumber: 2 },
  ]);
  assert.deepEqual(
    chunks.map((chunk) => chunk.pageNumber),
    [1, 2],
  );
  assert.equal(
    buildAttachmentChunkId({
      attachmentId: "attachment-1",
      pageNumber: chunks[1]?.pageNumber ?? null,
      sectionIndex: chunks[1]?.sectionIndex ?? 0,
      chunkIndex: chunks[1]?.chunkIndex ?? 0,
    }),
    "attachment-1:page-2:chunk-1",
  );
});

test("image fallback explicitly prevents unsupported OCR inference", () => {
  const message = imageExtractionUnavailableText("chart.png");
  assert.match(message, /OCR and image understanding are not enabled/);
  assert.match(message, /Do not infer, describe, or quote its contents/);
});
