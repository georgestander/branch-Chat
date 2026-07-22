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
  - `AccountDO` (per-ChatGPT-user composer preferences)
- Mutations run through server functions in `src/app/pages/conversation/functions.ts` (`"use server"`).
- Client islands in `src/app/components/**` handle interaction-only concerns (pane resizing, keyboard shortcuts, optimistic UI).

## Local-first runtime

- `pnpm dev` starts the Cloudflare Vite runtime and a loopback-only Codex app-server bridge.
- Codex supplies ChatGPT authentication, model access, and voice transcription; no OpenAI API key is required for chat or dictation.
- Local Durable Objects and R2 persist beneath `.wrangler/state` across normal restarts.
- Fast defaults to GPT-5.6 Terra with medium reasoning, the Fast service tier, and web search enabled.

Voice dictation records up to two minutes in the browser, converts the recording to mono 24 kHz PCM16 WAV locally, and sends it through the authenticated Worker to the loopback Codex bridge. The returned transcript is added to the composer for review and is never sent automatically. Failed transcription audio remains only in memory so it can be retried without recording again.

## Quick Start

1. Install dependencies:
   ```bash
   pnpm install
   ```
2. Sign in with ChatGPT through Codex:
   ```bash
   codex login
   codex login status
   ```
3. Start local development:
   ```bash
   pnpm dev
   ```
4. Open [http://localhost:5174](http://localhost:5174). The local app uses your signed-in ChatGPT identity automatically.

## Scripts

- `pnpm dev`: Start the Codex bridge plus Vite + RedwoodSDK dev server.
- `pnpm dev:web`: Start only Vite + RedwoodSDK (no ChatGPT bridge).
- `pnpm types`: Run TypeScript type checking.
- `npm run test`: Run Node's test runner (`node --test`).
- `npm run lint`: Run TypeScript checks as the current lint gate.
- `pnpm release`: Build and deploy with Wrangler.

## License

This project is licensed under the MIT License. See [`LICENSE`](LICENSE).
