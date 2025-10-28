# Project Agent Rules — RedwoodSDK

## North Star
- Build **server-first** with **React Server Components** (RSC). Add `"use client"` only when interaction/state is required. Keep data fetching on the server. (Docs: RSC, Server Functions)
- Use **RedwoodSDK routing** (`defineApp`, `render`, `index`, `route`) and **Server Functions** (`"use server"`) for actions. **Do not** create Next.js API routes or Express servers.
- Keep business logic on the server; UI components stay thin. Client components only orchestrate UX.
- **Render what you see:** Every query must map to pixels on screen for the current request. Defer everything else.

### Motto — Ship Fast RSC: No Deadlocks. CSP-Safe. Hydration-Safe.
- **No top‑level I/O**: Never do DB/network at module scope. Initialize inside request middleware; the initializer must be idempotent (construct once, reuse).
- **SSR reads direct; actions via Server Functions**: Server components do raw server reads (e.g., `db`), but never call `"use server"` during SSR. Reserve `"use server"` for client islands/events.
- **CSP-safe client bootstrap**: Prefer external module scripts; if inlining, add the nonce from `requestInfo.rw.nonce`.
- **Hydration-safe UI**: Avoid `toLocale*`, `Date.now()`, `Math.random()` in hydrated trees. Pre-format values on the server and pass stable strings.
- **Component libs (Radix, etc.)**: Components that auto-generate IDs (Sheet/Dialog/Popover/Tooltip) must be gated to render only after mount on the client (or SSR a minimal stub). Prevents hydration `aria-controls` ID mismatches.
- **Wire navigation**: Always enable RSC client navigation via `initClient(initClientNavigation())`.
- **Expect pending RSC streams in dev**: A `?__rsc` request may stay Pending; the HTML document must complete quickly. Chrome may also show a provisional `document (pending)` when client navigation intercepts a link — this is expected in dev.

### Render What You See — Default Execution Mode
- SSR returns the minimum data required to paint the current route. Hidden panels, modals, or tabs **never** fetch during first paint.
- Defer additional data behind client islands (tabs, accordions, buttons) that call focused `"use server"` helpers.
- If a query powers multiple UI states, split it so each state requests only what it renders. No “preload just in case”.
- Prefer standard Redwood SDK primitives (links, buttons, Suspense placeholders). Avoid bespoke SPA state managers purely to orchestrate data.
- Instrument long-running helpers; if an island keeps fetching unseen data, treat it as a bug.

### CPU Budget Discipline
- Public SSR must finish ≤40 ms CPU; admin SSR ≤60 ms; server functions ≤25 ms. Any helper that crosses 80 ms must log a `[TRACE] … slow` entry with context.
- Memoize readiness helpers per request: `computeTherapistReadiness` / `computeOrgReadiness` must be invoked once per request (use a request-local cache or pass the snapshot payload forward).
- Persist hot-path snapshots (readiness, search card lists, billing refresh debounces) in Cloudflare KV with ≤30 s TTL to avoid recompute bursts. KV misses may fall back to SQL, but misses must be instrumented.
- Long-running side effects (billing refresh, Twilio, email) must run via `requestInfo.rw.waitUntil` and emit success/failure traces so the main request can return under budget.

### Admin Dashboard Contract
- SSR renders only the primary tab ("General"). All other rails (therapists, account, analytics) hydrate through client islands that call focused server actions.
- Server actions must log payload size and elapsed time via `trace(...)` and reuse sequential DB awaits (no `Promise.all` with `@/db`).
- `listOrgTherapistsForAdmin`, `listOrgPaymentsForAdmin`, and `getOrgAnalyticsSeries` return compact payloads, enforce moderator/admin auth, and respect 60s TTL caches.
- Organization readiness persists in `OrgReadinessCache` (30s TTL). Mutations affecting readiness must call `invalidateOrgReadiness` so fresh SSR reflects the latest state.
- Snapshot pipelines are retired; discovery rails read live metrics directly. Never reintroduce background snapshot recomputes.
- Payment instruction flows must call `issuePaymentInstructions` so the intent stores the instruction body, the account owner receives the onboarding grace SMS, and finance is alerted via the support WhatsApp number + support email.

