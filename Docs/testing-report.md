# Testing Report

## 2025-02-14

- `pnpm types`
  - ✅ Passes.
- Manual chat send (OpenAI streaming)
  - ✅ Verified with local `OPENAI_API_KEY`: assistant response streams into the UI and the timeline updates once completion finishes.
- Branch UI smoke test (manual)
  - ✅ Sidebar renders root branch and active column; branch creation CTA appears on assistant messages. Child branches display their reference excerpt and inherit ancestor context in new prompts.
- Snapshot cache sanity
  - ✅ After sending a message, branch reload fetches from cache (trace shows `conversation:cache:hit`) and no redundant Durable Object reads occur.

## 2025-02-17

- Conversation directory updates (manual)
  - ⚠️ Pending: dev server was offline, so multi-chat creation/last-active refresh still needs a live verification pass after applying the directory touch fixes.
- Hydration sanity (Playwright)
  - ✅ Loads http://localhost:5173 without hydration mismatch after timestamp formatting + Document wrapper fix.
- New chat completion (manual)
  - ⚠️ Pending verification: once browser automation is available again, confirm gpt-5-nano replies stream successfully now that temperature is omitted for unsupported models.
- Branch navigation (manual)
  - ⚠️ Pending: need to re-check that branching on a secondary conversation stays within that conversation after including the `conversationId` param in navigation.
