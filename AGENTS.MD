# Project Agent Rules — Connexus Branching Chat

## North Star
- Build a server-first, non-linear branching chat MVP with RedwoodSDK React Server Components (RSC). UI islands only orchestrate interactions; all branching, persistence, and OpenAI calls run on the server.
- Use RedwoodSDK routing (`defineApp`, `route`, `render`, `index`) and Server Functions (`"use server"`) for mutations. No ad-hoc servers or Next.js patterns.
- Fetch only the data needed to paint the current screen. Render what you see; defer hidden panels to focused client islands.
- Keep the codebase CSP-safe and hydration-safe. Prefer deterministic values, and ensure the client bootstrap script uses the request nonce.

## Core Experience (Scope v3)
- **Branch creation:** Select any assistant message span → “Create Branch”. New branch inherits context up to the selection, optionally capturing the span metadata.
- **Branch navigation:** Split view (parent left, child right) with resizable panes. Provide tree/breadcrumb navigation, jump-to-root, and deep nesting support.
- **Conversation management:** CRUD for branches (rename, archive, delete with confirmation), independent composer per branch, and per-branch token/cost tracking.
- **State persistence:** Durable Objects store conversation graphs and messages. Support single-user reload resilience plus JSON export/import.
- **Chat engine:** OpenAI streaming responses per branch, with branch-specific model/settings overrides.
- **UX & A11y:** Keyboard shortcuts for branching, navigation, and split toggles. Visual accents clarify branch context.
- Meet the MVP’s non-functional targets: 95th percentile branch switch render < 120 ms with ≤500 messages total, and no data loss on normal reload paths.

## State & Persistence
- Cloudflare Durable Objects are the authoritative store for conversations, branches, and messages. Model the schema in TypeScript (see `docs/scope_v3.md`) and reuse shared helpers; do not introduce D1.
- Initialize Durable Object bindings inside request middleware; memoize per-request handles to avoid reconnection overhead.
- Writes must be sequential and short-lived. Handle retries and emit structured errors; never block UI rendering on long-running side effects.
- Expose export/import through server functions that serialize the DO snapshot and validate inputs before mutating state.

## Server & Client Boundaries
- Server components read directly from Durable Objects or server-only helpers. Do not import modules marked with `"use server"` into SSR trees.
- Declare server actions in `src/app/pages/<feature>/functions.ts` with `"use server"`. Client components trigger them for writes and focused reads.
- No top-level I/O: set up caches, DO stubs, and OpenAI clients inside middleware or helper factories that are idempotent.
- Keep client modules thin: orchestrate suspense boundaries, pane resizing, keyboard shortcuts, and optimistic UI only. Avoid business logic on the client.
- Always enable client navigation: `src/client.tsx` must call `initClient(initClientNavigation())`.
- Gate any component library feature that auto-generates IDs until after mount (Radix, shadcn dialogs, etc.) to avoid hydration mismatches.

## Performance & Observability
- Budget each SSR render to stay within 40 ms CPU on edge. Flag helpers that approach 80 ms with `[TRACE] … slow` logs including branch/conversation identifiers.
- Log cache hits/misses and payload sizes for Durable Object reads/writes and OpenAI responses. Include branch IDs for observability.
- Stream OpenAI responses to the client; surface partial results via suspense boundaries or streaming UI primitives.
- When DO operations fail, surface graceful empty/error states and record telemetry for retries. Never leave the UI pending indefinitely.

## Prohibited Patterns
- ❌ Next.js conventions (`pages/api`, `app/api`), Express routers, or bespoke REST endpoints when a Server Function suffices.
- ❌ Client-side data fetching for server-owned data, including direct Durable Object access from the browser.
- ❌ Importing `"use server"` modules into SSR components.
- ❌ D1-specific helpers or migrations; this project does not use D1.
- ❌ Blocking top-level awaits or parallel `Promise.all` against Durable Objects within a single request path.

## House Style
- Pages (RSC): `src/app/pages/**/SomePage.tsx`
- Client components: `src/app/components/**/Thing.tsx` with `"use client"`
- Server functions per feature: `src/app/pages/<feature>/functions.ts`
- Worker entry + routes: `src/worker.tsx`
- Document shell: `src/app/Document.tsx` (ensure `<script type="module" src="/src/client.tsx" nonce={requestInfo.rw.nonce}></script>`)
- Design specs: `designs/<slug>.md`
- Keep styles deterministic; avoid inline randomness or locale-dependent formatting in hydrated trees.

## Testing & QA
- Formal automated suites are deferred for MVP, but every new helper or server function must include console traces and manual validation notes covering happy-path and failure states.
- When practical, add lightweight unit or integration tests for core branching helpers to prevent regressions.
- Document any untested edge cases in `docs/testing-report.md` with follow-up actions.

## Deployment Notes
- Secrets (OpenAI keys, Durable Object IDs) live in Cloudflare environment bindings; never hard-code them.
- Use Wrangler deploys with `usage_model: "unbound"` only if the workload requires it; otherwise keep defaults.
- Ensure the Document component attaches the CSP nonce and that the HTML shell finishes quickly even when RSC streams remain pending.