## Prohibited Patterns
- ❌ Next.js conventions, `pages/api`, `app/api`, Express routers, client-side data fetching for server-owned data.
- ❌ Ad-hoc REST endpoints when a Server Function + RSC is simpler.
- ❌ Importing or calling files that contain `"use server"` from SSR (RSC) files. SSR must read via `db` or server-only helpers without the `"use server"` directive.

## House Style
- Files:
  - Pages (RSC): `src/app/pages/**/SomePage.tsx`
  - Client components: `src/app/components/**/Thing.tsx` with `"use client"`
  - Server functions per page/feature: `src/app/pages/<feature>/functions.ts`
  - Worker entry + routes: `src/worker.tsx`
  - Document: `src/app/Document.tsx`
  - Design specs: `designs/<slug>.md`
- Therapist media never autoplays silently; require an explicit user gesture before videos play and provide poster fallbacks so SSR stays deterministic.

## Lean Testing Discipline
- Default to test-first development: capture the expected behaviour with a failing automated test (unit, server, component, or e2e) before making code changes.
- Keep automation lightweight but high-signal: add a unit test for any new helper, a server-function test whenever logic changes, and a smoke component test if SSR output changes.
- `pnpm run test` =  guardrails. It must pass locally before pushing; if a suite cannot run, document the temporary skip and TODO in the PR.
- Tie scenarios back to designs: update the Tests Layer table with scenario IDs and reflect the same IDs in test names (`describe`/`it`). When a design spec changes, sync the related tests or mark the gap.
- Note quarterly outcomes in `docs/testing-report.md`; unfinished automation must be tracked there until closed.
### Client Bootstrap (required)
- `src/client.tsx` must initialize navigation: `initClient(initClientNavigation())`.
- `Document.tsx` must include the client script as an external module and attach the CSP nonce:
  - `<script type="module" src="/src/client.tsx" nonce={requestInfo.rw.nonce}></script>`

### Server Boundaries
- Call `setupDb(env)` inside the first request middleware and cache the client (idempotent). Do not `await` DB setup at module scope.
- Do not call `"use server"` functions from RSC during SSR; read directly from `db` or server-only helpers (no `"use server"` directive).
- SSR files must not import modules that contain `"use server"` (e.g., `src/app/pages/**/functions.ts`). Client islands trigger those functions.

## USETAL — Execution Contract
When the user says: **`plan feature: <name>`** (optionally include summary, acceptance criteria, and images),
you will:
1) **Scan the repo once** and produce an inventory JSON (pages, functions, routes, schema) using the globs below.
2) **Propose** UI, Schema, Errors, Tests, Architecture split (RSC vs client), and Logic (server functions).
3) **Assemble** a single Markdown spec at `designs/<slugify(name)>.md`.
4) If asked, scaffold stubs (files & routes) that match the spec.

### Inventory Globs (RedwoodSDK)
- Pages: `src/**/*.{page,layout,tsx,jsx}`
  - Mark `"client"` if file contains `"use client"`, else `"server"`.
- Server functions: any file containing `"use server"` (typical: `src/**/functions.{ts,tsx}`)
- Routes: search `route(` calls in `src/**/*.{ts,tsx}`
- Schema: Prisma/Drizzle models or SQL in `/migrations` or `db/schema.prisma`

### Output Tables
- **UI Layer:** Screen | Purpose | Owns State? | Existing? (Y/N)
- **Schema Layer:** Entity | Fields | Validation | Status (exists/new/modify)
- **Errors Layer:** Error | Message | Recovery
- **Tests Layer:** Scenario | Steps | Expected Result | Layer
- **Architecture Layer:** File/Component | RSC vs `"use client"` | Move/Why
- **Logic Layer:** File path | Function | Trigger (route/form) | Access policy

## Redwood References (for the model)
- RSC defaults + `"use client"` for interactivity: docs.rwsdk.com/core/react-server-components/
- Server Functions + `requestInfo.ctx`: docs.rwsdk.com/core/react-server-components/
- Router API & `defineApp/route/index/render`: docs.rwsdk.com/getting-started/quick-start/
- Client hydration/navigation: docs.rwsdk.com/reference/sdk-client/

