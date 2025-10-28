# Testing Report

## 2025-02-14

- `pnpm types`
  - ✅ Passes.
- Manual chat send (OpenAI streaming)
  - ⚠️ Not exercised locally because `OPENAI_API_KEY` is not configured in this environment. Once a key is available, verify that `sendMessage` returns the assistant response and that the timeline refreshes without a reload.
