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
