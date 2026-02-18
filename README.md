# Branch Chat

Branch Chat is a server-first, non-linear branching chat app built with RedwoodSDK React Server Components (RSC) on Cloudflare Workers.

The project is designed around branchable conversations, Durable Object persistence, and server-owned chat orchestration.

## Demo Video

[![Watch the Branch Chat demo video](https://img.youtube.com/vi/MgnB9d0uLrI/hqdefault.jpg)](https://youtu.be/MgnB9d0uLrI)

Click the preview image to watch the YouTube demo.

## Documentation

- Architecture: [`Docs/architecture.md`](Docs/architecture.md)
- Local setup: [`Docs/setup.md`](Docs/setup.md)
- Environment variables and bindings: [`Docs/env-vars.md`](Docs/env-vars.md)
- Contributing: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- Security policy: [`SECURITY.md`](SECURITY.md)

## Core Architecture

- Routing and rendering use RedwoodSDK primitives in `src/worker.tsx` (`defineApp`, `route`, `render`).
- Conversation graph state persists in Cloudflare Durable Objects:
  - `ConversationStoreDO` (per-conversation graph + messages)
  - `ConversationDirectoryDO` (conversation list metadata)
  - `AccountDO` (per-user BYOK metadata + composer preference)
- Mutations run through server functions in `src/app/pages/conversation/functions.ts` (`"use server"`).
- Client islands in `src/app/components/**` handle interaction-only concerns (pane resizing, keyboard shortcuts, optimistic UI).

## Deployment Profiles

- Personal production (private): Cloudflare Access-protected `/app` with verified Access assertion identity and encrypted BYOK persistence (`AUTH_REQUIRED=true`, `AUTH_TRUST_IDENTITY_HEADERS=true`, `AUTH_ACCESS_JWKS_URL`, `AUTH_ACCESS_AUDIENCE`, `AUTH_COOKIE_SECRET`, `BYOK_ENCRYPTION_SECRET`).
- OSS self-host: auth optional by default (`AUTH_REQUIRED` off); BYOK is still required before send, and if `BYOK_ENCRYPTION_SECRET` is unset the app uses session-only BYOK keys (cleared on reload).

## Cloudflare Access Setup (Private Personal Deployment)

Use this when you want your personal deployment protected by Cloudflare Access login.

1. Configure Worker runtime values in Cloudflare:
   - `AUTH_REQUIRED=true`
   - `AUTH_TRUST_IDENTITY_HEADERS=true`
   - `AUTH_ACCESS_JWKS_URL=https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`
   - `AUTH_ACCESS_AUDIENCE=<your-access-aud>`
   - `AUTH_ALLOW_LEGACY_COOKIE=false`
   - `AUTH_ALLOW_SELF_ASSERTED_SIGN_IN=false`
   - `AUTH_ALLOW_INSECURE_UNSIGNED_COOKIE=false`
   - `LANDING_HOSTED_URL=/sign-in?redirectTo=/app` (optional, used by landing login CTA)
2. Configure Worker secrets in Cloudflare:
   - `OPENAI_API_KEY`
   - `AUTH_COOKIE_SECRET`
   - `BYOK_ENCRYPTION_SECRET`
3. In Cloudflare Zero Trust, enable at least one login method:
   - `Zero Trust -> Settings -> Authentication -> Login methods`
4. Add a Cloudflare Access application for your app route:
   - `Zero Trust -> Access -> Applications -> Add application -> Self-hosted`
   - Domain: your app host (for example `chat.example.com`)
   - Path: `/app*`
   - Policy: allow your user/group/email
5. Recommended: add matching Access applications for:
   - `/events*` (streaming)
   - `/_uploads*` (uploads)
6. Verify in an incognito window:
   - `https://<your-host>/app` prompts Access login then loads the app
   - `https://<your-host>/` remains public landing

## Quick Start

1. Install dependencies:
   ```bash
   pnpm install
   ```
2. Copy local env template:
   ```bash
   cp .dev.vars.example .dev.vars
   ```
3. Add required keys in `.dev.vars` (at minimum `OPENAI_API_KEY`).
4. Optional but recommended for persisted BYOK keys: set `BYOK_ENCRYPTION_SECRET`.
5. For private production-style auth locally: set `AUTH_REQUIRED=true`, `AUTH_COOKIE_SECRET`, `AUTH_TRUST_IDENTITY_HEADERS=true`, `AUTH_ACCESS_JWKS_URL`, and `AUTH_ACCESS_AUDIENCE`.
6. Start local development:
   ```bash
   pnpm dev
   ```
7. Open [http://localhost:5174](http://localhost:5174), then use `Log In` from the landing page (or go directly to `/sign-in?redirectTo=/app` when self-asserted sign-in is enabled for your mode).
8. If `AUTH_REQUIRED` is off, you can also open `/app` directly with guest fallback auth.

## Scripts

- `pnpm dev`: Start Vite + RedwoodSDK dev server.
- `pnpm types`: Run TypeScript type checking.
- `npm run test`: Run Node's test runner (`node --test`).
- `npm run lint`: Run TypeScript checks as the current lint gate.
- `pnpm release`: Build and deploy with Wrangler.

## License

This project is licensed under the MIT License. See [`LICENSE`](LICENSE).
