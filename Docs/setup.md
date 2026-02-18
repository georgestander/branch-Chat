# Setup

## Prerequisites

- Node.js current LTS
- pnpm (Corepack is fine)
- OpenAI API key (`OPENAI_API_KEY`) for model responses

## Local Development

1. Install dependencies:
   ```bash
   pnpm install
   ```
2. Create local env file:
   ```bash
   cp .dev.vars.example .dev.vars
   ```
3. Set values in `.dev.vars`:
   - Required for chat: `OPENAI_API_KEY`
   - Optional auth hardening: `AUTH_REQUIRED`, `AUTH_COOKIE_SECRET`, `AUTH_TRUST_IDENTITY_HEADERS`, `AUTH_ALLOW_LEGACY_COOKIE`
   - Optional BYOK/OpenRouter setup: see `Docs/env-vars.md`
4. Start the dev server:
   ```bash
   pnpm dev
   ```
5. Open [http://localhost:5174](http://localhost:5174).
   - `/` is the landing page.
   - `/app` is the chat app.
   - If `AUTH_REQUIRED=true`, authenticate through `/sign-in` (or trusted identity headers) before using `/app`.

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
