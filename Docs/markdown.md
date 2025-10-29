ChatGPT-Style Markdown Rendering in React
Overview of Requirements
To replicate ChatGPT’s rich markdown output in a React + TypeScript + Tailwind + shadcn/UI stack, we need to support:
Markdown parsing (headings, tables, lists, links, etc., including GitHub Flavored Markdown features like tables and task lists).
Code blocks with syntax highlighting (ideally with automatic language detection or default language).
Math/LaTeX rendering (optional, using KaTeX or similar).
Custom component rendering for specific elements (e.g. custom link or blockquote components for styling/behavior).
Tailwind + shadcn/ui compatibility (ability to style via Tailwind classes or use shadcn components).

### Connexus Implementation Notes (2025-02-19)

- We render markdown on the server (RSC) using the unified pipeline (`remark-*` + `remark-rehype` + `rehype-highlight`) so the client receives ready-to-paint HTML. Streaming assistant responses still downgrade to plain `<pre><code>` until the final delta arrives to keep parses light.
- Shiki (`rehype-pretty-code`) was prototyped, but Cloudflare workerd rejects its WASM engine (`WebAssembly.instantiate(): Wasm code generation disallowed by embedder`). Until we have a Worker-compatible bundling strategy, we fall back to highlight.js. The highlighter hook lives in `renderMarkdownToHtml`, so swapping back in later is one import change plus CSS tweaks.
- Code fences are wrapped in a server-generated header that surfaces the language label and a copy button; the client adds clipboard wiring inside `BranchableMessage`. Styling lives beside the prose overrides in `src/app/styles.css`.
- Branch excerpts now highlight spans inside the sanitized HTML that is streamed from the server. This keeps the parent column snippet in sync with what users see in the active branch.
- **Rollback plan:** if highlight.js becomes too heavy, disable syntax highlighting via the `enableSyntaxHighlighting` flag (or wire in a Worker-safe tokenizer) without touching the client components.
- Manual validation matrix (tables, inline/block code, KaTeX) is tracked in `docs/testing-report.md`; re-run the 5-case checklist after any pipeline change.

Below are the top open-source libraries (and combinations) that closely match ChatGPT’s markdown and code rendering fidelity, with reasoning and setup examples for each.
1. React Markdown + Remark/Rehype Plugins (Unified Ecosystem)
Using React Markdown (from the remark unified ecosystem) is a popular and safe choice. It converts markdown strings to React elements, and supports plugins for GFM, math, and syntax highlighting
github.com
github.com
. It avoids dangerous HTML by default and lets you override how elements render via a components prop
github.com
. Why it’s a match: This stack is highly extensible and close to ChatGPT’s behavior: you can enable GFM for tables, footnotes, etc., add math rendering, and plug in syntax highlighters. You can also wrap output in Tailwind’s typography styles or inject shadcn UI components for consistent design. Key libraries:
react-markdown – core renderer (supports CommonMark by default and GFM with a plugin)
github.com
.
remark-gfm – enables GitHub Flavored Markdown extras (tables, strikethrough, task lists, autolinks)
github.com
github.com
.
remark-math + rehype-katex – parse LaTeX in markdown and render to KaTeX for math support
github.com
.
Syntax highlighting options:
Shiki via rehype-pretty-code: For VS Code-quality highlighting. rehype-pretty-code (open-source) uses Shiki under the hood to produce “beautiful code blocks” with editor-grade accuracy
rehype-pretty.pages.dev
. It supports many languages/themes and works in SSR or client-side
rehype-pretty.pages.dev
. This yields output similar to ChatGPT’s styled code blocks.
Prism via rehype-prism-plus: A Prism-based rehype plugin with support for line numbers and line highlighting
npmjs.com
. Prism is lighter than Shiki and can be used if you prefer its themes.
Highlight.js via rehype-highlight: Uses highlight.js (through lowlight) to auto-detect and highlight code
github.com
. This is useful if you want automatic language inference – if no language is specified, highlight.js will guess and apply highlighting.
Setup Example: Install the packages: npm install react-markdown remark-gfm remark-math rehype-katex rehype-pretty-code shiki (or replace rehype-pretty-code with rehype-prism-plus or rehype-highlight as needed). Then configure your Markdown component:
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
// For Shiki highlighting:
import rehypePrettyCode from "rehype-pretty-code"; 

// Custom components (e.g., to override <a> or <blockquote> for styling or behavior)
import { CustomLink, CustomBlockquote } from "./YourShadcnComponents";

const markdownContent = props.content;  // The Markdown string to render

