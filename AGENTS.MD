# Project Agent Rules — Branching Chat

## North Star
- Build a server-first, non-linear branching chat MVP with RedwoodSDK React Server Components (RSC). UI islands only orchestrate interactions; all branching, persistence, and OpenAI calls run on the server.
- Use RedwoodSDK routing (`defineApp`, `route`, `render`, `index`) and Server Functions (`"use server"`) for mutations. No ad-hoc servers or Next.js patterns.
- Fetch only the data needed to paint the current screen. Render what you see; defer hidden panels to focused client islands.
- Keep the codebase CSP-safe and hydration-safe. Prefer deterministic values, and ensure the client bootstrap script uses the request nonce.

## Core Experience
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
After completing each task, append to progress.txt:
- Task completed and PRD item reference
- Key decisions made and reasoning
- Files changed
- Any blockers or notes for next iteration
Keep entries concise. Sacrifice grammar for the sake of concision. This file helps future iterations skip exploration.
Keep changes small and focused:
- One logical change per commit
- If a task feels too large, break it into subtasks
- Prefer multiple small commits over one large commit
- Run feedback loops after each change, not at the end
Quality over speed. Small steps compound into big progress.
When choosing the next task, prioritize in this order:
1. Architectural decisions and core abstractions
2. Integration points between modules
3. Unknown unknowns and spike work
4. Standard features and implementation
5. Polish, cleanup, and quick wins
Fail fast on risky work. Save easy wins for later.


## Testing & QA
- Formal automated suites are deferred for MVP, but every new helper or server function must include console traces and manual validation notes covering happy-path and failure states.
Before committing, run ALL feedback loops:
1. TypeScript: pnpm types (must pass with no errors)
2. Tests: npm run test (must pass)
3. Lint: npm run lint (must pass)
Do NOT commit if any feedback loop fails. Fix issues first.
This codebase will outlive you. Every shortcut you take becomes
someone else's burden. Every hack compounds into technical debt
that slows the whole team down.

You are not just writing code. You are shaping the future of this
project. The patterns you establish will be copied. The corners
you cut will be cut again.

Fight entropy. Leave the codebase better than you found it.

## Deployment Notes
- Secrets (OpenAI keys, Durable Object IDs) live in Cloudflare environment bindings; never hard-code them.
- Use Wrangler deploys with `usage_model: "unbound"` only if the workload requires it; otherwise keep defaults.
- Ensure the Document component attaches the CSP nonce and that the HTML shell finishes quickly even when RSC streams remain pending.
