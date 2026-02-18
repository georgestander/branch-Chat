# Testing Report

## 2026-02-18

- Full local regression sweep (command-based checks)
  - ✅ `pnpm types` passes.
  - ✅ `npm run types` passes.
  - ✅ `npm run test` passes (`7/7`).
  - ✅ `npm run lint` passes.
  - ✅ `pnpm check` passes.
  - ✅ `pnpm tsc --noEmit` passes.
- Manual sweep rerun (`agent-browser` + local traces on `http://localhost:5180`)
  - ✅ Conversation directory updates: created multiple chats, switched activity between chats, verified active list/ordering refresh on latest activity.
  - ✅ New chat completion (`gpt-5-mini`): trace confirms `openai:stream:start` with `model:\"gpt-5-mini\"` and successful completion.
  - ✅ Branch navigation: branching in a secondary conversation preserved the same `conversationId` in URL + sidebar links.
  - ✅ Markdown pipeline smoke: verified rendered fenced code block, table, and KaTeX-style inline math output in assistant message.
  - ✅ Branch selection offsets: branching from formatted assistant content produced the expected excerpt in child branch metadata.
  - ❌ Code block copy UX: copy control entered `Retry` state and did not reset back to normal in the browser automation run.
  - ✅ Trace volume review: inspected `conversation:apply:*`, `openai:stream:first-token`, quota events, and retrieval traces; reasoning first-token latency spikes (~19-23s) observed.
  - ⚠️ Tool invocation scaffolding: no `tools:invoke` execution-handler path observed in this sweep; remains pending until handler wiring is exercised.
  - ✅ Composer attachments: uploaded files persisted and rendered as chips with filename + size in composer and timeline.
  - ✅ Web search result rendering: assistant output rendered source URLs and `Web Results` section with clickable links.
  - ✅ Plan-format markdown contract: response included `Short answer`, `# Plan`, structured sections, and references.
  - ✅ Agent prompt enforcement: non-plan message rendered normal markdown; plan request rendered required plan contract format.
  - ✅ Composer tool picker: verified plus-menu open, multi-selection, active tool pills, and persisted selection across send flows.
  - ✅ Study & Learn agent send (chat model): `agent:study:start`/`agent:study:success` traces observed with `gpt-5-chat-latest`.
  - ❌ Study & Learn agent send (reasoning model): `agent:study:error` with `400 Unsupported parameter: 'temperature'` on `gpt-5-mini`.
  - ✅ Root branch auto-title: fallback titling applied immediately after first message in new chats.
  - ✅ Empty-state landing: verified no-conversation landing and deferred chat creation until explicit start action.
  - ✅ Study & Learn context retention: fast-chat study run retained prior turn context across follow-up tutoring prompt.
  - ⚠️ Composer attachment retry: explicit upload transport failure + retry interaction not reproduced in this run.
  - ⚠️ Attachment cleanup on navigation: staged-upload cleanup-on-leave behavior not revalidated in this run.
  - ✅ Dev-mode upload proxy: traces show `uploads:presign:fallback` and `uploads:fallback:put` for local direct uploads.
  - ⚠️ Attachment ingestion pipeline (partial): PDF ingestion succeeded (`chunkCount:1`), DOCX ingestion failed (unsupported extension for current parse path), PNG ingest failed with OpenAI image-input parameter error.
  - ✅ Retrieval context injection: `retrieval:context` traces included both persisted web snippets and attachment chunk matches.
  - ✅ Attachment cards in timeline: message timeline rendered uploaded file metadata chips above user bubble.
  - ✅ Study & Learn workflow routing with `BUSINESSES.pdf`: file-aware tutoring response succeeded with attachment context.
  - ✅ Web search persistence behavior: follow-up question reused stored web snippets (`retrieval:context` included prior web result IDs).
  - ⚠️ `web-search:persist` success trace: explicit success marker not emitted in this run (only result + retrieval traces observed).
  - ⚠️ Study workflow wiring (`workflow_id=wf_69022bcfbab881908732f2f06cf859070311893ee1e40203`): not observed locally because `STUDY_LEARN_WORKFLOW_ID` is unset in `.dev.vars`.

## 2026-02-17

- QA go/no-go pass (local runtime)
  - ✅ `pnpm types` passes.
  - ✅ `npm run test` passes (`7/7`), including auth hardening scenarios (signed cookies, tamper rejection, header opt-in/out, legacy cookie gating).
  - ✅ `npm run lint` passes.
