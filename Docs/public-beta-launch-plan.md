# Branch-Chat Public Beta Plan (4 Weeks)

## Summary
Build a public beta that feels close to ChatGPT quality while preserving the branching differentiator.

Primary objective: stability and UX quality first, then auth/quota/BYOK, then design polish + landing + study mode uplift, then OSS hardening.

## Locked Decisions
1. Launch scope: public beta.
2. First sprint focus: stability + UX bugs.
3. Auth: Clerk with Google + GitHub + email.
4. Usage model: dual lane (hosted demo + BYOK).
5. Demo quota: 10 lifetime passes; 1 completed assistant reply = 1 pass.
6. Quota identity: authenticated users only.
7. Cap behavior: prompt BYOK and continue.
8. Start mode: presets + advanced drawer.
9. UI direction: ChatGPT-parity clean.
10. Reasoning UX: progress + reasoning summaries only.
11. Study mode shape: Socratic tutor.
12. OSS scope: full app OSS.
13. BYOK key handling: encrypted server storage.
14. Landing CTA: Start free (10 passes).
15. Free model routing: curated OpenRouter primary + one backup; auto-fallback once.
16. Demo web search: enabled.
17. Data migration: clean cutover for beta.

## Success Criteria
1. Sidebar/parent collapse behavior is predictable and no longer shifts focus incorrectly.
2. Web Search toggle persists across branch creation/switching in the same conversation.
3. Streaming is visibly live with incremental text, tool/progress states, and reasoning summaries when available.
4. No forced full-page refresh at stream completion for normal happy path.
5. Auth, ownership checks, and per-user quotas are enforced server-side.
6. Demo users are capped at 10 replies; BYOK users can continue seamlessly.
7. Start mode lets users pick preset/model/reasoning/tools before first message.
8. Landing page converts users into signed-in free demo flow.
9. Study mode produces guided, stepwise tutoring behavior (not answer-dumping).
10. OSS forkability is clear via docs and setup flow.

## Execution Status (2026-02-07)
- [x] `P2-T1` Clerk-auth-required middleware gate (`depends_on: []`)
  Work log: Added `AUTH_REQUIRED` flag gate in `src/worker.tsx` and auth helper updates in `src/app/shared/auth.server.ts`; unauthenticated chat requests now return `401` when enabled, while `/_uploads` and `/events` remain auth-optional.
  Files: `src/worker.tsx`, `src/app/shared/auth.server.ts`, `types/env.d.ts`
  Notes: uses header/cookie identity plumbing already present; Clerk upstream integration remains the identity source.
- [x] `P2-T2` OpenRouter demo primary->backup retry (`depends_on: []`)
  Work log: Added one-time fallback on stream initialization failure for demo lane OpenRouter requests; routes to configured primary model then retries once with backup model if configured and distinct.
  Files: `src/app/pages/conversation/functions.ts`
  Notes: BYOK lane unchanged; trace logs added for route/fallback attempt/success/failure.
- [x] `P1-T4` Stream completion without forced page refresh (`depends_on: [P1-T3]`)
  Work log: Replaced hard navigation refresh on `stream:complete` with persisted message reconciliation events (`connexus:message:persisted`) so final assistant output appears in-place.
  Files: `src/app/components/conversation/messageEvents.ts`, `src/app/components/conversation/ConversationComposer.tsx`, `src/app/components/conversation/BranchColumn.tsx`
  Notes: optimistic user messages now resolve against client-persisted message IDs; no reload on normal completion.
- [x] `P3-T2` Landing conversion path copy + CTA (`depends_on: []`)
  Work log: Empty-state hero now surfaces “Start free with 10 demo passes” and explicit sign-in CTA while preserving start-mode onboarding controls.
  Files: `src/app/components/conversation/ConversationEmptyLayout.tsx`
  Notes: unauthorized create errors now return sign-in specific guidance.
- [x] `P2-T1b` Sign-in route implementation for landing CTA (`depends_on: [P2-T1]`)
  Work log: Added `/sign-in` Redwood route and server-rendered POST flow that sets `connexus_uid` then redirects; middleware now treats `/sign-in` as auth-optional and skips guest cookie persistence there.
  Files: `src/app/pages/sign-in/SignInPage.tsx`, `src/worker.tsx`, `src/app/shared/auth.server.ts`
  Notes: closes prior CTA 404 gap and removes duplicate guest+user cookie writes during sign-in.
- [x] `P3-T3` Start mode presets + advanced drawer (`depends_on: [P3-T4]`)
  Work log: Added deterministic start presets (`fast`, `reasoning`, `study`, `custom`) and advanced model/reasoning/tool controls in landing flow.
  Files: `src/app/components/conversation/ConversationEmptyLayout.tsx`
  Notes: presets map to deterministic model/reasoning/tool combinations before first message.
