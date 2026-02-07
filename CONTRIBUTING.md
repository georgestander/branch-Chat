# Contributing

Thanks for contributing to Branch Chat.

## Development Setup

1. Install dependencies:
   ```bash
   pnpm install
   ```
2. Copy local environment file:
   ```bash
   cp .dev.vars.example .dev.vars
   ```
3. Add required values to `.dev.vars` (see `Docs/env-vars.md`).
4. Start dev server:
   ```bash
   pnpm dev
   ```

## Architecture Rules

- Keep the app server-first: branch logic, persistence, and OpenAI calls stay on the server.
- Use RedwoodSDK routing and server functions instead of custom REST endpoints.
- Durable Objects are the source of truth for conversation state.
- Do not introduce D1 for this project.
- Keep client components thin and interaction-focused.

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

## Pull Request Notes

- Include a short summary of behavior changes.
- Add manual validation notes for happy-path and failure-path checks.
- Mention any follow-up work or known limitations.
