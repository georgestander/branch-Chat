import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import { visit } from "unist-util-visit";
import type {
  Root as HastRoot,
  Element as HastElement,
  Text as HastText,
  Parent as HastParent,
} from "hast";
import type { Message } from "@/lib/conversation";
import type {
  RenderedBranchAnchor,
  RenderedMessage,
} from "@/lib/conversation/rendered";

export interface MessageBranchHighlight extends RenderedBranchAnchor {
  messageId: string;
}

export interface MarkdownRenderOptions {
  highlights?: Array<{
    range: { start: number; end: number };
    branchId: string;
    messageId: string;
  }>;
  enableSyntaxHighlighting?: boolean;
}

const SANITIZE_SCHEMA = createSanitizeSchema();

export async function renderMarkdownToHtml(
  content: string,
  options: MarkdownRenderOptions = {},
): Promise<string> {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkRehype, { allowDangerousHtml: false })
    .use(rehypeKatex)
    .use(rehypeEnhanceCodeBlocks)
    .use(rehypeBoldListHeadings, { mode: "heuristic" });

  if (options.enableSyntaxHighlighting !== false) {
    processor.use(rehypeHighlight);
  }

  if (options.highlights && options.highlights.length > 0) {
    processor.use(() => (tree: HastRoot) => {
      wrapHighlights(tree, options.highlights!);
    });
  }

  processor.use(rehypeSanitize, SANITIZE_SCHEMA).use(rehypeStringify, {
    allowDangerousHtml: false,
  });

  const file = await processor.process(content);
  return String(file);
}

export async function enrichMessagesWithHtml(
  messages: Message[],
  options: {
    highlights?: MessageBranchHighlight[];
    streamingMessageId?: string | null;
  } = {},
): Promise<RenderedMessage[]> {
  return Promise.all(
    messages.map(async (message) => {
      const branchAnchors = (options.highlights ?? [])
        .filter((highlight) => highlight.messageId === message.id)
        .map(({ messageId: _messageId, ...anchor }) => anchor);
      const textHighlights = branchAnchors
        .filter(
          (anchor): anchor is RenderedBranchAnchor & {
            range: { start: number; end: number };
          } => Boolean(anchor.range && anchor.range.start < anchor.range.end),
        )
        .map((anchor) => ({
          range: anchor.range,
          branchId: anchor.branchId,
          messageId: message.id,
        }));
      const enableSyntaxHighlighting =
        !(options.streamingMessageId && options.streamingMessageId === message.id && message.role === "assistant");

      const renderedHtml = await renderMarkdownToHtml(message.content, {
        highlights: textHighlights,
        enableSyntaxHighlighting,
      });

      const hasBranchHighlight = branchAnchors.length > 0;

      return {
        ...message,
        renderedHtml,
        hasBranchHighlight,
        branchAnchors,
      } satisfies RenderedMessage;
    }),
  );
}

type MutableSchema = typeof defaultSchema & {
  attributes?: Record<string, Array<any>>;
  tagNames?: Array<string>;
};

function createSanitizeSchema(): typeof defaultSchema {
  const schema = structuredClone(defaultSchema) as MutableSchema;
  const attributes = schema.attributes ?? {};

  const extend = (key: string, values: Array<any>) => {
    const current = attributes[key] ?? [];
    const next = new Set<any>(current);
    for (const value of values) {
      next.add(value);
    }
    attributes[key] = Array.from(next);
  };

  extend("*", ["className", "data*", "id"]);
  extend("mark", [
    "className",
    "data-branch-highlight",
    "data-branch-id",
    "data-message-id",
  ]);
  extend("code", ["className", "data-language"]);
  extend("pre", ["className", "data-theme"]);
  extend("button", ["className", "type", "data-copy-code", "data-copy-state"]);
  extend("section", ["className", "aria-labelledby", "aria-label"]);
  extend("sup", ["className"]);

  schema.attributes = attributes;
  schema.tagNames = Array.from(
    new Set([...(schema.tagNames ?? []), "mark", "span", "button", "div", "section", "sup"]),
  );

  return schema as typeof defaultSchema;
}

function rehypeEnhanceCodeBlocks() {
  return (tree: HastRoot) => {
    visit(tree, "element", (node: HastElement, index: number | undefined, parent: HastParent | undefined) => {
      if (!parent || index == null) {
        return;
      }

      if (node.tagName !== "pre") {
        return;
      }

      const children = node.children ?? [];
      const code = children[0];
      if (!code || code.type !== "element" || code.tagName !== "code") {
        return;
      }

      const className = Array.isArray(code.properties?.className)
        ? (code.properties?.className as string[])
        : [];
      const languageClass = className.find((value) => value.startsWith("language-"));
      const language = languageClass?.replace("language-", "") ?? null;

      const wrapper: HastElement = {
        type: "element",
        tagName: "div",
        properties: {
          className: ["markdown-codeblock"],
          "data-code-block": "true",
          ...(language ? { "data-language": language } : {}),
        },
        children: [
          createCodeHeader(language),
          node,
        ],
      };

      const parentChildren = parent.children as Array<HastElement | HastText>;
      parentChildren.splice(index, 1, wrapper);
    });
  };
}

/**
 * Makes the first phrase of each list item act as a heading by wrapping it in <strong>…</strong>.
 * Heuristic mode bolds up to the first colon, em dash/dash, or sentence-ending punctuation.
 * If no boundary is found, it falls back to bolding the first paragraph.
 */
