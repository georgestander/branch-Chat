# Branchy Chat Desktop

Branchy Chat Desktop is the native macOS application in this workspace. It is Apple Silicon only.

## Run locally

From the repository root:

```bash
pnpm install
pnpm desktop:package
```

Open:

```text
apps/desktop/out/Branchy Chat-darwin-arm64/Branchy Chat.app
```

The local QA build is ad-hoc signed with the hardened runtime and a narrowly
scoped library-validation exception for Electron host processes. That
exception lets the Team-ID-less app load its separately signed Electron
framework. The build is intended only for the Mac that built it and is not
notarized for distribution. Release builds still require a Developer ID
identity and do not use the QA exception.

To run with Vite development tooling:

```bash
pnpm desktop:dev
```

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

A distributable DMG must be signed with a Developer ID Application certificate and notarized. Store Apple credentials in the macOS Keychain, never in the repository.

```bash
BRANCHY_RELEASE=1 \
BRANCHY_APPLE_SIGNING_IDENTITY="Developer ID Application: Name (TEAMID)" \
BRANCHY_APPLE_NOTARY_PROFILE="branchy-notary" \
pnpm -C apps/desktop release:mac
```

Release mode fails closed when the signing identity, notary profile, Apple Silicon host, or notarization tools are unavailable. The signing configuration excludes the bundled Codex executable and verifies its pinned checksum and OpenAI Developer ID signature after packaging.
