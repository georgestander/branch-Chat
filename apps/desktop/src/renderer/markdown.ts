import type { RenderedBranchAnchor } from "@branchy/conversation-core/presentation";
import type {
  Element as HastElement,
  Parent as HastParent,
  Root as HastRoot,
  Text as HastText,
} from "hast";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

type Highlight = {
  messageId: string;
  range: { start: number; end: number };
  markers: Array<{
    branchId: string;
    marker: number;
    selected: boolean;
  }>;
  selected: boolean;
  muted: boolean;
};

type MutableSchema = typeof defaultSchema & {
  attributes?: Record<string, Array<any>>;
  tagNames?: string[];
};

export type DesktopMarkdownOptions = {
  messageId: string;
  branchAnchors?: readonly RenderedBranchAnchor[];
  selectedBranchId?: string | null;
};

export type ClipboardWriter = {
  writeText(text: string): Promise<void>;
};

export type TrimmedSelection = {
  excerpt: string;
  span: { start: number; end: number };
};

const DESKTOP_MARKDOWN_SCHEMA = createDesktopMarkdownSchema();
const BRANCH_HIGHLIGHTS_FILE_DATA_KEY = "branchHighlights";
const DESKTOP_MARKDOWN_PROCESSOR = createDesktopMarkdownProcessor();

export function safeExternalUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export async function copyCodeToClipboard(
  code: string,
  clipboard: ClipboardWriter,
): Promise<boolean> {
  if (!code.trim()) return false;
  try {
    await clipboard.writeText(code);
    return true;
  } catch {
    return false;
  }
}

export function trimSelectionRange(
  rawExcerpt: string,
  rawSpan: { start: number; end: number },
): TrimmedSelection | null {
  const excerpt = rawExcerpt.trim();
  if (!excerpt) return null;
  const leadingWhitespace = rawExcerpt.length - rawExcerpt.trimStart().length;
  const trailingWhitespace = rawExcerpt.length - rawExcerpt.trimEnd().length;
  return {
    excerpt,
    span: {
      start: rawSpan.start + leadingWhitespace,
      end: rawSpan.end - trailingWhitespace,
    },
  };
}

export function renderDesktopMarkdown(
  markdown: string,
  options: DesktopMarkdownOptions,
): string {
  if (!markdown) return "";
  const highlights = highlightsForMessage(
    options.messageId,
    options.branchAnchors ?? [],
    options.selectedBranchId ?? null,
  );

  try {
    return String(
      DESKTOP_MARKDOWN_PROCESSOR.processSync({
        value: markdown,
        data: {
          [BRANCH_HIGHLIGHTS_FILE_DATA_KEY]: highlights,
        },
      }),
    );
  } catch {
    // Partial model output must remain visible even if a Markdown extension
    // cannot parse the in-flight fragment yet.
    return `<p>${escapeHtml(markdown)}</p>`;
  }
}

function createDesktopMarkdownProcessor() {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkRehype, { allowDangerousHtml: false })
    .use(rehypeKatex)
    .use(rehypeHighlight)
    .use(rehypeEnhanceCodeBlocks)
    .use(rehypeBranchHighlights)
    .use(rehypeExternalLinks)
    .use(rehypeSanitize, DESKTOP_MARKDOWN_SCHEMA)
    .use(rehypeStringify, { allowDangerousHtml: false })
    .freeze();
}

function highlightsForMessage(
  messageId: string,
  anchors: readonly RenderedBranchAnchor[],
  selectedBranchId: string | null,
): Highlight[] {
  const ordered = anchors
    .filter(
      (
        anchor,
      ): anchor is RenderedBranchAnchor & {
        range: { start: number; end: number };
      } =>
        Boolean(
          anchor.range &&
            Number.isInteger(anchor.range.start) &&
            Number.isInteger(anchor.range.end) &&
            anchor.range.start >= 0 &&
            anchor.range.start < anchor.range.end,
        ),
    )
    .map((anchor) => ({
      branchId: anchor.branchId,
      marker: anchor.marker,
      messageId,
      range: anchor.range,
      selected: anchor.branchId === selectedBranchId,
    }))
    .sort(
      (left, right) =>
        left.range.start - right.range.start ||
        left.range.end - right.range.end ||
        left.marker - right.marker,
    );

  const grouped: Highlight[] = [];
  for (const anchor of ordered) {
    const existing = grouped.at(-1);
    if (
      existing &&
      existing.range.start === anchor.range.start &&
      existing.range.end === anchor.range.end
    ) {
      existing.markers.push({
        branchId: anchor.branchId,
        marker: anchor.marker,
        selected: anchor.selected,
      });
      existing.selected ||= anchor.selected;
      existing.muted = Boolean(selectedBranchId) && !existing.selected;
      continue;
    }
    grouped.push({
      messageId,
      range: anchor.range,
      markers: [
        {
          branchId: anchor.branchId,
          marker: anchor.marker,
          selected: anchor.selected,
        },
      ],
      selected: anchor.selected,
      muted: Boolean(selectedBranchId) && !anchor.selected,
    });
  }
  return grouped;
}