function rehypeBoldListHeadings(options: { mode?: "conservative" | "heuristic" } = {}) {
  const mode = options.mode ?? "heuristic";
  return (tree: HastRoot) => {
    visit(tree, "element", (node: HastElement) => {
      if (node.tagName !== "li" || !Array.isArray(node.children) || node.children.length === 0) {
        return;
      }

      // Operate on first paragraph within the list item when present; otherwise on the li itself.
      const firstChild = node.children[0] as HastElement | HastText;
      const container: HastElement =
        firstChild && (firstChild as HastElement).type === "element" && (firstChild as HastElement).tagName === "p"
          ? (firstChild as HastElement)
          : (node as unknown as HastElement);

      const children = (container.children ?? []) as Array<HastElement | HastText>;
      if (children.length === 0) return;

      // Find first non-empty child
      let idx = 0;
      while (idx < children.length) {
        const c = children[idx];
        if (c.type === "text" && (c.value ?? "").trim().length === 0) {
          idx += 1;
          continue;
        }
        break;
      }
      if (idx >= children.length) return;

      // If already starts with <strong>, respect it
      const head = children[idx];
      if (head.type === "element" && head.tagName === "strong") {
        return;
      }

      // Helper to create a <strong> wrapper
      const strongWrap = (nodes: Array<HastElement | HastText>): HastElement => ({
        type: "element",
        tagName: "strong",
        properties: {},
        children: nodes,
      });

      if (head.type === "text") {
        const raw = head.value ?? "";
        // Heuristic: bold until first boundary token
        let splitAt = -1;
        if (mode === "heuristic") {
          const candidates: number[] = [];
          const punctuation = [":", ".", "!", "?"]; // include the punctuation itself
          for (const ch of punctuation) {
            const p = raw.indexOf(ch);
            if (p >= 0) candidates.push(p + 1);
          }
          const spacedDashes = [" - ", " – ", " — "];
          for (const seq of spacedDashes) {
            const p = raw.indexOf(seq);
            if (p >= 0) candidates.push(p + seq.length);
          }
          if (candidates.length > 0) {
            splitAt = Math.min(...candidates);
          }
        }

        if (splitAt <= 0) {
          // No boundary — conservative: bold the whole first run/paragraph
          // Replace the head with a strong-wrapped version
          children.splice(idx, 1, strongWrap([{ type: "text", value: raw }]));
        } else {
          const before = raw.slice(0, splitAt);
          const after = raw.slice(splitAt);
          children.splice(
            idx,
            1,
            strongWrap([{ type: "text", value: before }]),
            { type: "text", value: after },
          );
        }
        return;
      }

      // If the head is an element (link/em/etc.), wrap that element in <strong>.
      children.splice(idx, 1, strongWrap([head]));
    });
  };
}

function createCodeHeader(language: string | null): HastElement {
  const label = language ? language.toLowerCase() : "plain text";

  return {
    type: "element",
    tagName: "div",
    properties: {
      className: ["markdown-codeblock__header"],
    },
    children: [
      {
        type: "element",
        tagName: "span",
        properties: {
          className: ["markdown-codeblock__language"],
        },
        children: [{ type: "text", value: label }],
      },
      {
        type: "element",
        tagName: "button",
        properties: {
          type: "button",
          className: ["markdown-codeblock__copy"],
          "data-copy-code": "true",
          "data-copy-state": "ready",
        },
        children: [{ type: "text", value: "Copy" }],
      },
    ],
  } satisfies HastElement;
}

function wrapHighlights(
  tree: HastRoot,
  highlights: Array<{
    range: { start: number; end: number };
    branchId: string;
    messageId: string;
  }>,
) {
  const normalized = highlights
    .filter(({ range }) => range.start < range.end)
    .sort((left, right) =>
      left.range.start !== right.range.start
        ? left.range.start - right.range.start
        : left.range.end - right.range.end,
    );
  if (normalized.length === 0) {
    return;
  }
  const state = { offset: 0 };

  function descend(node: HastParent) {
    const children = node.children as Array<HastElement | HastText>;
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      if (!child) continue;

      if (child.type === "text") {
        const value = child.value ?? "";
        const nodeStart = state.offset;
        const nodeEnd = nodeStart + value.length;
        state.offset = nodeEnd;

        const overlapping = normalized.filter(
          ({ range }) => nodeEnd > range.start && nodeStart < range.end,
        );
        if (overlapping.length === 0) {
          continue;
        }
        const boundaries = new Set<number>([0, value.length]);
        for (const { range } of overlapping) {
          boundaries.add(Math.max(0, range.start - nodeStart));
          boundaries.add(Math.min(value.length, range.end - nodeStart));
        }
        const offsets = [...boundaries].sort((left, right) => left - right);
        const fragments: Array<HastElement | HastText> = [];
        for (let offsetIndex = 0; offsetIndex < offsets.length - 1; offsetIndex += 1) {
          const localStart = offsets[offsetIndex]!;
          const localEnd = offsets[offsetIndex + 1]!;
          const segment = value.slice(localStart, localEnd);
          if (!segment) continue;
          const globalStart = nodeStart + localStart;
          const highlight = overlapping.find(
            ({ range }) => globalStart >= range.start && globalStart < range.end,
          );
          if (!highlight) {
            fragments.push({ type: "text", value: segment });
            continue;
          }
          const properties: Record<string, string | string[]> = {
            className: ["branch-highlight"],
            "data-branch-highlight": "true",
            "data-branch-id": highlight.branchId,
            "data-message-id": highlight.messageId,
          };
          fragments.push({
            type: "element",
            tagName: "mark",
            properties,
            children: [{ type: "text", value: segment }],
          });
        }

        if (fragments.length > 0) {
          children.splice(index, 1, ...fragments);
          index += fragments.length - 1;
        }

        continue;
      }

      if ("children" in child && Array.isArray(child.children)) {
        descend(child as HastParent);
      }
    }
  }

  descend(tree as unknown as HastParent);
}
