# Scope v3 gaps and extras tracker

This document tracks what is missing or out-of-scope versus `docs/scope_v3.md`.
Update the checklists as work ships so the delta stays accurate.

## Update discipline (atomic commits required)

- Each checklist update MUST be an atomic commit that includes only the code/docs needed for that single item.
- Do NOT combine multiple checklist items in one commit. If two items land together, split the work or leave one unchecked.
- Always include the checklist update in the same commit as the implementation change.
- Use a clear commit message that references the item being updated.

## In-scope gaps (not yet delivered)

- [ ] Branch-level CRUD: rename, archive, delete with confirmation (per branch, not just per conversation).
- [ ] Independent composer per branch (parent column still read-only today).
- [ ] Breadcrumbs + jump-to-root navigation (tree exists but no breadcrumb/jump controls).
- [ ] Keyboard shortcuts for branching, navigation, and split-view toggles.
- [ ] Per-branch model/settings overrides persisted in DO (model, temperature, reasoning effort, system prompt).
- [ ] Per-branch token + cost tracking surfaced in the UI (cost calculation + display).
- [ ] JSON export/import server functions with validation and DO mutation guards.
- [ ] Performance instrumentation for branch switch target (<120ms at <=500 messages).

## Auth & accounts gaps (not yet delivered)

- [ ] Firebase Auth integration (Google + email link sign-in on client).
- [ ] Server-side ID token verification and session creation via `defineDurableSession`.
- [ ] User profile storage (KV) + per-user encrypted API keys (OpenAI/Anthropic/OpenRouter).
- [ ] Sign-in page + user dashboard (keys, providers, donate stub, logout).
- [ ] OpenRouter model list fetch + model selector UX (server-side fetch, cached list).
- [ ] BYO key gating for model calls with clear empty-state messaging.

## Auth storage notes (KV best practice)

- Encrypt provider API keys before writing to KV (AES-GCM with env-held master key + per-user salt).
- Store only key metadata in plaintext (provider name, createdAt, lastUsedAt, label).
- Keep session data in DO via `defineDurableSession`; KV is for user profile + secrets only.
- Use short, stable KV keys (e.g., `user:${userId}`) and avoid large blobs in a single item.

## Spec divergences (needs decision)

- [ ] Persistence uses DO JSON snapshots instead of DO-backed SQLite; confirm if this is acceptable for MVP.

## Decisions locked in (update if changed)

- [x] Auth provider: Firebase Auth for Google + email link.
- [x] User profile + API key storage: KV (encrypted, server-only access).

## Out-of-scope extras currently present (decide to keep, gate, or defer)

- [ ] File upload flow with R2 storage and attachment ingestion pipeline.
- [ ] Retrieval embeddings + query flow for attachments.
- [ ] Web search tool integration + snippet persistence.
- [ ] Study & Learn agent path for tutoring flows.