function createDesktopMarkdownSchema(): typeof defaultSchema {
  const schema = structuredClone(defaultSchema) as MutableSchema;
  const attributes = schema.attributes ?? {};
  const extend = (name: string, values: Array<any>): void => {
    const current = attributes[name] ?? [];
    attributes[name] = Array.from(new Set([...current, ...values]));
  };

  extend("*", ["className", "data*"]);
  extend("a", [
    "className",
    "href",
    "rel",
    "target",
    "data-external-link",
  ]);
  extend("button", [
    "ariaLabel",
    "className",
    "data-branch-id",
    "data-branch-marker",
    "data-copy-code",
    "data-copy-state",
    "title",
    "type",
  ]);
  extend("code", ["className", "data-language"]);
  extend("div", ["className", "data-code-block", "data-language"]);
  extend("mark", [
    "className",
    "data-branch-highlight",
    "data-branch-id",
    "data-message-id",
    "data-branch-muted",
    "data-branch-selected",
  ]);
  extend("pre", ["className"]);
  extend("span", ["className"]);

  schema.attributes = attributes;
  schema.tagNames = Array.from(
    new Set([
      ...(schema.tagNames ?? []),
      "button",
      "div",
      "mark",
      "span",
    ]),
  );
  return schema as typeof defaultSchema;
}

function rehypeExternalLinks() {
  return (tree: HastRoot): void => {
    visitElements(tree, (element) => {
      if (element.tagName !== "a") return;
      const href =
        typeof element.properties?.href === "string"
          ? element.properties.href
          : null;
      const safeUrl = safeExternalUrl(href);
      if (!safeUrl) {
        delete element.properties?.href;
        delete element.properties?.target;
        delete element.properties?.rel;
        delete element.properties?.["data-external-link"];
        return;
      }
      element.properties = {
        ...(element.properties ?? {}),
        href: safeUrl,
        rel: ["noopener", "noreferrer"],
        target: "_blank",
        "data-external-link": "true",
      };
    });
  };
}

function rehypeEnhanceCodeBlocks() {
  return (tree: HastRoot): void => {
    transformChildren(tree);
  };

  function transformChildren(parent: HastParent): void {
    const children = parent.children as Array<HastElement | HastText>;
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      if (!child || child.type === "text") continue;

      if (child.tagName === "pre") {
        const code = child.children[0];
        if (code?.type !== "element" || code.tagName !== "code") continue;
        const classes = Array.isArray(code.properties?.className)
          ? code.properties.className.map(String)
          : [];
        const language =
          classes
            .find((className) => className.startsWith("language-"))
            ?.slice("language-".length)
            .trim() || null;
        children[index] = codeBlock(child, language);
        continue;
      }

      if (Array.isArray(child.children)) {
        transformChildren(child);
      }
    }
  }
}

function codeBlock(pre: HastElement, language: string | null): HastElement {
  const label = language?.toLowerCase() || "plain text";
  return {
    type: "element",
    tagName: "div",
    properties: {
      className: ["markdown-codeblock"],
      "data-code-block": "true",
      ...(language ? { "data-language": language } : {}),
    },
    children: [
      {
        type: "element",
        tagName: "div",
        properties: { className: ["markdown-codeblock__header"] },
        children: [
          {
            type: "element",
            tagName: "span",
            properties: { className: ["markdown-codeblock__language"] },
            children: [{ type: "text", value: label }],
          },
          {
            type: "element",
            tagName: "button",
            properties: {
              "aria-label": `Copy ${label} code`,
              className: ["markdown-codeblock__copy"],
              "data-copy-code": "true",
              "data-copy-state": "ready",
              type: "button",
            },
            children: [{ type: "text", value: "Copy" }],
          },
        ],
      },
      pre,
    ],
  };
}

