# Security Best Practices Report

Date: 2026-02-18
Reviewer: Codex (`security-best-practices` skill)
Scope: TypeScript/React RedwoodSDK Worker app under `src/**` plus deployment/auth docs.

## Executive Summary

This review found **1 Critical**, **3 High**, and **2 Medium** issues.

Top risk is authentication/identity trust: the current sign-in flow and optional header trust patterns can allow user impersonation if deployed without strict upstream controls. The upload fallback path also allows unbounded body uploads when `Content-Length` is omitted, creating a storage-cost/DoS risk.

---

## Critical Findings

### SBP-001 (Critical) - Sign-in accepts self-asserted identity with no credential verification

**Impact:** A remote attacker can sign in as any chosen user ID, then read/modify that user’s conversations and potentially consume their persisted BYOK-backed account resources.

**Evidence**
- `src/app/pages/sign-in/SignInPage.tsx:33` processes POSTed `userId` directly from form data.
- `src/app/pages/sign-in/SignInPage.tsx:39` normalizes the supplied identifier, but does not verify ownership/authenticity.
- `src/app/pages/sign-in/SignInPage.tsx:50` sets auth cookie for that user immediately.
- `src/app/shared/auth.server.ts:306`-`src/app/shared/auth.server.ts:325` writes long-lived auth cookie from supplied user ID.

**Why this violates best practice**
Authentication is effectively “claim any username/email.” This is not safe for internet-exposed deployments.

**Recommended fix**
- Remove direct user-id sign-in for production builds.
- Require a verifiable identity provider (Cloudflare Access JWT validation, OAuth/OIDC, or equivalent).
- If local/dev-only sign-in is needed, gate it behind explicit dev flags and disable in production.

---

## High Findings

### SBP-002 (High) - Trusted identity headers are accepted without cryptographic verification

**Evidence**
- `src/app/shared/auth.server.ts:191`-`src/app/shared/auth.server.ts:208` trusts `x-connexus-user-id`, `x-clerk-user-id`, and `x-user-id` header values as identity.
- `src/app/shared/auth.server.ts:212`-`src/app/shared/auth.server.ts:229` trusts `cf-access-authenticated-user-email` directly when no user-id header exists.
- `src/worker.tsx:73`-`src/worker.tsx:95` enables this behavior via `AUTH_TRUST_IDENTITY_HEADERS`.

**Risk**
If the Worker is reachable directly (or proxy rules are misconfigured), attackers can spoof headers and impersonate users.

**Recommended fix**
- Only accept identity from cryptographically verifiable tokens/assertions.
- Restrict accepted trusted headers to known upstream and validate provenance (for example, Access JWT verification).
- Fail closed when trusted upstream signals are missing.

### SBP-003 (High) - Upload fallback path allows unbounded upload when `Content-Length` is absent

**Evidence**
- `src/app/shared/uploadsProxy.server.ts:50`-`src/app/shared/uploadsProxy.server.ts:59` enforces max size only when `Content-Length` header exists.
- `src/app/shared/uploadsProxy.server.ts:69`-`src/app/shared/uploadsProxy.server.ts:74` streams body directly to R2 with no byte-count guard.

**Risk**
Attackers can bypass configured max upload size by omitting `Content-Length`, causing R2 storage abuse and cost/availability impact.

**Recommended fix**
- Enforce streaming byte limits server-side regardless of `Content-Length`.
- Abort upload when bytes exceed `UPLOAD_MAX_SIZE_BYTES`.
- Optionally verify stored object size against staged metadata and delete oversized objects immediately.

### SBP-004 (High) - Unsigned cookie identity mode permits impersonation when auth is not required

**Evidence**
- `src/app/shared/auth.server.ts:157`-`src/app/shared/auth.server.ts:160` accepts raw cookie user ID when `AUTH_COOKIE_SECRET` is unset.
- `Docs/env-vars.md:18` documents unsigned cookie behavior when `AUTH_REQUIRED` is off.

**Risk**
Any client that can set/modify cookies can impersonate arbitrary users in shared/public deployments using optional-auth profile.

**Recommended fix**
- Never allow unsigned identity cookies outside local dev.
- Require `AUTH_COOKIE_SECRET` in all non-local environments.
- Add startup/runtime guardrails to prevent accidental insecure deployment profiles.

---

## Medium Findings

### SBP-005 (Medium) - Sensitive user content may be written to logs during ingestion failures/success

**Evidence**
- `src/app/shared/uploads.ingest.server.ts:220`-`src/app/shared/uploads.ingest.server.ts:222` logs parser output preview (`output.slice(0, 2400)`) when JSON parse fails.
- `src/app/shared/uploads.ingest.server.ts:510`-`src/app/shared/uploads.ingest.server.ts:512` traces chunk preview content.

**Risk**
Uploads can contain confidential/regulated data; logging content fragments increases data exposure surface in log stores.

**Recommended fix**
- Remove content previews from logs.
- Log IDs/status/lengths only.
- Add explicit redaction policy for all user-generated content in traces/errors.

### SBP-006 (Medium) - CSP contains `unsafe-eval` and `unsafe-inline`, reducing XSS hardening

**Evidence**
- `src/app/headers.ts:28`-`src/app/headers.ts:29` sets:
  - `script-src 'self' 'unsafe-eval' ...`
  - `style-src 'self' 'unsafe-inline' ...`

**Risk**
If an injection path appears, weakened CSP increases exploitability and blast radius.

**Recommended fix**
- Remove `unsafe-eval` in production policy.
- Move inline styles to nonce/hash-based strategy where possible.
- Maintain separate stricter production CSP and keep dev relaxations out of production.

---

## Notes / Assumptions

- This was a code/config review; runtime edge config (Cloudflare Access policy, origin locks, WAF rules) was not directly validated.
- If deployment is strictly private and network-isolated with robust upstream auth, exploitability of SBP-001/002/004 can be reduced, but code-level protections are still recommended for defense in depth.
