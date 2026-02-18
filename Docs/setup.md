# Setup

## Prerequisites

- Node.js current LTS
- pnpm (Corepack is fine)
- OpenAI API key (`OPENAI_API_KEY`)

## Choose a Mode

| Mode | Goal | Key env setup |
| --- | --- | --- |
| OSS self-host quickstart | Run locally with minimal setup | `OPENAI_API_KEY` only; keep `AUTH_REQUIRED` unset/false |
| Personal production-like | Match private Cloudflare Access deployment defaults | `AUTH_REQUIRED=true`, `AUTH_COOKIE_SECRET`, `AUTH_TRUST_IDENTITY_HEADERS=true`, `AUTH_ACCESS_JWKS_URL`, `AUTH_ACCESS_AUDIENCE`, `BYOK_ENCRYPTION_SECRET` |

See `Docs/env-vars.md` for full details.

## Local Development

1. Install dependencies:
   ```bash
   pnpm install
   ```
2. Create local env file:
   ```bash
   cp .dev.vars.example .dev.vars
   ```
3. Set `.dev.vars`:
   - Required: `OPENAI_API_KEY`
   - Optional auth hardening: `AUTH_REQUIRED`, `AUTH_COOKIE_SECRET`, `AUTH_TRUST_IDENTITY_HEADERS`, `AUTH_ACCESS_JWKS_URL`, `AUTH_ACCESS_AUDIENCE`, `AUTH_ALLOW_LEGACY_COOKIE`
   - Optional auth fallback toggles (insecure outside local/dev): `AUTH_ALLOW_SELF_ASSERTED_SIGN_IN`, `AUTH_ALLOW_INSECURE_UNSIGNED_COOKIE`
   - Optional BYOK persistence: `BYOK_ENCRYPTION_SECRET`
   - Optional OpenRouter routing: `OPENROUTER_API_KEY` plus related `OPENROUTER_*` vars
4. Start the dev server:
   ```bash
   pnpm dev
   ```
5. Open [http://localhost:5174](http://localhost:5174):
   - `/` is the landing page.
   - `Log In` on the landing page routes to `/sign-in?redirectTo=/app` (or `LANDING_HOSTED_URL` if configured).
   - `/app` is the chat app.
   - `/sign-in` self-asserted POST is available by default only when `AUTH_REQUIRED` is off (or when `AUTH_ALLOW_SELF_ASSERTED_SIGN_IN=true`).

## BYOK Behavior

- Sending in `/app` requires BYOK.
- If `BYOK_ENCRYPTION_SECRET` is set: BYOK key save/load/delete persists in `AccountDO` (encrypted).
- If `BYOK_ENCRYPTION_SECRET` is missing: server persistence is disabled, but users can connect a session-only key in composer (clears on reload).

## Validation Loops

Run all of these before committing:

```bash
pnpm types
npm run test
npm run lint
```

## Cloudflare Type Generation

When Worker bindings/migrations change, regenerate runtime types:

```bash
pnpm generate
```

## Deploy

Deploy with Wrangler via:

```bash
pnpm release
```

Before deploy, ensure Cloudflare production bindings/secrets are configured (`ConversationGraphDO`, `ConversationDirectoryDO`, `AccountDO`, `UploadsBucket`, and runtime env vars).