function rehypeBranchHighlights() {
  return (
    tree: HastRoot,
    file: { data: Record<string, unknown> },
  ): void => {
    const storedHighlights =
      file.data[BRANCH_HIGHLIGHTS_FILE_DATA_KEY];
    const highlights = Array.isArray(storedHighlights)
      ? (storedHighlights as Highlight[])
      : [];
    if (highlights.length === 0) return;
    const state = { offset: 0, emittedMarkers: new Set<string>() };
    wrapHighlightChildren(tree, highlights, state);
  };
}

function wrapHighlightChildren(
  parent: HastParent,
  highlights: readonly Highlight[],
  state: { offset: number; emittedMarkers: Set<string> },
): void {
  const children = parent.children as Array<HastElement | HastText>;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (!child) continue;

    if (child.type === "text") {
      const value = child.value ?? "";
      const nodeStart = state.offset;
      const nodeEnd = nodeStart + value.length;
      state.offset = nodeEnd;
      const overlapping = highlights.filter(
        ({ range }) => nodeEnd > range.start && nodeStart < range.end,
      );
      if (overlapping.length === 0) continue;

      const boundaries = new Set<number>([0, value.length]);
      for (const { range } of overlapping) {
        boundaries.add(Math.max(0, range.start - nodeStart));
        boundaries.add(Math.min(value.length, range.end - nodeStart));
      }
      const offsets = [...boundaries].sort((left, right) => left - right);
      const fragments: Array<HastElement | HastText> = [];
      for (
        let offsetIndex = 0;
        offsetIndex < offsets.length - 1;
        offsetIndex += 1
      ) {
        const localStart = offsets[offsetIndex]!;
        const localEnd = offsets[offsetIndex + 1]!;
        const segment = value.slice(localStart, localEnd);
        if (!segment) continue;
        const globalStart = nodeStart + localStart;
        const globalEnd = nodeStart + localEnd;
        const highlight = overlapping.find(
          ({ range }) =>
            globalStart >= range.start && globalStart < range.end,
        );
        fragments.push(
          highlight
            ? highlightedSegment(
                segment,
                highlight,
                globalEnd >= highlight.range.end &&
                  !state.emittedMarkers.has(highlightKey(highlight)),
              )
            : { type: "text", value: segment },
        );
        if (highlight && globalEnd >= highlight.range.end) {
          state.emittedMarkers.add(highlightKey(highlight));
        }
      }
      children.splice(index, 1, ...fragments);
      index += fragments.length - 1;
      continue;
    }

    if (
      child.tagName !== "script" &&
      child.tagName !== "style" &&
      Array.isArray(child.children)
    ) {
      wrapHighlightChildren(child, highlights, state);
    }
  }
}

function highlightedSegment(
  value: string,
  highlight: Highlight,
  includeMarkers: boolean,
): HastElement {
  const selectedMarker =
    highlight.markers.find((marker) => marker.selected) ??
    highlight.markers[0]!;
  return {
    type: "element",
    tagName: "mark",
    properties: {
      className: ["branch-highlight"],
      "data-branch-highlight": "true",
      "data-branch-id": selectedMarker.branchId,
      "data-message-id": highlight.messageId,
      "data-branch-selected": String(highlight.selected),
      "data-branch-muted": String(highlight.muted),
    },
    children: [
      { type: "text", value },
      ...(includeMarkers
        ? [
            {
              type: "element" as const,
              tagName: "span",
              properties: {
                className: ["branch-highlight__markers"],
              },
              children: highlight.markers.map((marker) => ({
                type: "element" as const,
                tagName: "button",
                properties: {
                  ariaLabel: `Focus child branch ${marker.marker}`,
                  className: [
                    "branch-highlight__marker",
                    ...(marker.selected ? ["is-selected"] : []),
                  ],
                  "data-branch-id": marker.branchId,
                  "data-branch-marker": String(marker.marker),
                  title: `Focus ${marker.marker} · Child branch`,
                  type: "button",
                },
                children: [
                  { type: "text" as const, value: String(marker.marker) },
                ],
              })),
            },
          ]
        : []),
    ],
  };
}

function highlightKey(highlight: Highlight): string {
  return `${highlight.messageId}:${highlight.range.start}:${highlight.range.end}`;
}

function visitElements(
  parent: HastParent,
  visitor: (element: HastElement) => void,
): void {
  for (const child of parent.children) {
    if (child.type !== "element") continue;
    visitor(child);
    if (Array.isArray(child.children)) visitElements(child, visitor);
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
