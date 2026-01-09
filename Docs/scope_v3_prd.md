# Scope v3 PRD (Derived from gaps/extras tracker)

This PRD converts `Docs/scope_v3_gaps_extras.md` checklist items into implementation-ready tasks.

Conventions:
- `pass:false` means the task is not yet shipped/verified.
- `steps` includes delivery + manual validation guidance.

---

category: In-scope gaps
description: Branch-level CRUD (rename, archive, delete with confirmation) for branches (not just whole conversations).
steps:
- Add server functions to rename/archive/delete a branch and persist changes in the Durable Object.
- Add UI affordances per-branch (context menu or actions panel) with confirmation for destructive actions.
- Ensure archived branches are hidden by default but discoverable (e.g., archived filter/section) and are not writable.
- Log structured DO write events (branchId, conversationId, op, payloadBytes) and surface graceful error states.
- Manual validation: rename persists on reload; archive hides branch; delete requires confirmation and removes from tree without breaking navigation.
pass:false

---

category: In-scope gaps
description: Independent composer per branch (parent column is read-only today).
steps:
- Implement per-branch composer state (draft text, send disabled state) scoped to the selected branch.
- Add server function to append a user message to the active branch and trigger the assistant response for that branch.
- Update split-view so each pane has its own active branch and composer (no cross-pane draft leakage).
- Preserve drafts across short navigations (client state) without persisting to DO unless explicitly saved.
- Manual validation: type in both panes independently; sending in one branch does not mutate the other pane’s draft/messages.
pass:false

---

category: In-scope gaps
description: Breadcrumbs + jump-to-root navigation (tree exists but no breadcrumb/jump controls).
steps:
- Add a breadcrumb UI showing branch ancestry from root to current selection.
- Add a “jump to root” control that selects the root branch and scrolls to the top message.
- Ensure deep nesting is supported with truncation/overflow behavior for long breadcrumb paths.
- Wire navigation to server-rendered data needs (fetch only what’s needed to paint the current view).
- Manual validation: deep branch shows correct ancestry; jump-to-root is instant and stable across reload.
pass:false

---

category: In-scope gaps
description: Keyboard shortcuts for branching, navigation, and split-view toggles.
steps:
- Define and document shortcut map (create branch, focus left/right pane, next/previous sibling, toggle split, jump-to-root).
- Implement shortcuts in a client island with focus/textarea safety (do not hijack standard editing shortcuts).
- Ensure shortcuts work with screen readers and do not rely on non-deterministic IDs.
- Add visible shortcut hints in menus/tooltips where applicable.
- Manual validation: all shortcuts work on macOS/Windows layouts; no interference while typing in composer.
pass:false

---

category: In-scope gaps
description: Per-branch model/settings overrides persisted in Durable Object (model, temperature, reasoning effort, system prompt).
steps:
- Extend branch schema in TypeScript to include model/settings overrides with sensible defaults.
- Add server functions to update overrides and persist to the Durable Object sequentially and quickly.
- Update the chat engine to read effective settings per branch when making model calls.
- Add UI controls for overrides per branch with clear “inherit vs override” behavior.
- Manual validation: overrides persist after reload; two branches can use different models/settings for their next assistant response.
pass:false

---

category: In-scope gaps
description: Per-branch token and cost tracking surfaced in the UI (cost calculation + display).
steps:
- Store per-message and per-branch usage stats in the Durable Object (input/output tokens, provider/model, timestamp).
- Implement cost calculation per provider/model using a server-side price table and record computed cost.
- Add UI to display per-branch totals and per-message breakdown (behind a collapsible panel).
- Add structured logs for response usage and payload sizes to support observability.
- Manual validation: totals update after each assistant response; totals persist on reload; missing usage data renders a safe “unknown” state.
pass:false

---

category: In-scope gaps
description: JSON export/import server functions with validation and Durable Object mutation guards.
steps:
- Add server function to export a validated DO snapshot (conversation graph, branches, messages, settings) as JSON.
- Add server function to import JSON with schema validation, size limits, and guardrails (no partial writes, no cycles introduced).
- Provide UI entry points for export/download and import/upload with clear error reporting.
- Ensure import writes are sequential and short-lived; log failures with structured errors and retry guidance.
- Manual validation: export → import round-trip reproduces the same branch tree and message content; malformed JSON is rejected with a clear error.
pass:false

---

category: In-scope gaps
description: Performance instrumentation for branch switch target (<120ms at ≤500 messages).
steps:
- Add timing instrumentation around branch switch render path (DO read, render, client nav) with `[TRACE]` slow logs.
- Record payload sizes and cache hits/misses for DO reads used during branch switching.
- Add a lightweight UI indicator (dev-only or behind a flag) to show last branch switch duration.
- Establish a manual perf script/checklist for switching between branches in a 500-message dataset.
- Manual validation: branch switch stays under target in a typical dataset; slow logs include conversationId and branchId.
pass:false

---

category: Auth & accounts gaps
description: Firebase Auth integration (Google + email link sign-in on client).
steps:
- Add Firebase client integration for Google and email-link sign-in flows.
- Build sign-in UI that guides users through provider selection and email link completion.
- Ensure CSP-safe loading and no hydration mismatches in auth UI components.
- Gate signed-in-only pages/routes and provide clear signed-out empty states.
- Manual validation: sign in/out works; returning via email link completes session on the correct origin.
pass:false

---