- [x] `P3-T4` Persist preset/model/reasoning/tools as composer defaults (`depends_on: []`)
  Work log: Extended conversation settings schema + validation with `composerDefaults`; wired create/update settings APIs and composer persistence path.
  Files: `src/lib/conversation/model.ts`, `src/lib/conversation/validation.ts`, `src/app/shared/conversation.server.ts`, `src/app/pages/conversation/functions.ts`, `src/app/components/conversation/ConversationLayout.tsx`, `src/app/components/conversation/ConversationComposer.tsx`, `src/app/components/conversation/BranchColumn.tsx`
  Notes: legacy snapshots auto-migrate with inferred presets.
- [x] `P4-T1/T2` Study mode Socratic contract + rubric guardrails (`depends_on: []`)
  Work log: Introduced explicit study contract and output rubric normalization (`Next step`, `Comprehension check`, `Recap`, `Your turn`) with anti-answer-dump fallback for homework-like prompts.
  Files: `src/app/shared/openai/studyAndLearnAgent.server.ts`, `src/app/pages/conversation/functions.ts`
  Notes: success traces now include guardrail metadata.
- [x] `P4-T3/T4` OSS docs + basic real lint/test scripts (`depends_on: []`)
  Work log: Replaced starter README, added architecture/setup/env references plus `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`; replaced placeholder `test`/`lint` scripts with executable checks.
  Files: `README.md`, `package.json`, `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, `Docs/architecture.md`, `Docs/setup.md`, `Docs/env-vars.md`
  Notes: local dev docs aligned to strict port `5174`.

## Important API / Interface / Type Changes
1. Extend conversation ownership and defaults in `src/lib/conversation/model.ts`.

```ts
type ComposerPreset = "fast" | "reasoning" | "study" | "custom";

interface ComposerDefaults {
  preset: ComposerPreset;
  tools: ConversationComposerTool[];
}

interface ConversationSettings {
  model: string;
  temperature: number;
  reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh" | null;
  systemPrompt?: string;
  composerDefaults: ComposerDefaults;
}

interface Conversation {
  id: ConversationModelId;
  ownerId: string;
  rootBranchId: BranchId;
  createdAt: string;
  settings: ConversationSettings;
}
```

2. Extend `createConversation` and `sendMessage` contracts in `src/app/pages/conversation/functions.ts`.

```ts
type CreateConversationInput = {
  initialMessage?: string;
  preset?: ComposerPreset;
  model?: string;
  reasoningEffort?: ConversationSettings["reasoningEffort"];
  tools?: ConversationComposerTool[];
};

type SendMessageResponse = {
  conversationId: string;
  snapshot: ConversationGraphSnapshot;
  version: number;
  appendedMessages: Message[];
  quota: { lane: "demo" | "byok"; remainingDemoPasses: number | null };
};
```

3. Add auth context in `src/app/context.ts` and `src/worker.tsx`.

```ts
interface AppAuth {
  userId: string;
  email?: string | null;
}

interface AppContext {
  auth: AppAuth;
  // existing fields...
}
```

4. Replace fragile streaming UI protocol with explicit event schema in `src/app/components/conversation/streamingEvents.ts`.

```ts
type StreamEvent =
  | { type: "start"; startedAt: string }
  | { type: "output_delta"; delta: string }
  | { type: "reasoning_summary_delta"; delta: string }
  | { type: "tool_status"; tool: string; status: "running" | "succeeded" | "failed" }
  | { type: "complete"; content: string; messageId: string }
  | { type: "error"; message: string };
