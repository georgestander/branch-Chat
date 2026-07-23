# Project Agent Rules — Branch Chat / RedwoodSDK

## North Star
- Build a server-first, non-linear branching chat application with RedwoodSDK React Server Components (RSC).
- RSC is the default. Add `"use client"` only where browser interaction or local UI state is required.
- Use RedwoodSDK routing (`defineApp`, `render`, `index`, `route`) and Server Functions (`"use server"`). Do not introduce Next.js conventions, Express, or a parallel application server.
- Keep branching, authorization, persistence, model orchestration, and other business rules on the server. Client islands orchestrate interaction only.
- Fetch only the data needed to authorize and paint the current screen. Load hidden panels and expensive detail through focused client islands or small streamed server subtrees.

### Motto — Fast RSC. No deadlocks. CSP-safe. Hydration-safe.
- **No top-level I/O:** Never perform database, Durable Object, storage, model, or network work at module scope. Initialize resources inside request middleware or idempotent request-scoped factories.
- **SSR reads directly:** Server components read through server-only helpers. They never call or import a module containing `"use server"` during SSR.
- **Actions use Server Functions:** Client events call Server Functions for mutations and focused reads. Do not add endpoint-shaped routes when a Server Function is the simpler boundary.
- **CSP-safe bootstrap:** Use the external client module script and attach `requestInfo.rw.nonce`.
- **Hydration-safe output:** Avoid `Date.now()`, `Math.random()`, `crypto.randomUUID()`, `toLocale*`, and environment-dependent formatting in hydrated render paths. Produce stable values on the server and pass strings to the client.
- **Client navigation is required:** `src/client.tsx` must call `initClient(initClientNavigation())`.
- **Pending RSC streams can be normal:** A `?__rsc` request may remain pending in development; the plain HTML document must still complete quickly.

## Core Experience
- **Branch creation:** Select any assistant-message span and create a child branch. The child inherits context through the selected message and records source message/span metadata when available.
- **Branch navigation:** Support deep nesting, parent context, breadcrumbs/tree navigation, jump-to-root, and explicit parent/child comparison without losing the active branch.
- **Conversation management:** Support rename, archive, delete with confirmation, independent branch composers, and per-branch model/usage settings.
- **State persistence:** Durable Objects store canonical conversation graphs and messages. Preserve reload resilience and JSON export/import.
- **Chat engine:** Stream model responses per branch and preserve branch-specific settings and tool state.
- **UX and accessibility:** Preserve keyboard navigation, visible focus, understandable branch context, and recovery from streaming or persistence failures.
- **Performance target:** Keep p95 branch-switch visible completion below 120 ms with at most 500 messages total, measured on representative local data.

## RedwoodSDK Boundaries

### Routing and pages
- Define routes in `src/worker.tsx` with RedwoodSDK router primitives.
- Pages are RSC by default and live under `src/app/pages/**`.
- Route handlers are reserved for transport-shaped boundaries such as SSE, uploads, health checks, or external callbacks. Do not build a bespoke REST layer for ordinary application reads and writes.
- Route and Server Function entry points must authorize independently. Never trust client state or hidden controls as authorization.

### Server Functions
- Declare feature actions in `src/app/pages/<feature>/functions.ts` with `"use server"`.
- Validate and normalize every external input before it reaches persistence, model calls, or storage.
- Return structured, actionable errors. Do not swallow failures or leave the UI pending indefinitely.
- Return enough canonical state from a mutation for immediate client reconciliation. Do not force a full RSC route refresh merely to rediscover the record just created or changed.
- Use optimistic UI only for reversible operations and roll it back when the Server Function fails.

### Server-only helpers
- Put SSR-safe reads and shared server logic in modules without `"use server"`, typically under `src/app/shared/**`.
- Server components may import those helpers directly.
- Do not import `src/app/pages/**/functions.ts` into an RSC file.
- Construct Durable Object stubs, storage clients, model clients, and caches inside middleware or request-scoped helper factories. Reuse them at the same authorization scope.

### Client islands
- Client components live under `src/app/components/**` and start with `"use client"`.
- Keep them focused on selection, pane resizing, keyboard shortcuts, optimistic reconciliation, streaming display, modal state, and other browser-only behavior.
- Do not access Durable Objects, R2, model providers, secrets, or server-owned data directly from the browser.
- Prefer one server-rendered route with local panel state over adding routes for every tab, drawer, or branch-context panel.
- Gate libraries that generate unstable IDs or browser-dependent markup until after mount when necessary to prevent hydration mismatches.

## State and Persistence
- `ConversationStoreDO` is authoritative for one conversation graph, its branches, messages, and retrieval artifacts.
- `ConversationDirectoryDO` is authoritative for conversation-list metadata.
- `AccountDO` is authoritative for account-scoped preferences and credential metadata allowed by the current architecture.
- Do not introduce D1 for conversation state. Extend the existing Durable Object model and shared clients unless the task explicitly changes the persistence architecture.
- Resolve Durable Object bindings in request middleware and memoize clients per request. Do not rebuild the same stub repeatedly in one request tree.
- Keep writes sequential, isolated, and short-lived. Never hold a write open around a model stream or unrelated side-effect.
- Avoid parallel `Promise.all` calls against the same Durable Object in one request path. Prefer one object method, a single storage transaction where supported, or explicit sequential awaits.
- Validate a complete import snapshot before mutating state. Export must produce a portable, versioned representation.
- Treat local Miniflare persistence as real user data. Keep its location out of Git, document backup/reset behavior, and never delete it as routine build cleanup.