category: Auth & accounts gaps
description: Server-side ID token verification and session creation via `defineDurableSession`.
steps:
- Add server-side verification of Firebase ID tokens and map them to an internal user identity.
- Create/update session records via `defineDurableSession` and attach to requests via middleware.
- Ensure session refresh/expiration behavior is correct and does not break RSC navigation.
- Add structured logs for auth failures (reason, provider, userId hash) without leaking secrets.
- Manual validation: API calls reject invalid/expired tokens; session persists across reload; logout invalidates session.
pass:false

---

category: Auth & accounts gaps
description: User profile storage (KV) + per-user encrypted API keys (OpenAI/Anthropic/OpenRouter).
steps:
- Define KV schema for user profile (displayName, createdAt, provider metadata) and key metadata (label, lastUsedAt).
- Implement AES-GCM encryption for provider keys using an env-held master key and per-user salt.
- Add server functions to create/list/update/delete stored keys without exposing secrets to the client.
- Ensure chat engine reads keys server-side only and enforces BYO-key requirements per provider.
- Manual validation: keys are never returned to the client; encrypted values are written to KV; selecting a key enables model calls.
pass:false

---

category: Auth & accounts gaps
description: Sign-in page + user dashboard (keys, providers, donate stub, logout).
steps:
- Create a sign-in page route and a post-login dashboard route using RedwoodSDK routing.
- Build dashboard UI for managing provider keys and showing account/provider status.
- Add a donate stub section (non-functional placeholder) and logout action.
- Ensure all dashboard mutations run via server functions and render safe empty/error states.
- Manual validation: dashboard reflects KV-stored profile; key CRUD works; logout returns to signed-out state.
pass:false

---

category: Auth & accounts gaps
description: OpenRouter model list fetch + model selector UX (server-side fetch, cached list).
steps:
- Add a server-only fetch for OpenRouter model list with caching and retry/backoff.
- Store/cache the model list per environment and expose it to the UI through server rendering (no client fetch).
- Build model selector UI that supports searching/filtering and shows key-required gating.
- Log cache hit/miss and payload sizes for model list fetches.
- Manual validation: model selector populates without client fetch; cache reduces repeated latency; missing key shows clear guidance.
pass:false

---

category: Auth & accounts gaps
description: BYO key gating for model calls with clear empty-state messaging.
steps:
- Enforce provider-key presence checks before any model call on the server.
- Add UI states that explain why sending is disabled and how to add/select a key.
- Prevent partial sends: do not append user messages if the call cannot be made due to missing keys.
- Log gated attempts (provider, branchId, userId hash) to inform UX improvements.
- Manual validation: without a key, send is blocked with guidance; adding a key immediately enables sending.
pass:false

---

category: Spec divergences
description: Decide whether DO JSON snapshots (vs DO-backed SQLite) are acceptable for MVP persistence.
steps:
- Write a short decision record comparing JSON snapshot persistence vs SQLite (complexity, perf, correctness, export/import).
- Validate expected scale (≤500 messages) against JSON read/write and branch switch performance targets.
- Decide and document the final approach, then update `Docs/scope_v3.md` accordingly.
- If changing approach, add a migration strategy for existing stored conversations.
- Manual validation: chosen persistence approach meets reload resilience and branch switch requirements in a realistic dataset.
pass:false

---

category: Out-of-scope extras
description: File upload flow with R2 storage and attachment ingestion pipeline (decide to keep, gate, or defer).
steps:
- Define the desired user flow (attach, upload progress, view attachments) and the minimum security constraints.
- Decide feature state (enabled, gated behind flag, or removed) for MVP and document rationale.
- If keeping/gating, ensure uploads store in R2 with metadata persisted and no client-side secret exposure.
- Ensure UI renders safe empty/error states and avoids blocking core chat rendering.
- Manual validation: gated behavior is deterministic; when enabled, upload succeeds and attachment metadata is visible on reload.
pass:false

---

category: Out-of-scope extras
description: Retrieval embeddings + query flow for attachments (decide to keep, gate, or defer).
steps:
- Define retrieval scope (which attachment types, chunking strategy, query triggers, citations).
- Decide feature state (enabled, gated behind flag, or removed) for MVP and document rationale.
- If keeping/gating, implement server-side embedding generation and retrieval without client fetching.
- Add observability for embedding latency and retrieval hit rate.
- Manual validation: retrieval is off when gated; when enabled, relevant attachment snippets appear in responses with stable behavior.
pass:false

---

category: Out-of-scope extras
description: Web search tool integration + snippet persistence (decide to keep, gate, or defer).
steps:
- Define search provider/tool contract and how snippets are stored and referenced per branch.
- Decide feature state (enabled, gated behind flag, or removed) for MVP and document rationale.
- If keeping/gating, implement server-side search invocation and snippet persistence with structured logs.
- Ensure UX clearly distinguishes model output vs search snippets and avoids hydration pitfalls.
- Manual validation: with feature gated, search controls are hidden/disabled; when enabled, snippets persist across reload and are associated with a branch.
pass:false

---

category: Out-of-scope extras
description: Study & Learn agent path for tutoring flows (decide to keep, gate, or defer).
steps:
- Define tutoring mode behaviors (tone, objectives, curriculum state) and any required UI scaffolding.
- Decide feature state (enabled, gated behind flag, or removed) for MVP and document rationale.
- If keeping/gating, ensure mode-specific prompts/settings are server-owned and persisted per branch.
- Add UX cues to prevent confusion between normal chat and tutoring mode.
- Manual validation: gating is deterministic; when enabled, mode persists per branch and does not impact other branches.
pass:false