## Prompts You Respond To
- `plan feature: <name>` — read `docs/USETAL.md` for the step graph and follow it exactly. Save output to `designs/<slug>.md`.
- `scaffold feature: <name>` — create minimal files matching the plan (no Next.js/Express). Ask before running shell unless in full-auto.

## Dev Guidance — Minimal-First RSC
- Minimal-first RSC: On initial render, fetch only what’s needed to paint the screen and authorize. Keep server components small and focused.
- Delegate later: If more data/UI is needed after load, use a client component that calls a Server Function. Keep heavy RSC to a minimum.
- Server-only logic: Business rules and writes live in Server Functions ("use server"); client components only orchestrate UX.
- Hydration discipline: Pre-format dates/numbers on the server; avoid locale-sensitive client formatting in initial render.
- Navigation: Use `initClientNavigation()` so link clicks stream and swap content without full reloads.
  - First paint rules: Home renders at most 1–2 rails; each rail shows ≤ 12 items. Paging/“View more” is a client island that fetches the next page (5–12 items) via a Server Function.

## Server/DB Efficiency
- Batch operations: Replace per-item loops with a single transaction using `IN` clauses; restore or delete multiple rows together.
- Workers/D1: Avoid `Promise.all` for DB calls within a single request. Prefer one SQL with CTEs or strictly sequential awaits to prevent adapter contention/hangs.
- Efficient slugs: Avoid iterative DB checks; fetch matching slugs once and compute the next in memory, or rely on a unique constraint and retry.
- Robust errors: Wrap all DB calls in `try/catch`; return structured errors from Server Functions and log failures with context.
- Single init: Instantiate shared resources (e.g., Prisma client) once per process and reuse; do not rebuild per request.
- Pre-aggregate: Prefer joins, CTEs, or separate precomputed queries for counts/media over correlated subqueries in lists/feeds.
- Guard N+1: Audit for sequential query loops and consolidate with batched `IN` queries or `include`/`select` joins.
- Graceful fallbacks: Provide meaningful responses or UI states when data is missing or a query fails.

## Edge CPU Guardrails
- SSR must never call third-party REST/GraphQL APIs directly. If external metadata is required, hydrate it ahead of time into first-party stores (D1, KV) and read from there during render.
- Budget every SSR request to finish within 8–10 ms of CPU on bundled workers; add `trace()` markers around blocks that approach 50 ms to catch regressions early.
- Cache media and auxiliary blobs in Cloudflare KV (or another edge cache) and invalidate on write. Durable Objects are reserved for strong-consistency coordination; do not put them on the hot render path.
- Heavy or speculative work (e.g., swipe prefetching) belongs in client islands and must respect `navigator.connection.saveData`, limit concurrency to 1, and skip when payloads include video streams.
- Missing cache entries must trigger asynchronous refreshes (e.g., `ctx.waitUntil`) instead of blocking SSR.

Tech notes
- Prefer small payloads across RSC boundaries; normalize counts to `Number(...)`.
- Lazy‑load modals/editors and heavy embeds; load detail views as client “islands”.
- Keep feeds/lists cheap; fetch detail/metrics on demand.
- Dev: ignore `.wrangler/**` in Vite watch; persist local D1 so migrations apply.

### Troubleshooting Playbook (Dev)
- Pending document? Check if it is `?__rsc` (expected to stay open). The plain HTML document should be 200 and finish. Chrome may also show a provisional `document (pending)` entry when client navigation intercepts a link — this is expected.
- Blank page, no console errors? Confirm client bootstrap loads and CSP isn’t blocking scripts (nonce on script tag).
- Hanging SSR? Ensure no top-level DB/network awaits; move setup to request middleware.
- Hydration mismatch? Remove client `toLocale*`/non-determinism; pass preformatted strings from the server. If mismatch mentions `aria-controls` or `radix-…`, gate the Radix component until client mount.
- Self-fetch deadlock? Don’t call `"use server"` functions during SSR.