## Request and Performance Contract
- Define performance by user-visible completion: initial screen paint, branch switch, message send to first token, and message send to reconciled final state.
- Before changing a critical path, map the complete flow: browser event, RSC/Server Function request, auth, Durable Object calls, R2 calls, model/tool calls, streaming, persistence, and UI reconciliation.
- Count serialized remote/storage round trips. Handler duration alone is not the user experience.
- Reuse authorization and conversation data already established in the same request tree and at the same scope.
- Do not build serial read ladders, per-message storage loops, N+1 reads, unbounded graph traversal, or repeated authorization reads.
- Fetch message collections and branch summaries in bounded, set-shaped operations. Defer inactive branch detail until requested.
- Do not block a primary read or write on analytics, logging fanout, notifications, or other non-essential work. Use `requestInfo.rw.waitUntil` when the runtime offers a safe deferred path.
- Stream model output incrementally. Persist the final canonical assistant state once, then reconcile the client without a redundant full-route refresh.
- Log `[TRACE]` events with request, conversation, and branch identifiers, cache outcomes, payload sizes, model/tool timing, and structured failure context. Never log message content, credentials, tokens, or attachment previews.
- Flag unexpectedly slow helpers with `[TRACE] ... slow`; keep edge SSR CPU below 40 ms where practical and investigate paths approaching 80 ms.
- Measure before and after on the same representative fixture. Report p50 and p95 for load and action-to-visible-state timing, plus data-integrity and reload checks. Never relax a budget merely to report success.

## Streaming and Tooling
- Keep the SSE transport bounded and explicit: start, incremental output, reasoning/tool progress where supported, completion, and error.
- Establish the subscriber before beginning model output when needed to prevent lost first deltas.
- Every stream must terminate or surface a recoverable error. Clean stale stream identifiers after completion, interruption, or reload.
- Treat web search, uploads, retrieval, and other tools as server-owned capabilities. Validate model support and fail with a clear recovery path.
- External source links must use real source URLs and safe new-tab behavior.
- Never persist or display raw provider credentials. Secrets belong in local or Cloudflare secret bindings appropriate to the selected runtime mode.

## CSP, Security, and Hydration
- `src/app/Document.tsx` must load `/src/client.tsx` as an external module with `nonce={requestInfo.rw.nonce}`.
- Production CSP must not add `unsafe-eval` or broad script exceptions to work around a component issue.
- Sanitize rendered Markdown and tool output before inserting HTML.
- Enforce upload limits from bytes actually received, not only `Content-Length`.
- Keep auth and conversation ownership checks at every public server boundary.
- Fail closed when required auth or trust configuration is missing.
- Keep UI markup deterministic between SSR and hydration. Pre-format dates, numbers, costs, and labels on the server when they appear during initial render.

## Prohibited Patterns
- ❌ Next.js `pages/api`, `app/api`, route conventions, or Next-specific server actions.
- ❌ Express, Hono, or another application router alongside RedwoodSDK.
- ❌ Ad-hoc REST endpoints for ordinary reads or mutations that fit an RSC/Server Function boundary.
- ❌ Client-side fetching for server-owned initial data or direct browser access to Durable Objects/R2.
- ❌ Importing or calling a `"use server"` module from an RSC/SSR file.
- ❌ Top-level database, Durable Object, storage, or network I/O.
- ❌ Intra-request concurrency against the same Durable Object or storage transaction.
- ❌ Per-message or per-branch N+1 storage reads.
- ❌ Full-route refresh after a mutation when the Server Function can return canonical reconciliation state.
- ❌ Non-deterministic or locale-dependent initial hydrated markup.
- ❌ D1 helpers or migrations for the conversation graph.
- ❌ Logging user content, secrets, access tokens, API keys, or private attachment excerpts.

