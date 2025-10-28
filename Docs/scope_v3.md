# 20251027\_Non‑Linear Branching Chat — New Scope (MVP)

## 1) Scope Summary

Deliver an MVP that enables non‑linear conversations by branching from any message selection, visualizing a tree, and persisting state per branch. Single user. Pilot ready.

## 2) In Scope

- **Branch creation:** Select text → inline “Create Branch.” New branch inherits context up to selection. Optional span capture.
- **Branch navigation:** Split view (parent left, child right), resizable. Tree/breadcrumb navigator. Jump to root. Deep nesting.
- **Conversation management:** CRUD branches (rename, archive, delete with confirm). Independent composer per branch. Token and cost tracking per branch.
- **State persistence:** Cloudflare Durable Objects as authoritative store for conversation graph and messages. Client cache optional. Export/import JSON.
- **Chat engine:** OpenAI API integration with per‑branch model and instruction overrides. Streaming responses.
- **UX/A11y:** Keyboard shortcuts for branch, navigate, split toggle. Color/label accents to disambiguate branches.
- **Non‑functional targets:** 95th percentile branch switch render < 120 ms at ≤500 messages total. No data loss on reload in normal flows. Secrets in Cloudflare env.

## 3) Out of Scope (MVP)

- Realtime multiuser collaboration.
- Auth and user accounts.
- External file attachments and retrieval.
- Model fine‑tuning or third‑party tool plugins.
- Cloud sync beyond Durable Objects.
- Formal unit/E2E testing (deferred to Phase 2).

## 4) Deliverables

1. Figma prototype and interaction spec.
2. Deployed MVP web app: branching, split view, tree nav, DO persistence, OpenAI calls.
3. Admin/readme docs: setup, run, env vars, deploy.
4. Architecture doc: components, data model, extension plan.

## 5) Tech Stack and Approach

- **Runtime/Framework:** RedwoodSDK on Cloudflare Workers.
- **Frontend:** React, TypeScript, Tailwind, shadcn/ui.
- **Routing/Server Functions:** RedwoodSDK router, middleware, server functions.
- **Persistence:** Durable Objects with DO‑backed SQLite (via RedwoodSDK DO DB) for conversation graphs and messages.
- **Realtime (toggleable):** DO + WebSockets for presence/status only.
- **Storage:** R2 reserved for future attachments.
- **AI Calls:** OpenAI (gpt‑4o/gpt‑5) via server functions; stream to client.
- **CI/CD:** Wrangler deploy; environment secrets per environment.

## 6) Data Model (MVP)

```ts
Conversation {
  id: string
  rootBranchId: string
  createdAt: ISODate
  settings: { model, temperature, systemPrompt?: string }
}

Branch {
  id: string
  parentId?: string
  title: string
  createdFrom: { messageId: string, span?: { start: number, end: number } }
  messageIds: string[]
  createdAt: ISODate
}

Message {
  id: string
  branchId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: ISODate
  tokenUsage?: { prompt: number; completion: number; cost: number }
}
```

## 7) User Flows

- **Create Branch:** Select text → inline button → optional title → split view opens with parent + child.
- **Navigate Tree:** Tree panel highlights current node; click to focus; Option+←/→ jumps siblings.
- **Compare:** Side‑by‑side read‑only compare; no merge.

## 8) Acceptance Criteria

- Branching from any assistant message selection reproduces parent context up to selection.
- Split view renders parent/child with independent composers.
- Tree navigator accurately mirrors hierarchy and updates on selection.
- DO persistence survives reload; export/import reproduces a tree.
- Token usage visible per branch.

## 9) Assumptions

- Single user, single device.
- ≤500 messages, ≤50 branches per conversation.
- API keys provided and stored as Cloudflare secrets.

## 10) Timeline and Phases

| Phase                    | Items                                                                 | Output                    |
| ------------------------ | --------------------------------------------------------------------- | ------------------------- |
| D0: Discovery (2–3 days) | Wireflows, branch rules                                               | Validated prototype scope |
| D1: Design (4–5 days)    | Figma comps, shortcuts, empty states                                  | Clickable prototype       |
| S1: Core (7–10 days)     | Message list, selection, branch model, DO persistence, OpenAI adapter | Branching functional      |
| S2: UI/Tree (7–10 days)  | Split view, tree nav, export/import, Cloudflare deploy                | MVP feature‑complete      |
| Polish (2–3 days)        | Perf pass, UX fit‑and‑finish                                          | Release candidate         |

## 11) Risks and Mitigations

- **Large trees:** Virtualized tree list; branch search/filter.
- **Selection granularity ambiguity:** Default to message‑level; optional span capture; clear UI affordances.
- **Costs/latency:** Token tracking per branch; model selection per branch; caching prompts where safe.

## 12) Change Control

- Changes logged in backlog; estimate and approve before work. Minor UX copy tweaks allowed without change order.

## 13) Warranty & Support

- 14‑day bug‑fix window post‑acceptance. Fixes limited to MVP scope.

