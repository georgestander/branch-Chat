# Branchy Chat

Branchy Chat is a native, local-first macOS app for non-linear conversations. Select part of any assistant reply to create a child branch, then navigate and compare the resulting conversation graph on one canvas.

The shipping app lives in `apps/desktop`. It uses Electron, SQLite, and a pinned Codex app-server with a separate ChatGPT device-code sign-in. No OpenAI API key is required.

The former RedwoodSDK/Cloudflare app remains in the repository temporarily as `@branchy/web-legacy` until native parity has completed hands-on acceptance testing.

## Demo Video

[![Watch the Branch Chat demo video](https://img.youtube.com/vi/MgnB9d0uLrI/hqdefault.jpg)](https://youtu.be/MgnB9d0uLrI)

Click the preview image to watch the YouTube demo.

## Documentation

- Desktop setup, data, security, and packaging: [`apps/desktop/README.md`](apps/desktop/README.md)
- Architecture: [`Docs/architecture.md`](Docs/architecture.md)
- Environment and release configuration: [`Docs/env-vars.md`](Docs/env-vars.md)
- Contributing: [`CONTRIBUTING.md`](CONTRIBUTING.md)

## Native Quick Start

1. Install dependencies from the repository root:
   ```bash
   pnpm install
   ```
2. Build the Apple Silicon QA app:
   ```bash
   pnpm desktop:package
   ```
3. Open `apps/desktop/out/Branchy Chat-darwin-arm64/Branchy Chat.app`.
4. Choose **Connect ChatGPT** inside Branchy and finish the device-code flow in your browser.

Branchy keeps its database, assets, and Codex credentials under `~/Library/Application Support/Branchy Chat`. It does not reuse or modify `~/.codex` or the Codex desktop app’s account state.

`desktop:package` produces an ad-hoc-signed app for local QA on the Mac that
built it. `desktop:make` places that app in a local QA DMG; the DMG itself is
not signed in QA mode. Neither path produces a Developer ID signed or notarized
release. See [`apps/desktop/README.md`](apps/desktop/README.md) for development,
testing, security, data, and release details.

## Scripts

- `pnpm desktop:dev`: Start the Electron app in development.
- `pnpm desktop:package`: Build an ad-hoc-signed local Apple Silicon app.
- `pnpm desktop:make`: Build a local DMG.
- `pnpm types`: Run TypeScript type checking.
- `npm run test`: Run Node's test runner (`node --test`).
- `npm run lint`: Run TypeScript checks as the current lint gate.
- `pnpm dev`: Start the retained legacy RedwoodSDK runtime.

## License

This project is licensed under the MIT License. See [`LICENSE`](LICENSE).
