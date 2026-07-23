# Architecture

## Overview

Branchy Chat is a local-first Electron application for Apple Silicon macOS. The
current application lives in `apps/desktop` and has four trust and persistence
layers:

- The sandboxed React renderer paints the branch canvas and handles local UI
  interaction.
- A narrow preload bridge exposes validated application operations to the
  renderer.
- Electron main owns windows, trusted IPC, SQLite persistence, local assets,
  and validated event delivery.
- A dedicated utility process owns the Codex client, ChatGPT device-code
  sessions, model turns, dictation, and the pinned Codex app-server child.

## Runtime Components

- Electron main and IPC: `apps/desktop/src/main/main.ts`
- Application service and stream reconciliation:
  `apps/desktop/src/main/application/`
- Renderer and branch canvas: `apps/desktop/src/renderer/`
- Preload API: `apps/desktop/src/preload.ts`
- Shared IPC contracts and validation: `apps/desktop/src/shared/`
- SQLite repository: `apps/desktop/src/main/persistence/`
- Content-addressed local assets: `apps/desktop/src/main/assets/`
- Codex utility process and stdio transport: `apps/desktop/src/main/codex/`
- Packaging and release policy: `apps/desktop/forge.config.mjs` and
  `apps/desktop/scripts/release-macos.mjs`

## Request and State Flow

1. The renderer invokes a validated preload operation.
2. Main authorizes the sender, validates the payload, and delegates to the
   application service.
3. Conversation and branch changes are committed to SQLite. Attachments and
   generated images are imported into the local content-addressed asset store.
4. Model operations cross the strict utility-process contract. The utility
   process talks to the pinned Codex app-server over stdio.
5. Main buffers validated stream events and publishes them to renderer
   `MessagePort` subscribers.
6. The final canonical response is persisted, then reconciled into the active
   branch without a route reload.

## Local Data and Authentication

Branchy stores its current data under:

```text
~/Library/Application Support/Branchy Chat/
```

That directory contains the SQLite database, local assets, the isolated Codex
home, a minimal process home, and a dedicated chat workspace. ChatGPT sign-in
uses the Codex device-code flow and file-backed credentials inside Branchy’s
Codex home. The app does not copy, read, or modify `~/.codex` or the Codex
desktop app’s account state.

The utility child receives an allowlisted environment with `CODEX_HOME`, `HOME`,
and XDG paths redirected into Branchy’s private application directory. It does
not expose a localhost auth or chat server.

## Security Boundaries

- The renderer uses `sandbox: true`, `contextIsolation: true`, and
  `nodeIntegration: false`.
- Renderer navigation and external URLs are restricted.
- IPC payloads and utility-process messages are validated at their boundaries.
- The Codex executable is pinned by version and SHA-256; packaged release
  validation also confirms its OpenAI Developer ID signature.
- QA artifacts are ad-hoc signed for local testing only. Distribution requires
  the separate Developer ID and notarization workflow documented in
  `apps/desktop/README.md`.

## Retained Legacy Web Runtime

The repository root package, `@branchy/web-legacy`, retains the former
RedwoodSDK/Cloudflare implementation while native parity is completed. It is
not the current Branchy desktop runtime.

Its architecture remains server-first: RedwoodSDK RSC pages and server
functions use Durable Objects for conversation state, R2 for uploads, and SSE
for model streams. The legacy Worker entry is `src/worker.tsx`, and its
environment and Cloudflare binding reference is the clearly labeled legacy
section in `Docs/env-vars.md`.

Run `pnpm dev` only when intentionally working on this retained web runtime.
