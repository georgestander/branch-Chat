# Setup

## Prerequisites

- Node.js (current LTS recommended)
- pnpm
- Cloudflare Wrangler CLI (installed via dev dependencies)
- OpenAI API key for chat generation

## Local Development

1. Install dependencies:
   ```bash
   pnpm install
   ```
2. Create local env file:
   ```bash
   cp .dev.vars.example .dev.vars
   ```
3. Populate required env vars in `.dev.vars` (see `Docs/env-vars.md`).
4. Run dev server:
   ```bash
   pnpm dev
   ```
5. Open [http://localhost:5174](http://localhost:5174).

## Type and Quality Checks

Run these before opening a PR:

```bash
pnpm types
npm run test
npm run lint
```

## Regenerate Worker Types

If Cloudflare bindings change, regenerate worker types:

```bash
pnpm generate
```

## Deploy

Deploy through Wrangler using the release script:

```bash
pnpm release
```

Ensure required production bindings and secrets are configured in Cloudflare before deploy.
