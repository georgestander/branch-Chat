# Branchy Chat Desktop

Branchy Chat Desktop is the current native macOS application in this
workspace. It is Apple Silicon only and uses Electron, SQLite, and a pinned
Codex app-server.

## Prerequisites

- An Apple Silicon Mac
- Current Node.js and pnpm
- Current Xcode command-line tools when creating a DMG or release
- Network access the first time the pinned Codex app-server must be fetched

No OpenAI API key or `.dev.vars` file is required.

## Local QA app

From the repository root:

```bash
pnpm install
pnpm desktop:package
```

Open:

```text
apps/desktop/out/Branchy Chat-darwin-arm64/Branchy Chat.app
```

To create a local QA DMG instead:

```bash
pnpm desktop:make
```

The DMG is written under `apps/desktop/out/make/`.

`desktop:package` produces an ad-hoc-signed app. `desktop:make` places that same
app in a local QA DMG; the DMG itself is not signed in QA mode. The app uses
the hardened runtime and a narrowly scoped library-validation exception so the
Team-ID-less host can load its separately signed Electron framework. These
artifacts are intended only for local QA on the Mac that built them. They are
not a Developer ID signed, notarized, distributable release.

## Development

Run the Electron app with Vite development tooling:

```bash
pnpm desktop:dev
```

This command is the current desktop development path. The repository-root
`pnpm dev` command starts the retained legacy RedwoodSDK app instead.

## ChatGPT sign-in

Choose **Connect ChatGPT** in Branchy. The app starts ChatGPT’s device-code flow and shows the verification URL and one-time code. Complete that step in your browser; do not paste credentials into Branchy.

Branchy bundles the pinned Codex app-server declared in `resources/codex/manifest.json`. Electron main launches a dedicated utility process, which exclusively owns the Codex client, device-code sessions, model turns, dictation, and the app-server child over stdio. Main remains the renderer trust boundary and owns the buffered `StreamHub` used to publish validated events to renderer `MessagePort` subscribers. Branchy does not start a localhost auth or chat bridge.

## Private local data

Branchy owns a separate application directory:

```text
~/Library/Application Support/Branchy Chat/
```

It contains:

- `branchy.sqlite3` for conversation graphs, messages, and per-branch composer drafts;
- `assets/` for content-addressed attachments and generated images;
- `codex-runtime/codex-home/` for Branchy’s file-backed ChatGPT credentials;
- `codex-runtime/process-home/` and `codex-runtime/chat-workspace/` for the isolated Codex child.

The utility-owned Codex app-server child receives a minimal allowlisted environment with `CODEX_HOME`, `HOME`, and XDG paths redirected into this directory. Branchy does not use `~/.codex`.

## Security boundaries

- The renderer runs with sandboxing and context isolation enabled, without Node
  integration.
- Preload exposes only validated, domain-specific IPC operations.
- The Codex client and app-server run in a dedicated utility process over
  stdio. No localhost auth or chat bridge is opened.
- Packaged builds verify the pinned Codex binary before launch.
- External navigation is denied by default and restricted to allowed HTTPS
  destinations.

The implementation sources of truth are `src/main/security.ts`,
`src/main/main.ts`, `src/main/codex/runtime.ts`, and
`scripts/release-macos.mjs`.

## Verification

Run all repository gates before committing:

```bash
pnpm types
npm run test
npm run lint
```

Desktop-only checks:

```bash
pnpm -C apps/desktop types
pnpm -C apps/desktop test
```

## Release packaging

A distributable DMG is a separate release workflow. It must be signed with a
Developer ID Application certificate and notarized. Store Apple credentials in
the macOS Keychain, never in the repository.

```bash
BRANCHY_RELEASE=1 \
BRANCHY_APPLE_SIGNING_IDENTITY="Developer ID Application: Name (TEAMID)" \
BRANCHY_APPLE_NOTARY_PROFILE="branchy-notary" \
pnpm -C apps/desktop release:mac
```

Release mode fails closed when the signing identity, notary profile, Apple Silicon host, or notarization tools are unavailable. The signing configuration excludes the bundled Codex executable and verifies its pinned checksum and OpenAI Developer ID signature after packaging.

The release workflow signs the app and DMG, submits the DMG for notarization,
staples the result, and runs Gatekeeper and signature checks. A successful
`desktop:make` command alone does not satisfy these release requirements.
