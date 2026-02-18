# Architecture

## Overview

Branch Chat is a Cloudflare Worker app using RedwoodSDK RSC. The architecture is server-first:

- Server components fetch and shape view data.
- Server functions handle writes and chat orchestration.
- Durable Objects store canonical conversation/account state.
- Client components orchestrate UI interactions only.

## Runtime Components

- Worker entry: `src/worker.tsx`
- Document shell + CSP nonce bootstrapping: `src/app/Document.tsx`
- Client navigation bootstrap: `src/client.tsx`
- Primary page: `src/app/pages/conversation/ConversationPage.tsx`
- Server actions: `src/app/pages/conversation/functions.ts`

## Durable Object Topology

- `ConversationStoreDO` (`ConversationGraphDO` binding)
  - One object per conversation via `idFromName(conversationId)`.
  - Stores the conversation graph snapshot, message map, and retrieval artifacts.
- `ConversationDirectoryDO` (`ConversationDirectoryDO` binding)
  - Singleton object via `idFromName("conversation-directory")`.
  - Stores conversation directory metadata for sidebar/list views.
- `AccountDO` (`AccountDO` binding)
  - One object per user via `idFromName("account:<userId>")`.
  - Stores encrypted BYOK metadata and composer preferences.

## Request and Data Flow

1. `src/worker.tsx` middleware builds request context (auth, env bindings, per-request clients).
2. `ConversationPage` loads directory entries + active conversation snapshot from Durable Objects.
3. Client UI interactions trigger `"use server"` actions in `functions.ts`.
4. Server actions update Durable Objects sequentially and return updated snapshots.
5. For streamed chat responses:
   - `/events?streamId=...` exposes SSE streams.
   - OpenAI response deltas are forwarded through SSE.
   - Final assistant message and usage data are persisted to the conversation DO.

## State Model

Core schema is defined in `src/lib/conversation/model.ts`:

- `Conversation` (root branch + settings)
- `Branch` (parent linkage + message ID list + source span metadata)
- `Message` (role/content/token usage/tool invocation state)
- `ConversationGraphSnapshot` (single snapshot object persisted in DO state)

Validation and normalization helpers live in `src/lib/conversation/validation.ts`.

## Security and Observability

- Auth is resolved from headers/cookies in `src/app/shared/auth.server.ts` with optional guest fallback.
- Security headers and CSP are applied in `src/app/headers.ts`.
- RSC bootstrap script uses request nonce in `Document.tsx`.
- Structured trace logs include request/conversation/branch identifiers for DO and model operations.
