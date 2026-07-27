import assert from "node:assert/strict";
import test from "node:test";

import type { RenderedBranchAnchor } from "@branchy/conversation-core/presentation";

import {
  copyCodeToClipboard,
  renderDesktopMarkdown,
  safeExternalUrl,
  trimSelectionRange,
} from "./markdown.ts";

test("renders GFM, math, and copyable highlighted code", () => {
  const html = renderDesktopMarkdown(
    [
      "## Result",
      "",
      "| Name | Ready |",
      "| --- | --- |",
      "| Branchy | yes |",
      "",
      "~~old~~ and $x^2$",
      "",
      "```ts",
      "const ready = true;",
      "```",
    ].join("\n"),
    { messageId: "message-rich" },
  );

  assert.match(html, /<h2>Result<\/h2>/);
  assert.match(html, /<table>/);
  assert.match(html, /<del>old<\/del>/);
  assert.match(html, /class="katex"/);
  assert.match(html, /class="markdown-codeblock"/);
  assert.match(html, /data-code-block="true"/);
  assert.match(html, /data-copy-code="true"/);
  assert.match(html, /class="[^"]*language-ts[^"]*"/);
  assert.match(html, /ready = .*true.*;/);
});

test("keeps external links on the native HTTPS boundary", () => {
  const html = renderDesktopMarkdown(
    [
      "[Open docs](https://example.com/docs)",
      "[Unsafe](javascript:alert(1))",
      "[Plain HTTP](http://example.com)",
    ].join(" "),
    { messageId: "message-links" },
  );

  assert.match(
    html,
    /href="https:\/\/example\.com\/docs"[^>]*data-external-link="true"/,
  );
  assert.doesNotMatch(html, /href="javascript:/);
  assert.doesNotMatch(html, /href="http:\/\/example\.com/);
  assert.equal(safeExternalUrl("https://example.com/docs"), "https://example.com/docs");
  assert.equal(safeExternalUrl("http://example.com"), null);
  assert.equal(safeExternalUrl("javascript:alert(1)"), null);
});

test("drops executable HTML instead of trusting model output", () => {
  const html = renderDesktopMarkdown(
    [
      "Safe before.",
      "<script>globalThis.pwned = true</script>",
      '<img src="x" onerror="globalThis.pwned = true">',
      "[bad](javascript:globalThis.pwned=true)",
      "Safe after.",
    ].join("\n\n"),
    { messageId: "message-hostile" },
  );

  assert.match(html, /Safe before/);
  assert.match(html, /Safe after/);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /<img/i);
  assert.doesNotMatch(html, /onerror/i);
  assert.doesNotMatch(html, /javascript:/i);
});

test("marks exact visible source ranges with stable branch lineage", () => {
  const anchors: RenderedBranchAnchor[] = [
    {
      branchId: "branch-beta",
      marker: 1,
      title: "Beta branch",
      excerpt: "beta",
      range: { start: 6, end: 10 },
      tone: "amber",
    },
    {
      branchId: "branch-gamma",
      marker: 2,
      title: "Gamma branch",
      excerpt: "gamma",
      range: { start: 11, end: 16 },
      tone: "cyan",
    },
  ];
  const html = renderDesktopMarkdown("Alpha **beta** gamma delta", {
    messageId: "message-source",
    branchAnchors: anchors,
  });

  assert.match(
    html,
    /<strong><mark[^>]*data-branch-id="branch-beta"[^>]*>beta.*data-branch-marker="1".*<\/mark><\/strong>/,
  );
  assert.match(
    html,
    /<mark[^>]*data-branch-id="branch-gamma"[^>]*>gamma.*data-branch-marker="2".*<\/mark>/,
  );
  assert.match(html, /data-message-id="message-source"/);
  assert.match(html, /data-branch-marker="1"/);
  assert.match(html, /data-branch-marker="2"/);
  assert.match(html, /Focus 1 · Child branch/);
  assert.match(html, /aria-label="Focus child branch 1"/);
  assert.doesNotMatch(html, /data-branch-tone/);
  assert.doesNotMatch(html, /--branch-highlight-color/);
  assert.doesNotMatch(html, /border-bottom:2px solid/);
  assert.doesNotMatch(html, />Alpha<\/mark>/);
  assert.doesNotMatch(html, /> delta<\/mark>/);
});

test("keeps branch highlights isolated between shared processor calls", () => {
  const highlighted = renderDesktopMarkdown("Alpha beta gamma", {
    messageId: "message-shared-processor",
    branchAnchors: [
      {
        branchId: "branch-highlighted",
        marker: 1,
        title: "Highlighted branch",
        excerpt: "beta",
        range: { start: 6, end: 10 },
        tone: "amber",
      },
    ],
  });
  const plain = renderDesktopMarkdown("Alpha beta gamma", {
    messageId: "message-shared-processor",
    branchAnchors: [],
  });

  assert.match(highlighted, /data-branch-id="branch-highlighted"/);
  assert.doesNotMatch(plain, /data-branch-highlight/);
  assert.match(plain, /Alpha beta gamma/);
});

test("groups shared-span markers and emphasizes only the selected child source", () => {
  const html = renderDesktopMarkdown("Alpha beta gamma delta", {
    messageId: "message-shared-span",
    selectedBranchId: "branch-second",
    branchAnchors: [
      {
        branchId: "branch-first",
        marker: 1,
        title: "First",
        excerpt: "beta",
        range: { start: 6, end: 10 },
      },
      {
        branchId: "branch-second",
        marker: 2,
        title: "Second",
        excerpt: "beta",
        range: { start: 6, end: 10 },
      },
      {
        branchId: "branch-third",
        marker: 3,
        title: "Third",
        excerpt: "gamma",
        range: { start: 11, end: 16 },
      },
    ],
  });

  assert.equal(html.match(/data-branch-highlight="true"/g)?.length, 2);
  assert.match(
    html,
    /data-branch-selected="true"[^>]*>beta<span class="branch-highlight__markers">/,
  );
  assert.match(html, /data-branch-marker="1"/);
  assert.match(html, /data-branch-marker="2"/);
  assert.match(html, /data-branch-muted="true"[^>]*>gamma/);
});

test("renders incomplete streaming Markdown without requiring rendered HTML", () => {
  const html = renderDesktopMarkdown(
    "Still **thinking through an unfinished response",
    { messageId: "message-streaming" },
  );

  assert.match(html, /Still/);
  assert.match(html, /unfinished response/);
  assert.doesNotMatch(html, /<script/i);
});

test("copies the exact code payload and reports clipboard failures", async () => {
  const writes: string[] = [];
  const copied = await copyCodeToClipboard("const answer = 42;\n", {
    async writeText(value) {
      writes.push(value);
    },
  });
  const failed = await copyCodeToClipboard("retry()", {
    async writeText() {
      throw new Error("clipboard unavailable");
    },
  });

  assert.equal(copied, true);
  assert.deepEqual(writes, ["const answer = 42;\n"]);
  assert.equal(failed, false);
});

test("selection branching preserves the exact trimmed source span", () => {
  assert.deepEqual(trimSelectionRange("  beta \n", { start: 4, end: 12 }), {
    excerpt: "beta",
    span: { start: 6, end: 10 },
  });
  assert.equal(trimSelectionRange(" \n\t", { start: 4, end: 7 }), null);
});