<ReactMarkdown 
  remarkPlugins={[remarkGfm, remarkMath]} 
  rehypePlugins={[rehypeKatex, [rehypePrettyCode, { /* options (theme, etc.) */ }]]}
  components={{
    a: ({node, ...props}) => <CustomLink {...props} />,            // your custom link component
    blockquote: ({node, ...props}) => <CustomBlockquote {...props} />,
    // Optionally override code block rendering if using a different highlighter
  }}
  className="prose dark:prose-invert"  /* Tailwind Typography for basic styling */
>
  {markdownContent}
</ReactMarkdown>
In this example, remarkGfm enables extended markdown syntax (tables, task lists, etc.) and remarkMath/rehypeKatex allow LaTeX formulas to render as math
github.com
. The rehypePrettyCode plugin will apply Shiki syntax highlighting to fenced code blocks
rehype-pretty.pages.dev
. We also pass custom components for links and blockquotes, which could be styled with Tailwind or use shadcn/ui elements. Tailwind Integration: Using Tailwind’s typography plugin, you can wrap the output in a container with the prose class for clean default styling
tx.shadcn.com
. For example, applying className="prose dark:prose-invert" to the container gives nicely formatted text, and you can further customize the theme (ChatGPT’s styling) via Tailwind CSS variables or custom classes. Code blocks from rehype-pretty-code will come with data attributes (or classes, if using Prism) that you can target in your CSS for colors matching ChatGPT’s theme (e.g. setting a background, rounded corners, copy button styles). Example Reference: The open-source ChatGPT-Next-Web project uses this approach – it integrates react-markdown with GFM, math, KaTeX, and a Prism highlighter to render AI responses
git.xiganglive.com
. That demonstrates the viability of this stack in a chat UI. For instance, their setup includes:
remarkPlugins: [RemarkGfm, RemarkMath] for tables and math,
rehypePlugins: [RehypeKatex, [RehypePrism, { ignoreMissing: true }]] for KaTeX math and Prism syntax highlighting
git.xiganglive.com
,
a custom <PreCode> component wrapping <pre> to add a copy-to-clipboard button on code blocks
git.xiganglive.com
git.xiganglive.com
.
This closely mimics ChatGPT’s code block functionality (including a copy button and nice highlighting).
2. Markdoc (Markdown + Custom Render Framework)
Markdoc is an open-source Markdown-based authoring framework from Stripe, designed for building rich documentation sites
github.com
. It’s more heavyweight than react-markdown, but offers a powerful, extensible system that can match ChatGPT’s output fidelity with some configuration. Why it’s a match: Markdoc parses Markdown (with its own parser) and allows custom nodes and tags in the content. You can define how anything renders – e.g., override the rendering of links, blockquotes, or even define custom syntactic extensions. It supports tables, lists, etc., and you can integrate external tools for syntax highlighting and math. If your project requires a high degree of control or custom markdown extensions, Markdoc is a solid choice. (Stripe uses it for their docs, which indicates it can handle complex content). Setup & Features: Markdoc operates in two phases: parse + transform the Markdown into an AST, then render it to React. For example:
import Markdoc from "@markdoc/markdoc";

