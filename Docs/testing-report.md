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

## 2025-02-15

- Composer auto-scroll (manual)
  - ✅ With long conversations, sending a new message keeps the floating composer in view while streaming. Manually scrolling upward pauses auto-scroll until returning near the bottom.
- Floating composer layout (manual)
  - ✅ Verified via Playwright on http://localhost:5173: message scroller height capped (~404px) while composer stays in viewport (`textarea.top≈582px`) even with `scrollTop=0`, confirming the composer floats as intended.

## 2025-02-17

- Conversation directory updates (manual)
  - ⚠️ Pending: dev server was offline, so multi-chat creation/last-active refresh still needs a live verification pass after applying the directory touch fixes.
- Hydration sanity (Playwright)
  - ✅ Loads http://localhost:5173 without hydration mismatch after timestamp formatting + Document wrapper fix.
- New chat completion (manual)
  - ⚠️ Pending verification: once browser automation is available again, confirm gpt-5-nano replies stream successfully now that temperature is omitted for unsupported models.
- Branch navigation (manual)
  - ⚠️ Pending: need to re-check that branching on a secondary conversation stays within that conversation after including the `conversationId` param in navigation.

## 2025-02-19

- `pnpm check`
  - ✅ Passes.
- Markdown pipeline smoke test (manual)
  - ⚠️ Pending: load a conversation with code blocks, tables, and KaTeX to verify the server-rendered highlight.js output matches ChatGPT styling (Shiki blocked in workerd runtime).
- Branch selection offsets (manual)
  - ⚠️ Pending: confirm selecting formatted assistant text still stores accurate spans for branch highlighting post-render.
- Code block copy UX (manual)
  - ⚠️ Pending: verify the copy button copies highlighted code to the clipboard and resets state after success/error.
- Trace volume (manual)
  - ⚠️ Pending: review recent `conversation:apply`/OpenAI traces and decide on sampling before enabling in production logs.