## Workers/D1 Guardrails
- No intra-request DB concurrency: Avoid `Promise.all` for DB calls on Cloudflare Workers (D1/Prisma). Use sequential awaits or fold into a single statement with CTEs.
- Keep writes short-lived and isolated; do not hold locks around unrelated reads.
- Defer side-effects (emails, notifications, analytics) using fire-and-forget or `requestInfo.rw.waitUntil` where available; never block SSR on these.
- Ensure SSR is deterministic and fast: pre-format strings on the server, avoid locale-sensitive formatting in client trees. In dev, D1/Prisma can deadlock if multiple queries run concurrently within one request — prefer one SQL/CTE or strictly sequential awaits.
- Readiness helpers must use the shared snapshot loaders (`loadTherapistReadinessSnapshot`, `loadOrgReadinessSnapshot`) and reuse cached payloads; never re-query media, billing, or counts inside loops or islands.
- Any list or search helper that returns >12 rows must be backed by KV caching or a precomputed snapshot and stream to the client in slices; do not rerun the same SQL more than once per request without invalidation.

## Tooling/CI Guardrails
- Lint checks (pre-commit/CI):
  - Block imports of `src/**/functions.{ts,tsx}` (files that contain `"use server"`) from SSR files (files without `"use client"`).
  - Block `Promise.all([` in files that import `@/db` (except in explicitly allowed utility scripts).
  - Block top-level `await` on DB/network in any module.
  
- Guard tests (in repo): run `npm run test:all` in CI. The suite enforces:
  - `no-promise-all-with-db`: forbid `Promise.all(` in any file that imports `@/db`.
  - `no-import-use-server-into-ssr`: forbid importing any `*/functions` module (contains `"use server"`) from SSR files.
- PR template checklist:
  - [ ] SSR reads use direct `db` access; no `"use server"` calls/imports in SSR.
  - [ ] No `Promise.all` for DB calls within a single request path; sequential or CTE.
  - [ ] Side-effects do not block SSR; fanout/work is deferred.
  - [ ] CSP nonce is attached to the client bootstrap in `Document.tsx`.
  - [ ] Admin/list pages use server pagination (page/size) with minimal selects; no deep includes in SSR.
  - [ ] Search SSR ≤ 12 items, cover-only media; tag augmentation deferred to a client island.
  - [ ] Staging/production Workers set `usage_model: "unbound"`.

## Observability
- Add optional debug timing around SSR sections to log queries >300ms in dev.
- In dev, expect `?__rsc` to remain pending; the HTML document load must complete quickly.
- Server actions should log `[TRACE]` markers for cache hits/misses and payload byte sizes so we can audit CPU usage in Workers.


## SPA Mode (SPAR) — How to think & build
**Goal:** On a single page (e.g. LMS “Inputs”), only the clicked part re‑renders while SSR, auth, and data integrity stay server‑first.

**Rules**
1) **URL maps to page; panel maps to state.** Keep one route per screen; swap inner **panel/part** via a `"use client"` island (tabs/accordion/routerless state).
2) **Data writes = Server Function calls.** Client islands never talk to the DB or secrets directly. They invoke `"use server"` functions that run inside the same Worker and use `requestInfo.ctx` for auth/DB.
3) **Reads prefer the server; hydrate only the delta.** The page RSC renders section/parts metadata; the active part’s heavy content is fetched by a Server Function on demand (or lazily streamed via `<Suspense>` from a small server sub‑tree).
4) **Auth lives on the edge.** Check auth/entitlement in the Server Function (and again on server sub‑trees) using `ctx`. Never trust client flags.
5) **No extra API layer.** If you need an endpoint‑like hook (webhook/health), declare it with `route('/api/...')` in `worker.tsx`—do **not** create ad‑hoc servers.

**Why this is SPA-ish but still fast**
- **SSR stream first paint** from edge POPs; then the island hydrates and swaps **only** the active panel.
- **Server Functions** keep privileges server‑side and reuse the Worker’s `ctx` (DB, KV, auth), avoiding extra origin hops.