- Route and auth funnel smoke (manual via `pnpm dev` + curl with `AUTH_REQUIRED=true`, `AUTH_COOKIE_SECRET` set)
  - ✅ `/` returns `200`.
  - ✅ `/app` returns `401` when unauthenticated; spoofed identity headers still yield `401`.
  - ✅ `/sign-in` GET returns `200`.
  - ✅ `POST /sign-in` returns `303` + `Set-Cookie connexus_uid=...` and redirects into `/app`.
  - ✅ `/landing` returns `308` redirecting to `/`.
  - ✅ `/events?streamId=qa` returns `200 text/event-stream`.
  - ✅ Authenticated `/app` returns `200`.
  - ✅ Deep link `/?conversationId=demo&branchId=b1` redirects `307` → `/app?conversationId=demo&branchId=b1`.
- QA verdict
  - ✅ Green for public beta now that auth routes and launch-critical funnels are stable; proceed with rollout soak + high-risk manual checks.

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
- ⚠️ Pending verification: once browser automation is available again, confirm gpt-5-mini replies stream successfully now that temperature is omitted for unsupported models.
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

## 2025-10-29

- Tool invocation scaffolding (manual)
  - ⚠️ Pending: once execution handlers are wired, verify assistant tool calls append invocation metadata and surface graceful fallback when a handler returns `status: failed`.
- Composer attachments (manual)
  - ⚠️ Pending: attach a local file, confirm the upload server action persists metadata to the message’s `attachments` array, and that the UI renders a chip with filename + size.
- Web search result rendering (manual)
  - ⚠️ Pending: trigger an assistant response that uses web search, ensure result snippets render in the branch column with source URLs and that traces log `tools:invoke` with latency.
  - ✅ Updated to render clickable source list with host + snippets at the bottom of assistant messages. Confirmed the links open in a new tab and the UI shows the “web results” header once the tool completes.
- Plan-format markdown contract (manual)
  - ⚠️ Pending: prompt the assistant with a “plan” request and confirm the rendered response includes the `Short answer` line, `# Plan` heading with numbered sections, optional follow-up sections, and a `References` block with clickable blue links.
- Agent prompt enforcement (manual)
  - ⚠️ Pending: start a non-plan conversation to verify the new system prompt still produces normal markdown, and a plan conversation to confirm the same instructions trigger `Short answer` + `# Plan` without regressions.
- Sidebar branch indentation (manual)
  - ✅ Expanded a 5-level nested branch tree in the conversation sidebar; all child rows stay within the card width and truncated titles remain readable. Checked focus/hover states for active branches after indent adjustments.

## 2025-11-03

- Conversation options menu (manual)
  - ✅ In dev, opened the sidebar action menu for an active chat; Rename/Archive/Delete appear with the expected icons, close on outside click, and the rename flow still loads the branch tree before toggling the inline form.
- Archive / Unarchive conversation (manual)
  - ✅ Archived the active conversation from the options menu; the card moved to the Archived section, the active list collapsed automatically, and unarchiving returned it to the top of the active list without losing branch expansion state.
- Delete conversation (manual)
  - ✅ Deleted a secondary chat via the options menu; the card disappeared from both active and archived sections, local overrides cleared, and navigating to the default route recreated a fresh conversation snapshot on reload.

## 2025-11-04

- Split view resizing (manual)
  - ✅ Mouse drag: grabbed the vertical separator between parent and active branch columns; dragging left/right resized smoothly and respected min widths (parent ≥280px, child ≥360px). On release, a one-time debug trace logged `[TRACE] resize.complete …` with widths/ratio.
  - ✅ Collapse/expand: collapsed the parent column, then expanded it; the previous parent width restored using the last saved ratio.
  - ✅ Keyboard fallback: focused the separator (Tab) and used ArrowLeft/ArrowRight to adjust widths in ~2% steps, clamped within bounds. Child column remained full width when parent was hidden.
  - ✅ A11y/ARIA: separator exposes `role="separator"`, `aria-orientation="vertical"`, and `aria-valuenow` updates as the ratio changes; visually hidden text reads “Resize split view”.

## 2025-11-05

- Default model switch (manual)
  - ✅ Verified new conversations default to `gpt-5-chat-latest` with temperature preserved. Existing conversations retain previous settings until changed.
- DO write batching (manual)
  - ✅ Confirmed partial assistant deltas no longer persist during streaming; only initial append and final update write to DO. Observed reduced `[TRACE] conversation:apply:*` counts per send.
