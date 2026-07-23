# Contributing

Thanks for contributing to Branch Chat.

## Desktop Development Setup

1. Install dependencies:
   ```bash
   pnpm install
   ```
2. Start the current Electron application:
   ```bash
   pnpm desktop:dev
   ```
3. To test the packaged application, build the local QA app:
   ```bash
   pnpm desktop:package
   ```

No OpenAI API key or `.dev.vars` file is required for desktop development.
Connect ChatGPT through the in-app device-code flow. See
`apps/desktop/README.md` for the isolated runtime, local data, security, and
packaging details.

## Architecture Rules

- Keep the sandboxed renderer behind the typed preload and IPC boundaries.
- Keep persistence, assets, Codex orchestration, and ChatGPT credentials out of
  the renderer.
- Preserve Branchy’s isolated application data and Codex home. Do not reuse
  `~/.codex`.
- Keep branch behavior shared through `@branchy/conversation-core` where the
  desktop and retained web implementations require the same domain rule.

## Retained Legacy Web Runtime

The repository-root `pnpm dev` command starts `@branchy/web-legacy`, the former
RedwoodSDK/Cloudflare application retained during native parity work. Use it
only when intentionally changing the legacy web runtime. Its `.dev.vars` and
Cloudflare bindings are documented in the legacy section of
`Docs/env-vars.md`.

## Change Scope

- Keep diffs small and focused.
- Prefer one logical change at a time.
- Avoid touching unrelated files or in-progress work from other contributors.

## Validation Before PR

Run all checks locally:

```bash
pnpm types
npm run test
npm run lint
```

## Required CI Checks

PRs must pass these GitHub checks before merge:

- `CI / preflight`
- `CI / types`
- `CI / test`
- `CI / lint`
- `CI / build`
- `Security / dependency-review`

`CI / preflight` also blocks unresolved merge markers and `package.json` changes without a matching `pnpm-lock.yaml` update.

## Pull Request Notes

- Include a short summary of behavior changes.
- Add manual validation notes for happy-path and failure-path checks.
- Mention any follow-up work or known limitations.
- Wait for all required checks to turn green before requesting merge.
