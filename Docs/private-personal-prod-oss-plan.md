# Personal Production + OSS Self-Host Plan

Last updated: 2026-02-18
Owner: george

## Summary
- Production deployment is personal/private by default, controlled by Cloudflare Access invite policy.
- Public repo remains open source for self-hosters to run locally or deploy to their own Cloudflare account.
- Demo pass system is removed; messaging is BYOK-first.
- Self-host defaults are simple: auth off, BYOK required before send.

## Locked Product Decisions
1. Production access model: Cloudflare Access invite list.
2. Production route scope: keep landing public, protect `/app` and app mutations.
3. App identity source in production: Cloudflare Access email header with verified JWT assertion.
4. Invite enforcement: Cloudflare policy only (no app-level allowlist).
5. ChatGPT/OpenAI OAuth: deferred for now.
6. Existing `/sign-in` page: keep as optional fallback for OSS self-hosters.
7. Demo passes: remove entirely.
8. BYOK persistence:
- `BYOK_ENCRYPTION_SECRET` configured: encrypted server persistence.
- `BYOK_ENCRYPTION_SECRET` missing: allow memory-only BYOK for quick tests, no persistence across reload.

## Scope
### In Scope
- Remove demo lane and pass accounting from server/client.
- Add BYOK-required send gate in `/app`.
- Preserve branching, persistence, and current conversation flows.
- Update docs for personal production + OSS self-host defaults.

### Out of Scope
- ChatGPT account OAuth integration.
- Billing/paywall.
- Multi-tenant invite management inside app.

## Implementation Tracks
1. Auth + Access identity handling.
2. BYOK-only server contracts and send path.
3. Account Durable Object simplification.
4. Composer/sidebar UX refactor to remove demo lane and add BYOK gate.
5. Docs and setup guidance update.

## Acceptance Criteria
### AC-01 Production Access
- When production env has `AUTH_REQUIRED=true` and trusted headers enabled, unauthenticated `/app` requests are denied.
- When `cf-access-authenticated-user-email` is present and paired with a valid `cf-access-jwt-assertion` (`aud` + signature), user identity resolves and app loads.
- Landing route remains public while `/app` is protected.

### AC-02 BYOK Requirement
- Sending a message without persistent BYOK or session BYOK is blocked with clear guidance.
- Sending succeeds when valid BYOK is connected and provider matches selected model family.
- Demo-pass language and behavior no longer appears anywhere in app UX.

### AC-03 BYOK Persistence Modes
- With `BYOK_ENCRYPTION_SECRET` set: BYOK key save/load/delete works and remains encrypted server-side.
- Without `BYOK_ENCRYPTION_SECRET`: save-to-server is disabled; session BYOK can send but is cleared on reload.

### AC-04 Data Ownership and Persistence
- Conversation history remains scoped to authenticated user identity in production.
- Branch operations (create, navigate, rename, archive/delete) continue to work unchanged.

### AC-05 OSS First-Run Experience
- Fresh clone can run with auth off.
- User reaches `/app` without external auth setup.
- User is prompted to connect BYOK before first send.

### AC-06 Documentation Quality
- Setup docs clearly split "personal production" vs "public self-host."
- Env var docs explain required production flags and BYOK persistence behavior.

## Progress Tracker
| ID | Workstream | Deliverable | Status | Acceptance Criteria | Evidence / Notes |
|---|---|---|---|---|---|
| P1 | Auth | Support Cloudflare Access email header identity | Done | AC-01 | Trusted CF Access flow now requires `cf-access-jwt-assertion` verification (JWKS + audience) before header identity is accepted; covered by auth tests in `src/app/shared/auth.server.test.ts` |
| P2 | Server APIs | Remove demo lane from send contracts | Done | AC-02 | `sendMessage` now accepts `byok?: boolean` instead of `lane`; response contract no longer returns `quota.lane`; composer caller updated accordingly |
| P3 | Account DO | Remove quota/pass endpoints, keep BYOK + prefs | Done | AC-02, AC-03 | Removed DO quota/pass endpoints + server/client helpers; legacy account state normalization now ignores old quota/reservation fields and preserves BYOK/composer prefs (covered by `src/lib/durable-objects/Account.test.ts`) |
| P4 | Composer UX | Add BYOK-required gate in `/app`, remove pass UI | Done | AC-02, AC-05 | Composer now blocks sends until persisted/session BYOK exists, enforces provider mismatch guidance, removes demo/pass lane UI, and supports session-only keys when server BYOK persistence is unavailable |
| P5 | Sidebar UX | Remove lane preference and pass labels | Done | AC-02 | Removed sidebar lane preference/pass UI, deleted lane preference module, and kept sidebar account modal focused on BYOK connection status only |
| P6 | Sign-in Copy | Remove demo wording, keep optional fallback role | Done | AC-06 | Updated `/sign-in` helper text to neutral fallback wording without demo/pass language |
| P7 | Docs | Update setup/env/readme for prod vs self-host | Done | AC-06 | Added deployment-profile matrices + BYOK persistence/session behavior details across `Docs/setup.md`, `Docs/env-vars.md`, and `README.md` (plus `Docs/architecture.md` AccountDO wording alignment) |
| P8 | Validation | Run all feedback loops after each logical change | Done | AC-01..AC-06 | Ran `pnpm types`, `npm run test`, `npm run lint` after each P4/P5-6/P7 slice and again at final HEAD; review pass against `main` surfaced one session-BYOK loading edge case, fixed in `732f096` |

## Execution Notes
- Keep commits small and focused, one logical change at a time.
- After each logical change, run full feedback loops before commit.
- Update this table statuses (`Not Started`, `In Progress`, `Done`, `Blocked`) with brief evidence in the final column.