```

5. Add account/quota/BYOK server interfaces in a new account module.

```ts
interface AccountState {
  userId: string;
  demo: { total: number; used: number };
  byok: { provider: "openrouter"; encryptedKey?: string; updatedAt?: string };
}
```

## Implementation Plan

## Phase 1 (Week 1): P0 interaction and streaming reliability
1. Fix collapse coupling in `src/app/pages/conversation/ConversationPage.tsx` and `src/app/components/conversation/ConversationLayout.tsx`; stop using one flag for both sidebar and parent pane state.
2. Persist composer tool defaults at conversation level; initialize composer from `conversation.settings.composerDefaults` in `src/app/components/conversation/ConversationComposer.tsx`; eliminate branch-switch reset.
3. Upgrade streaming loop in `src/app/pages/conversation/functions.ts` to emit true deltas and reasoning summary deltas; reduce throttling to near-token cadence with backpressure safeguards.
4. Update `src/app/components/conversation/StreamingBubble.tsx` and `src/app/components/conversation/BranchColumn.tsx` to append incremental deltas and reconcile completion without forced navigation refresh.
5. Harden web-search availability checks in `src/lib/openai/models.ts`; avoid brittle hardcoded assumptions where possible and keep explicit fallback behavior.

## Phase 2 (Week 2): Auth, ownership, demo quota, BYOK
1. Add Clerk auth middleware in `src/worker.tsx`; require auth before chat interactions.
2. Enforce conversation ownership on all read/write server functions in `src/app/pages/conversation/functions.ts`.
3. Add account state store (new DO + client) for demo usage and BYOK encrypted key storage.
4. Add encryption utility using Web Crypto AES-GCM with key from worker secret; store only ciphertext, iv, and version.
5. Add provider abstraction for OpenAI/OpenRouter; route demo lane to curated OpenRouter primary and one backup.
6. Add quota reserve/commit/release semantics around streaming so failed generations do not consume passes; consume only on completed assistant response.

## Phase 3 (Week 3): UI system, landing page, start mode controls
1. Implement cohesive "ChatGPT-parity clean" design tokens in `src/app/styles.css`; unify spacing, typography, surfaces, borders, and state colors.
2. Replace starter empty state with conversion landing in `src/app/components/conversation/ConversationEmptyLayout.tsx`; CTA path is sign in then start free.
3. Add Start mode presets and advanced drawer in composer/landing flow; presets map deterministically to model/reasoning/tool defaults.
4. Ensure selected preset/model/reasoning/tools are passed into `createConversation` and persisted as `composerDefaults`.

## Phase 4 (Week 4): Study mode overhaul, OSS hardening, launch readiness
1. Refactor Study & Learn in `src/app/shared/openai/studyAndLearnAgent.server.ts` into Socratic workflow behavior; enforce one-step guidance, comprehension checks, and recap blocks.
2. Add explicit study prompt contract and output rubric; prevent direct answer dumping for homework-like prompts.
3. Update project docs for OSS adoption: `README.md`, add `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, architecture/setup docs, env var reference.
4. Add basic real test/lint scripts in `package.json` and pass gates before release.

## Runtime Data Flow
1. User signs in via Clerk; middleware injects `ctx.auth.userId`.
2. `createConversation` writes conversation with `ownerId` and defaults.
3. `sendMessage` loads owner-verified conversation; resolves lane.
4. Demo lane reserves pass; BYOK lane decrypts user key.
5. Response stream emits `output_delta`, optional `reasoning_summary_delta`, and tool status events.
6. On successful completion, server commits pass usage for demo lane and persists final assistant message.
7. Client reconciles stream to final message and updates quota indicator.

## Test Cases and Scenarios
1. Sidebar collapse toggles do not auto-collapse parent pane unless explicitly requested.
2. Branch creation no longer clears selected tools; Web Search remains active when previously enabled.
3. Streaming shows incremental words/chunks with no large buffering jumps.
4. Reasoning summary stream appears only when model emits summary events.
5. Tool progress states update in-stream and close cleanly on completion/error.
6. No full-page navigation refresh on normal stream completion.
7. Unauthorized conversation access is rejected across list/load/send/rename/archive/delete.
8. Demo lane consumes pass only after completed assistant message.
9. Stream failure does not consume pass.
10. At 10 passes, send is blocked and BYOK connect prompt appears.
11. BYOK encrypted key can be saved, loaded, rotated, and revoked.
12. OpenRouter primary failure triggers one backup retry, then clear error.
13. Start mode preset correctly applies model/reasoning/tools to first and subsequent turns.
14. Study mode asks one guiding step at a time and includes recap/checkpoint behavior.
15. Web search remains enabled in demo and citations/sources render correctly.

## Rollout and Observability
1. Roll out behind feature flags: `auth_required`, `quota_enforced`, `byok_enabled`, `stream_v2`, `study_v2`, `new_landing`.
2. Deploy internal first; run focused regression suite on branching, streaming, auth, and quota.
3. Enable public beta once error budgets hold for 72h.
4. Track p95 first-token latency, stream error rate, pass commit failures, auth failures, and branch switch render latency; log with conversationId/branchId/userId hashes.
5. Add graceful fallback states for all stream/account/provider failures.

## Assumptions and Defaults
1. Pre-auth data is not migrated; beta starts with clean ownership model.
2. Demo is authenticated-only; no anonymous usage.
3. Pricing/paywall beyond BYOK prompt is out of scope for this beta.
4. Mobile-specific redesign is out of scope; desktop-first quality targeted.
5. Free model IDs are operator-configurable via environment variables; implementation includes primary + backup config with deterministic fallback behavior.
6. OpenAI reasoning UX uses summaries/progress only; no raw chain-of-thought display.