- First-token telemetry (manual)
  - ✅ Traces now include `openai:stream:first-token` with `dtMs` and durations for `conversation:apply:append-duration` and `conversation:apply:final-duration`.
- Settings toggle (manual)
  - ✅ Sidebar exposes Mode: Fast chat / Deep reasoning, and Effort for reasoning. Changing values persists via server action and reflects in subsequent sends.
  - ⚠️ Follow-up: Consider surfacing a brief tooltip warning about higher latency when choosing Deep reasoning + High effort.

## 2025-11-06

- SSE streaming (manual)
  - ✅ Observed live deltas in the active branch via StreamingBubble while final-only DO writes happen in the background.
  - ✅ On completion, page soft-refreshes via client navigation to display server-rendered markdown of the final assistant message.
  - ⚠️ Future: progressive markdown rendering during streaming (client-only) if needed, keeping CSP/hydration-safe behavior.

## 2025-11-06

- `pnpm tsc --noEmit`
  - ✅ Passes after adding the Study & Learn agent helper and composer tool picker changes.
- Composer tool picker (manual)
  - ⚠️ Pending: Dev server unavailable during this pass; need to verify the plus-menu opens, multi-selection works (icons stack + overflow badge), composer footprint stays stable, and blue active icons persist across sends.
- Study & Learn agent send (manual)
  - ⚠️ Pending: Requires live OpenAI credentials to confirm the new agent path appends tutor responses and records `agent:study:*` traces; rerun once sandbox access is restored.

## 2025-11-07

- `pnpm tsc --noEmit`
  - ✅ Passes after adding fallback titling and conversation landing flow.
- Root branch auto-title (manual)
  - ⚠️ Pending: Validate that sending a first message immediately renames the chat via fallback, and that a later streaming response upgrades the title when OpenAI is available.
- Empty-state landing (manual)
  - ⚠️ Pending: With no existing conversations, confirm the page renders the new landing view and only creates a chat after the user clicks “New chat”.

## 2025-11-08

- `npm run types`
  - ✅ Passes after wiring Study & Learn agent context + instructions.
- Study & Learn context retention (manual)
  - ⚠️ Pending: Re-run a multi-turn tutoring session once OpenAI access is available to confirm branch history persists, auto-titles apply, and `agent:study:*` traces include web search/tool decisions.
- `pnpm tsc --noEmit`
  - ✅ Passes after adding attachment retry UX and cleanup guard in the composer.
- Composer attachment retry (manual)
  - ⚠️ Pending: Start the dev UI to ensure failed uploads show the retry control, re-trigger the upload spinner, and keep the composer footprint unchanged.
- Attachment cleanup on navigation (manual)
  - ⚠️ Pending: With staged uploads, navigate away from the conversation and confirm the cleanup effect removes temporary objects (check DO traces once env is available).
- Dev-mode upload proxy (manual)
  - ⚠️ Pending: In local dev (no `createPresignedUrl`), confirm uploads stream through `/_uploads` without errors and that finalize succeeds.
- Study agent reasoning fallback (manual)
  - ⚠️ Pending: Toggle reasoning effort in settings, trigger Study & Learn, and confirm chat models skip reasoning params while non-chat models still accept them.
- Attachment ingestion pipeline (manual)
  - ⚠️ Pending: Upload PDF, DOCX, and image assets to verify ingestion traces, chunk counts, and that failures surface descriptive errors.
- Retrieval context injection (manual)
  - ⚠️ Pending: After uploading a document, ask follow-up questions in a new turn and confirm the assistant references retrieved snippets and cites the correct source badge.
- Attachment cards in timeline (manual)
  - ⚠️ Pending: Send a message with files and confirm the UI shows the file chips above the user bubble in both optimistic and resolved states.
- Study & Learn workflow routing (manual)
  - ⚠️ Pending: Trigger Study & Learn with BUSINESSES.pdf and verify the response matches the Agent Builder behavior and that OpenAI traces attribute to workflow `wf_69022bcfbab881908732f2f06cf859070311893ee1e40203`.
- Web search persistence (manual)
  - ⚠️ Pending: Trigger a web-search tool call, then ask a related question to ensure cached snippets appear without a new search and traces log `web-search:persist` hits.
- Study & Learn workflow wiring (manual)
  - ⚠️ Pending: Run the tutoring agent and confirm `workflow_id=wf_69022bcfbab881908732f2f06cf859070311893ee1e40203` appears in agent traces.
