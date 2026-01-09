# Connexus — PRD (UI Sprint)

Date: 2026-01-09  
Owner: George  
Scope: UI-only (no server/DO/OpenAI changes)

## 1) Summary
This sprint fixes the split-view branching chat UI so content is always visible, whitespace is eliminated, branch context is obvious, and the app adopts a brutalist black/white design system with a single blue accent.

## 2) Goals
- Remove wasted whitespace and ensure chat content uses available width.
- Make branch context legible: parent origin highlight is always visible and navigable.
- Improve interaction flow: selecting a branch always shows its origin in the parent pane at the exact highlighted position.
- Improve visual clarity: stronger borders, aligned headers, and high-contrast composer.
- Apply a cohesive brutalist theme across the app (desktop-first).

## 3) Non-Goals
- No changes to Durable Objects, data schema, server actions, routing, streaming protocol, or OpenAI behavior.
- No mobile/small-screen design work; desktop-only for this sprint.
- No new “features” beyond UI behavior and styling described below.

## 4) Design System (Brutalist)
Signature move: “Spec-sheet chat workstation” — hard rules, sharp typography, strict grid, dense utility UI.

### Tokens
- Background: white (`#FFFFFF`)
- Foreground text: near-black (`#0A0A0A`)
- Muted text: dark gray (use sparingly; still high-contrast)
- Rules/borders: darker than current (target clear separation at a glance)
- Accent (links/highlights/active): blue `#1D4ED8`
- Corners: reduce softness (prefer squared / minimal radius)
- Focus: obvious, high-contrast outline (keyboard-first)

### Rules
- No soft “SaaS card” look; prefer hard borders and section rules.
- Ensure highlighted spans remain readable (no low-contrast overlays).
- Keep layout deterministic and hydration-safe.

## 5) Core UX Requirements

### PRD-UI-001 — Always-visible content (no wasted whitespace)
- The message timeline should use the available column width (remove/relax overly restrictive max-width/prose containers).
- With sidebar + parent pane open, the active branch content must remain visible and usable (no dead canvas).
- Split view can shrink via drag; no pane may become unusable due to layout constraints creating “empty space” instead of content.

### PRD-UI-002 — Desktop-only layout constraints
Enforce minimum widths:
- Active branch: 520px
- Parent branch: 360px
- Sidebar: 280px

When space is constrained (desktop resizing), prioritize keeping the active branch readable; do not implement mobile-specific layouts in this sprint.

### PRD-UI-003 — Branch navigation from highlights (parent → child)
- Clicking a highlighted selection/origin excerpt in the parent branch pane navigates to the child branch created from that highlight.
- Navigation goes to the exact position (scroll/anchor) where the highlight exists.

### PRD-UI-004 — Sidebar branch click shows origin context
When clicking a branch in the sidebar:
- Open the selected branch as the active (right) pane.
- Ensure the parent (left) pane is visible.
- Auto-scroll/align the parent pane to the “created from” highlight so the origin is immediately visible next to the child.

### PRD-UI-005 — Branch creation keeps parent aligned to origin
When creating a branch from a highlight:
- Keep the parent pane open on the left (do not collapse it).
- Auto-scroll/align to the exact highlighted origin in the parent pane.
- Ensure the new child branch is visible on the right with a clear reference to the origin.

### PRD-UI-006 — Highlight readability
- Highlighted text must remain readable (sufficient contrast, no clipping, no “can’t see text here” cases).
- Highlight styles should use the accent blue for emphasis without reducing text legibility.

### PRD-UI-007 — Header + border alignment between panes
- Parent and child branch headers must align visually:
  - same height
  - consistent padding
  - borders/rules line up across the split
- Alignment must hold regardless of drag width; match the child (right pane) header height as the baseline.

### PRD-UI-008 — Stronger chat bubble separation
- Darken/strengthen borders around chat outputs so message grouping and edges are obvious at a glance.
- Maintain a clean brutalist look (rules over shadows).

### PRD-UI-009 — Streaming scroll behavior (don’t jump to bottom)
When a new assistant response starts:
- Keep the viewport anchored so the start of the new output remains visible (do not jump straight to the bottom).
- If the user has scrolled away, respect their position (no forced scroll).

### PRD-UI-010 — Web results links must be real sources
- “Web results / source summaries” must open the external source URLs (not a new window of the app).
- Open in a new tab with safe defaults (e.g., `noopener,noreferrer`).
- The UI should display enough context to be meaningful (host + short title/snippet).

### PRD-UI-011 — Composer action bar styling
- Composer/action bar background: black
- Input text/icons: white
- Buttons: black with white text/icons (high contrast; clear hover/focus states)
- Maintain consistent brutalist styling with hard borders.

## 6) Acceptance Criteria (Definition of Done)
- With sidebar + parent open, the active branch content uses available width and no large unused whitespace remains.
- Minimum widths enforced: active 520px, parent 360px, sidebar 280px.
- Clicking a highlight in the parent pane navigates to the child branch and scrolls/anchors to the exact origin position.
- Clicking a branch in the sidebar opens that branch and aligns the parent pane to the origin highlight automatically.
- Creating a new branch keeps the parent pane open and aligned to the highlight used to create it.
- Highlighted text is readable in all tested cases (no low-contrast highlight making text disappear).
- Parent/child headers are the same height and borders align cleanly at any drag width.
- Chat bubble borders are visibly darker and clearer than before.
- Streaming keeps the start of new assistant output visible; no immediate jump-to-bottom on start.
- Web result links open external sources (verified by clicking multiple results).
- Composer bar is black with white text/icons, matching the brutalist system.

## 7) Out of Scope (Explicit)
- Any changes to conversation persistence, branching data model, streaming protocol, or server-side behavior.
- Any responsive/mobile redesign.
- Any new tool execution behavior (beyond fixing the link targets and UI).

