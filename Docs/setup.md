# Setup

## Prerequisites

- Node.js current LTS
- pnpm (Corepack is fine)
- Codex CLI installed and available as `codex`
- A ChatGPT account signed in through Codex

## Choose a Mode

| Mode | Goal | Key env setup |
| --- | --- | --- |
| Local ChatGPT | Run locally with your ChatGPT subscription | `codex login`; no API key required |
| Cloudflare UI/runtime | Exercise Worker, Durable Object, and R2 behavior locally | Included in `pnpm dev` through the Cloudflare Vite plugin |

See `Docs/env-vars.md` for full details.

## Local Development

1. Install dependencies:
   ```bash
   pnpm install
   ```
2. Sign in to Codex with ChatGPT and verify the account:
   ```bash
   codex login
   codex login status
   ```
3. Start the dev server and local Codex bridge:
   ```bash
   pnpm dev
   ```
4. Open [http://localhost:5174](http://localhost:5174). Localhost redirects directly to `/app` and uses the email from the signed-in ChatGPT account as the stable local identity.

## Local persistence

- Chat requests go through a loopback-only Codex app-server bridge. ChatGPT credentials are never sent to the browser or stored in Durable Objects.
- Conversations, branches, messages, and composer preferences persist under `.wrangler/state` through local Durable Objects.
- Uploads use the local R2 binding. Do not delete `.wrangler/state` if you want to keep local chats.
- Web search defaults on. Fast defaults to GPT-5.6 Terra, medium reasoning, and the Fast service tier.

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

## Deployment boundary

The ChatGPT-backed runtime is intentionally local because Codex app-server and its account session run on the user's machine. Wrangler deployment remains available for infrastructure experiments, but a remote Worker cannot reach the loopback bridge and is not a supported chat deployment target.