const ast = Markdoc.parse(markdownContent);
const content = Markdoc.transform(ast, /* optional config (tags/nodes) */);
const element = Markdoc.renderers.react(content, React, { components: { /* custom component mappings */ } });
This is the basic usage
github.com
. To integrate in a React app, you’d typically compute element and render it inside your component. Markdoc allows registering custom components for any tag or node via the components mapping (similar to how MDX/remark allow custom renderers). For instance, you can map the Markdown <a> or <blockquote> to your own React components (with Tailwind or shadcn styles). Syntax Highlighting: Markdoc doesn’t do code highlighting by itself, but you can hook it up. A common approach is to define a custom renderer for fenced code blocks (“fence” node). For example, Markdoc’s docs show how to use PrismJS: you create a <Fence> React component that wraps code with Prism highlighting, and tell Markdoc to use that for rendering fences
markdoc.dev
. You could similarly use Shiki or highlight.js by processing the children (code string) in the Fence component. This gives you full control to replicate ChatGPT’s code style (e.g. you could add a language label or copy button in the Fence component as needed).
Markdoc Prism example: Markdoc’s documentation demonstrates adding Prism highlighting by defining a custom fence node and <Fence> component. The Fence component uses react-prism to render a <pre className="language-{lang}"> block with highlighted children
markdoc.dev
. Then the Markdoc config maps markdown fences to this component so that all code blocks are syntax-highlighted. (You can adapt this example to use any highlighter or theme, such as importing Prism CSS or applying Tailwind classes.)
Math: Markdoc doesn’t have built-in LaTeX parsing, but you could either treat $...$ as regular text (and post-process it), or extend Markdoc’s syntax. One approach is to parse the markdown through remark-math before Markdoc (since Markdoc can also accept an AST if you convert it). Alternatively, if math is critical, a simpler method might be to embed a custom Markdoc tag for math that uses KaTeX. In practice, using react-markdown with remark-math is simpler for math support; Markdoc would be chosen for its customization power. Tailwind/Shadcn Integration: Because Markdoc lets you specify rendering components, you can directly use shadcn/ui components in those. For example, you might map the markdown <table> to a shadcn-styled Table component, or wrap output in a Tailwind prose container for base styles. Markdoc doesn’t impose styling; you’ll add classes or components as needed in your renderers. This means you can achieve the same Tailwind styling consistency. When to use Markdoc: If your markdown content is complex, written by authors (perhaps with custom directives or components), or you need ultimate control over the rendering (beyond what remark plugins offer), Markdoc is ideal. It’s used to power Stripe’s own docs so it can handle large-scale content
github.com
. Keep in mind it requires more setup than react-markdown – you’ll maintain a schema of custom tags/nodes. For a straightforward ChatGPT-like chat, this might be overkill, but it’s a powerful option for documentation-heavy apps.
References: Markdoc’s official site and repository provide examples of custom syntax and rendering
github.com
markdoc.dev
. The open-source Markdoc framework (MIT licensed) can be found on GitHub
github.com
.
3. MDX (Markdown + JSX components)
MDX is another popular approach for rendering markdown in React, treating markdown as components. MDX allows you to mix JSX/React components directly in markdown files
mdxjs.com
, which means you can seamlessly substitute or augment rendering of elements. This can achieve ChatGPT-level fidelity and interactivity if you’re primarily dealing with static or pre-authored content (e.g. help articles or canned AI responses) rather than arbitrary user input. Why it’s a match: MDX is built on remark/rehype under the hood, so it supports all CommonMark and can be extended to GFM (tables, footnotes, etc.) with plugins
mdxjs.com
. You can configure it with the same plugins used above (remark-gfm, remark-math, rehype-katex, etc.) to get tables and math. For code blocks, you can use the same rehype-pretty-code or rehype-prism plugins at build time to highlight syntax. The big advantage is you can directly specify custom components for rendering within the MDX (or via an MDX provider for all occurrences of a tag), which is very flexible for customizing link, quote, or even injecting shadcn UI components (like callout boxes, etc.) in your markdown content. Setup Example: If using Next.js, you can integrate MDX using @next/mdx or next-mdx-remote. For instance, using Next.js App Router, you might configure the MDX loader with the desired remark/rehype plugins. The rehype-pretty-code docs even include a Next.js MDX config example
rehype-pretty.pages.dev
. In next.config.mjs:
import nextMDX from "@next/mdx";
import rehypePrettyCode from "rehype-pretty-code";
/** @type {import('rehype-pretty-code').Options} */
const options = { theme: "one-dark-pro", keepBackground: false /* etc. */ };

const withMDX = nextMDX({
  extension: /\.mdx?$/,
  options: {
    remarkPlugins: [require('remark-gfm'), require('remark-math')],
    rehypePlugins: [
      require('rehype-katex'),
      [rehypePrettyCode, options],
    ],
  },
});
export default withMDX({ /* your next.js config */ });
This setup tells Next’s MDX to use GFM, math, KaTeX, and Shiki highlighting (with a VSCode theme) for any MDX content
rehype-pretty.pages.dev
. You’d also import the KaTeX CSS globally for math. Then you can create MDX files or content and have them render with those features. To customize rendering, MDX provides an <MDXProvider> where you map HTML elements to your components (similar to react-markdown’s components prop). For example:
import { MDXProvider } from "@mdx-js/react";
import { CustomLink, CustomBlockquote } from "@/components"; 

const mdxComponents = {
  a: (props) => <CustomLink {...props} />,
  blockquote: (props) => <CustomBlockquote {...props} />,
  // ... code tag could be overridden if not using rehype-pretty-code
};

<MDXProvider components={mdxComponents}>
   <YourMDXContent /> 
