# Connexus Architecture Notes (App Context & Durable Object Stub)

## Request Context Plumbing

- `src/worker.tsx` wraps `defineApp` with an `AsyncLocalStorage` bound to Cloudflare `Env`, ensuring every RSC request has access to environment bindings without relying on globals.
- The `provideAppContext` middleware attaches an `AppContext` to `requestInfo.ctx`, memoising per-request locals, a trace logger, the OpenAI client factory, and Durable Object accessors.
- Logging uses `[TRACE]` lines enriched with a `requestId` (Cloudflare `cf-ray` when available) to keep future observability queries consistent.

## Durable Object Stub

- `ConversationStoreDO` persists a single conversation snapshot (`ConversationGraphSnapshot`) in Durable Object storage under `conversation.store.state.v1`.
- Supported operations:
  - `GET /snapshot` — returns `{ snapshot, version }` (snapshot may be `null`).
  - `PUT /snapshot` — replaces the stored snapshot after validation.
  - `POST /apply` — accepts `append-messages` or `replace` payloads; current `append-messages` handles `message:append`, `branch:create|update`, and `conversation:update`.
  - `DELETE /snapshot` — development helper to clear state.
- All inputs round-trip through the shared validators in `src/lib/conversation/validation.ts` to guarantee structural integrity before writes.
- Each read/write logs payload sizes for observability budgeting. `cloneConversationSnapshot` keeps snapshots immutable per request.
- TODO: extend `append-messages` to enforce base-version checks and granular conflict handling once branch-level edits land.

## OpenAI Client Factory

- `AppContext.getOpenAIClient` lazily instantiates the shared OpenAI SDK client (see `src/lib/openai/client.ts`) using the Cloudflare secret `OPENAI_API_KEY`; it is cached in request-local storage to avoid duplicate initialisations.
- Downstream server functions will call this helper to ensure all OpenAI traffic is tracked via the same context-aware instance.

### Local development

- Copy `.dev.vars.example` to `.dev.vars` and set `OPENAI_API_KEY="sk-..."` before running `pnpm dev` or `pnpm worker:run`. Wrangler automatically injects these values when present.
- Production/staging deployments should use `wrangler secret put OPENAI_API_KEY` so the binding matches the `Env` type declared in `types/env.d.ts`.

## Follow-ups

1. Hardening `ConversationStoreClient.apply` to support optimistic concurrency tokens.
2. Implementing structured error envelopes (`{ code, message, retryable }`) for DO responses instead of the current message-centric errors.
3. Hooking `AppContext.trace` into a structured logger once observability sinks are defined.

## OpenAI Tooling Roadmap (Web Search & File Upload)

- **Shared server utilities**
  - `src/app/shared/openai/tools.server.ts` defines the tool registry (`web_search` built-in + `connexus_upload_file` function descriptor) alongside helpers to create `ToolInvocation` records and trace executions. The default executor currently returns a structured “not implemented” error so callers can surface graceful fallbacks until the real handlers land.
  - Tool metadata persists on `Message.toolInvocations`, allowing Durable Objects to record status transitions (`pending → running → succeeded/failed`) per assistant turn.
- **Conversation flow integration**
  - `sendMessage` will pass `getDefaultResponseTools()` into `openai.responses.stream` once the execution loop is ready. Streaming handlers will watch for `response.tool_call.*` events, call `executeToolCall`, append invocation entries to the assistant message, and submit outputs back through `responses.submit_tool_outputs`.
  - File uploads flow through a server action that stores the blob in R2, creates an OpenAI file via `client.files.create`, and pushes the metadata onto the pending user message’s `attachments` array.
- **Client entry points**
  - Composer gains an attachment button (drops into a lightweight client island) that hits the file-upload server action and emits attachment chips inline with the composer hint row.
  - Tool results render inside `BranchableMessage` using the existing markdown pipeline: web-search returns a collapsible card list; file uploads show linkable badges that reference the stored metadata.
- **Observability & safeguards**
  - Every tool runner logs `[TRACE] tools:invoke` with conversation + branch IDs, request size, latency, and whether retries occurred.
  - Failure states bubble to the UI via tool invocation metadata so the assistant can acknowledge the issue without leaving the conversation hanging.