## Visual Language and Design Quality
- Read `designs/visual-language.md` before designing or changing a user-facing surface. Treat it as the durable visual contract for both the web and desktop renderers.
- Before implementation, state a short visual thesis, content hierarchy, and interaction plan. For an existing surface, explain how the change extends the current visual language.
- Start from the product workflow and information hierarchy, not a component-library demo or generic SaaS template. Do not default to centered hero copy, three interchangeable cards, repeated full-width marketing sections, pricing tables, logo clouds, or FAQ accordions unless the content genuinely requires them.
- Use composition, alignment, scale, whitespace, typography, and contrast before adding containers or decoration. A card must represent a meaningful grouped object or interaction; if plain layout preserves comprehension, do not wrap it in a card.
- Do not reach for framework-default purple, indigo, blue, slate, gradients, oversized radii, or drop shadows because they are convenient defaults. Use the established tokens and semantic branch-lineage colors.
- Keep one intentional radius, elevation, typography, spacing, and color vocabulary across a surface. Do not improvise a new visual system inside one feature.
- Preserve the flat, single-boundary surface style. Shadows are reserved for temporary overlays that need depth, such as menus, popovers, dialogs, and dragged elements—not ordinary panels or content cards.
- Treat typography as a design decision. Inherit the current product typography when extending an existing surface; do not introduce a fashionable display font or default framework font without a documented reason.
- Write concrete product copy. Reject vague AI-marketing phrases such as “Empower,” “Unlock,” “Transform,” “Seamless Integration,” and “Built for modern teams” unless they refer to a specific, supportable product fact.
- Use animation only to explain spatial change, hierarchy, progress, or causality. Do not add ornamental motion merely to make a screen feel “premium.”
- When a visual reference or approved design exists, compare against the actual artifact before implementation and during review. Do not reduce a material mismatch to optional polish.
- Visually verify UI work in a real browser or packaged desktop app at representative viewport sizes and in every affected theme. Capture screenshots and review hierarchy, density, alignment, overflow, focus, contrast, loading, empty, error, and interaction states.
- Before declaring UI work complete, explicitly ask: does this resemble a starter template, framework example, or generic AI-generated interface? If so, revise the underlying composition or vocabulary rather than adding more decoration.

## House Style
- Pages/RSC: `src/app/pages/**/SomePage.tsx`
- Client islands: `src/app/components/**/Thing.tsx` with `"use client"`
- Feature Server Functions: `src/app/pages/<feature>/functions.ts`
- SSR-safe server helpers: `src/app/shared/**`
- Worker entry and routes: `src/worker.tsx`
- Document shell: `src/app/Document.tsx`
- Shared domain model: `src/lib/conversation/**`
- Durable Objects: `src/lib/durable-objects/**`
- Design specifications: `designs/<slug>.md`
- Durable visual contract: `designs/visual-language.md`
- Prefer simple, domain-named functions and explicit return types at server/client and persistence boundaries.
- Preserve existing behavior unless the task intentionally changes it. Keep unrelated refactors out of focused changes.

## Development Troubleshooting
- **Pending request:** Check whether it is `?__rsc`; that stream may stay open. The plain HTML request must return and finish.
- **Blank page:** Confirm `/src/client.tsx` loaded, the CSP nonce is present, and the console has no hydration/bootstrap failure.
- **Hanging SSR:** Look for top-level I/O, an SSR import of `functions.ts`, self-fetching a Server Function, or a serialized Durable Object call that never resolves.
- **Hydration mismatch:** Remove time-, randomness-, locale-, viewport-, or browser-dependent initial rendering. Pass stable server-produced values.
- **Missing first stream tokens:** Verify the SSE subscription handshake happens before model streaming begins.
- **Stuck pending response:** Verify completion/error events clear both in-memory and session-persisted stream state.
- **State missing after restart:** Confirm the expected local `.wrangler` persistence path and that no cleanup command removed it.
- **Branch switch regression:** Test root, child, deep child, archived branch, compare-open, and reload paths against representative message counts.

## Testing and QA
- Every new helper or Server Function needs automated coverage where practical plus trace/manual validation notes for happy and failure paths.
- Test behavior and contracts, not implementation trivia.
- For UI or streaming changes, run a real browser smoke covering navigation, send, incremental output, completion reconciliation, reload persistence, and error recovery.
- For performance-sensitive changes, use representative graph sizes and record p50/p95 evidence for the affected user-visible flow.
- Before committing, run all feedback loops:
  1. `pnpm types`
  2. `npm run test`
  3. `npm run lint`
- Do not commit with a failing gate. Fix the cause; never weaken types, silence warnings, remove tests, or hide errors.

## Work and Commit Discipline
- Inspect the current path, patterns, Git status, and smallest relevant verification before editing.
- Keep one logical concern per change and per commit.
- Commit immediately after that concern passes all required feedback loops.
- Stage only files belonging to the logical change. Preserve unrelated user or agent work.
- Break large work into architectural decisions, integration points, risky spikes, standard implementation, then polish—in that order.
- Prefer the smallest safe change that solves the real problem. Avoid speculative frameworks, dependencies, schema changes, auth changes, and global mutable state.

## Deployment and Local Runtime
- Keep secrets in Cloudflare bindings or local uncommitted runtime configuration; never hard-code them.
- Preserve Durable Object and R2 binding parity between local and deployed modes.
- Local development data is persistent user data, not disposable build output. Document explicit reset and backup operations.
- Use the repository’s existing `pnpm release` path for deployment; do not invent a parallel deployment workflow.
- Use `usage_model: "unbound"` only when workload measurements justify it.
- Before considering a deployment healthy, verify the HTML shell, client bootstrap, RSC navigation, authentication, Durable Object reads/writes, streaming, and reload persistence.

This codebase will outlive the current task. Establish patterns worth copying, keep boundaries explicit, and leave the system easier to reason about than you found it.