</MDXProvider>
This way, all markdown links will use your shadcn-styled <CustomLink> component, etc. MDX basically compiles the markdown plus JSX into a React component, so it’s best suited for content known at build-time. If your “Connexus” project has some static markdown content or templates for AI answers, MDX could be used. However, for truly dynamic AI chat output at runtime, MDX is less convenient (you’d need to compile on the fly or use a runtime MDX parser). When to use MDX: If you have a documentation or blog section in your app (as many apps do) and want ChatGPT-level rendering fidelity, MDX with the appropriate plugins is excellent. It’s open-source and widely used, with lots of ecosystem support. Storybook Docs and many Next.js blogs use MDX, showing it can handle GFM and custom components
mdxjs.com
. Just note that MDX is more for static or pre-authored content; it shines when you want to include interactive React components alongside markdown text. Example: A blog built with Contentlayer + MDX in a shadcn/ui project demonstrates using Tailwind Typography (prose class) to style the MDX content out of the box
tx.shadcn.com
. The content includes all typographic elements (headings, lists, code, quotes) and they mention that code blocks can be styled with Highlight.js or Prism by default
tx.shadcn.com
. This confirms MDX can be configured for code highlighting and will look good with minimal effort, then customized further to match ChatGPT’s look (e.g., adjusting the prose theme or writing custom CSS for code block themes).
References and Source Links
React Markdown & Plugins: React Markdown GitHub README (features and usage)
github.com
github.com
; ChatGPT-Next-Web implementation (open source example of react-markdown with math, GFM, and Prism)
git.xiganglive.com
.
Shiki & rehype-pretty-code: Rehype Pretty Code documentation
rehype-pretty.pages.dev
 – describes using Shiki for “editor-grade” syntax highlighting in Markdown/MDX.
Highlight.js: rehype-highlight GitHub (uses lowlight for highlight.js)
github.com
.
Markdoc: Markdoc official site and examples (custom rendering and Prism integration)
github.com
markdoc.dev
.
MDX: MDX docs (GFM support and JSX in Markdown)
mdxjs.com
mdxjs.com
.
Tailwind Typography: Shadcn’s Tailwind typography usage (prose class for markdown content)
tx.shadcn.com
.
Citations

GitHub - remarkjs/react-markdown: Markdown component for React

https://github.com/remarkjs/react-markdown

GitHub - remarkjs/react-markdown: Markdown component for React

https://github.com/remarkjs/react-markdown

GitHub - remarkjs/react-markdown: Markdown component for React

https://github.com/remarkjs/react-markdown

GitHub - remarkjs/react-markdown: Markdown component for React

https://github.com/remarkjs/react-markdown

GitHub - remarkjs/react-markdown: Markdown component for React

https://github.com/remarkjs/react-markdown

Rehype Pretty Code | Rehype Pretty

https://rehype-pretty.pages.dev/

rehype-prism-plus - NPM

https://www.npmjs.com/package/rehype-prism-plus/v/0.0.1

rehypejs/rehype-highlight: plugin to highlight code blocks - GitHub

https://github.com/rehypejs/rehype-highlight

Build a blog using ContentLayer and MDX. | Taxonomy

https://tx.shadcn.com/guides/build-blog-using-contentlayer-mdx

ChatGPT-Next-Web/markdown.tsx at f18884118884dc445931ccc8e5c3a6e190eec14c - ChatGPT-Next-Web - Gitea: Hosted by xiganglive.com

https://git.xiganglive.com/xinyin025/ChatGPT-Next-Web/src/commit/f18884118884dc445931ccc8e5c3a6e190eec14c/app/components/markdown.tsx

ChatGPT-Next-Web/markdown.tsx at f18884118884dc445931ccc8e5c3a6e190eec14c - ChatGPT-Next-Web - Gitea: Hosted by xiganglive.com

https://git.xiganglive.com/xinyin025/ChatGPT-Next-Web/src/commit/f18884118884dc445931ccc8e5c3a6e190eec14c/app/components/markdown.tsx

GitHub - markdoc/markdoc: A powerful, flexible, Markdown-based authoring framework.

https://github.com/markdoc/markdoc

GitHub - markdoc/markdoc: A powerful, flexible, Markdown-based authoring framework.

https://github.com/markdoc/markdoc

Markdoc | Common examples

https://markdoc.dev/docs/examples

MDX: Markdown for the component era

https://mdxjs.com/

GitHub flavored markdown (GFM) - MDX

https://mdxjs.com/guides/gfm/

Rehype Pretty Code | Rehype Pretty

https://rehype-pretty.pages.dev/

Rehype Pretty Code | Rehype Pretty

https://rehype-pretty.pages.dev/

Build a blog using ContentLayer and MDX. | Taxonomy

https://tx.shadcn.com/guides/build-blog-using-contentlayer-mdx
All Sources

github

rehype-pretty.pages

npmjs

tx.shadcn

git.xiganglive

markdoc

mdxjs
