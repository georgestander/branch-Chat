# Branchy Chat Electron Migration

## Decision

Branch Chat becomes Branchy Chat, a packaged Electron desktop app with:

- app name: Branchy Chat
- assistant name: Branchy
- bundle id: `com.georgestander.branchychat`
- same repository, split into:
  - `apps/desktop` for the Electron shell
  - `packages/conversation-core` for shared conversation/domain logic
- React + Vite renderer
- secure Electron main, preload, and utility-process boundaries
- `node:sqlite` for local desktop persistence
- typed, narrow IPC plus `MessagePort` streaming
- bundled, pinned Codex app-server over stdio
- isolated private `CODEX_HOME` for Branchy
- `cli_auth_credentials_store=file`
- separate ChatGPT device-code sign-in for the desktop app
- no BYOK, no guest mode, no web landing path in the shipped desktop app
- Apple Silicon only
- signed, notarized manual DMG
- no auto-update

The Redwood web app remains available only until desktop parity is verified. After parity, retirement is explicit and gated.

## Goal

Deliver an end-to-end native desktop Branchy Chat experience that preserves the current branching chat product while removing the dependency on the Redwood web runtime for the shipped product.

## Non-goals

- No new backend service.
- No browser-based auth bridge in the final desktop path.
- No generic IPC channel.
- No broad platform support beyond Apple Silicon for this phase.
- No speculative framework switch beyond Electron.

## Phases

### Phase 1: Scaffold and isolate

- create `apps/desktop`
- create `packages/conversation-core`
- move shared conversation model, validation, rendering, and branching helpers into the package
- keep the current web app running while the desktop shell lands

### Phase 2: Desktop shell

- Electron main process owns app lifecycle, window creation, secure permissions, and app menu
- preload exposes a small typed API surface through `contextBridge`
- renderer boots React + Vite
- utility process owns Codex app-server, transcription, and any heavy local orchestration

### Phase 3: Local state and streaming

- persist conversation graphs, settings, drafts, attachments, and image state in `node:sqlite`
- stream model output to the renderer through `MessagePort`
- reconcile final assistant state once per turn
- support reload recovery from stored stream and turn state

### Phase 4: Feature parity

- branching and branch navigation
- rename, archive, delete, compare, and jump-to-root
- composer, attachments, dictation, image generation lifecycle, download, and retry
- local account state and isolated ChatGPT sign-in
- portable archive export/import via `.branchychat`

### Phase 5: Retirement and packaging

- verify desktop parity against the current app
- retire the Redwood runtime from the shipped desktop product
- package signed and notarized DMG
- keep the repo maintainable with atomic commits and narrow reviewable slices

## Security invariants

These are required for the desktop app to ship:

- `contextIsolation: true`
- `sandbox: true`
- `nodeIntegration: false`
- no renderer access to Codex, sqlite, secrets, or raw filesystem APIs
- IPC methods are explicit and schema-validated
- every IPC call is bound to the current window/session
- no localhost auth bridge in the final desktop app
- private Branchy `CODEX_HOME` is separate from the user’s global Codex state
- auth credentials use file storage inside the Branchy home only
- downloads, archives, and attachment extraction are validated before use
- custom protocols reject traversal, encoded traversal, and symlink escapes

## Data and schema outline

Use `node:sqlite` for local desktop state with a small schema that maps to the existing branch model:

- `conversations`
  - `conversation_id`
  - title, timestamps, archive state, active branch, selected model/settings
- `branches`
  - `branch_id`
  - `conversation_id`
  - parent branch, source message/span metadata, ordering, archived/deleted state
- `messages`
  - `message_id`
  - `branch_id`
  - role, content, tool state, token usage, streaming state, timestamps
- `attachments`
  - attachment metadata, local file reference, MIME, byte count, hash, extraction state
- `generated_images`
  - generation id, prompt, progress, status, asset path, download metadata
- `drafts`
  - composer draft and branch-local state
- `account`
  - isolated ChatGPT account metadata, plan/status, and local credential references
- `stream_sessions`
  - active stream id, branch id, turn id, state, last event, recovery cursor

The shared conversation package owns domain validation, snapshot conversion, and rendering helpers. The desktop shell owns persistence and transport.

## RPC and stream contracts

Keep the boundary explicit and narrow.

### Renderer to main/preload

Use typed commands only:

- `app.getBootstrap()`
- `account.getStatus()`
- `account.beginLogin()`
- `conversation.list()`
- `conversation.open(conversationId)`
- `conversation.create(input)`
- `conversation.rename(input)`
- `conversation.archive(input)`
- `conversation.delete(input)`
- `conversation.sendMessage(input)`
- `conversation.cancelTurn(input)`
- `conversation.loadBranch(input)`
- `conversation.createBranch(input)`
- `conversation.openBranchCard(input)`
- `attachment.add(input)`
- `attachment.remove(input)`
- `image.retry(input)`
- `image.download(input)`
- `archive.export(input)`
- `archive.import(input)`
- `dictation.transcribe(input)`

### Streaming

Stream model events over `MessagePort`:

- `open`
- `start`
- `delta`
- `reasoning_summary`
- `tool_progress`
- `image_progress`
- `image_ready`
- `complete`
- `cancelled`
- `error`

The subscriber must be attached before model output begins so the first delta cannot be lost.

## Packaging

- desktop builds from `apps/desktop`
- renderer bundles with Vite
- app state and credentials live under a Branchy-specific home directory
- ship a signed, notarized DMG for Apple Silicon
- no automatic update channel in this phase

## Migration and retirement gates

Do not retire the Redwood runtime until all of the following are true:

- desktop launch works from the packaged app
- ChatGPT sign-in works inside the desktop app with isolated credentials
- branch navigation, send, cancel, reload, and archive flows work
- attachments, dictation, image generation progress, download, and retry work
- `.branchychat` export/import round-trips a real conversation set
- visual verification matches the desktop shell to the expected product shape
- computer-use smoke verifies a real interactive path end to end
- p95 branch switch visible completion is under 120 ms on representative data with up to 500 messages

## Acceptance criteria

The migration is complete when:

- the app runs as Branchy Chat in Electron
- the shared conversation core is factored into `packages/conversation-core`
- desktop storage, auth, and Codex integration are isolated from the browser app
- the browser/Redwood runtime is no longer the shipped product path
- the desktop app can be started, signed into, used, reloaded, and handed to the user
- the repo contains atomic commits that each pass the required gates

