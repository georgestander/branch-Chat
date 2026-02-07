# Landing Showcase Spec v1 (Approval Required)

Date: 2026-02-07  
Owner: George + Codex  
Status: Proposed (do not implement until approved)

## 1. Objective
Design a world-class landing experience that:
1. Explains Branch-Chat's branching interaction fast.
2. Lets people choose between hosted usage and self-hosted OSS.
3. Creates a clear support path (donations) without blocking product entry.

This is a front-end scope only.

## 2. Success Metrics
1. Landing -> "Try Hosted" CTR >= 18%.
2. Landing -> "View Source" CTR >= 12%.
3. Hero + demo section median engagement time >= 30s.
4. Donation section conversion >= 2% of landing sessions.

## 3. Primary Audience
1. Builders who want ChatGPT-like UX with branch-native workflows.
2. Power users who need non-linear reasoning traces.
3. OSS users evaluating trust, portability, and self-hosting effort.

## 4. Experience Direction
Theme: brutalist workstation, black/white with blue accent, precise grid, high-contrast controls.

Narrative arc:
1. "What is this?" (hero)
2. "How does branching actually work?" (interactive demo)
3. "Why use it?" (value proof)
4. "How do I start?" (hosted + OSS CTAs)
5. "How do I support it?" (donations)

## 5. Information Architecture
1. Global top bar (sticky)
2. Hero + primary CTAs
3. Interactive "How Branching Works" demo
4. Value strip (3-4 differentiators)
5. Dual-path conversion section
6. Donation section
7. Footer (repo/license/docs/social)

## 6. Section-by-Section Spec

### 6.1 Sticky Top Bar
- Left: wordmark `Branch-Chat`.
- Right actions:
  - `Try Hosted`
  - `View Source`
  - `Donate`
- Behavior:
  - transparent over hero, solid after scroll threshold.
  - keyboard focus ring always visible.

### 6.2 Hero
- Headline: direct claim about non-linear chat.
- Subhead: one-sentence practical outcome.
- CTA row:
  - Primary: `Start Free (10 passes)` -> hosted/sign-in route.
  - Secondary: `Run Open Source` -> repo URL.
  - Tertiary text link: `Support this project` -> donation section anchor.
- Trust row (small): OSS, BYOK, branch-native, no lock-in.

### 6.3 Interactive Branching Demo (core differentiator)
- Layout: two-pane mini mock of parent/child conversation with branch tree rail.
- User actions:
  1. Select text span in parent message.
  2. Press `Create Branch`.
  3. Right pane opens child branch with inherited context.
  4. Breadcrumb/tree highlight updates.
- Demo controls:
  - Stepper (`Step 1/2/3`) + `Replay`.
  - Toggle: `Auto-play` on/off.
- Behavior constraints:
  - deterministic scripted data only (no remote calls).
  - client-island local state only.
  - preserve reduced motion preference.

### 6.4 Value Strip
- 3 or 4 compact blocks:
  1. "Branch at any message span"
  2. "Side-by-side parent/child context"
  3. "Hosted demo + BYOK path"
  4. "OSS and self-hostable"

### 6.5 Dual-Path Conversion (Hosted vs OSS)
- Two equal cards:
  - Hosted card:
    - "Fastest way"
    - includes 10-pass demo mention
    - CTA: `Launch Hosted`
  - OSS card:
    - "Own your stack"
    - includes short quickstart block
    - CTA: `Open GitHub Repo`

### 6.6 Donation Section
- Message: support maintenance + infra for public beta.
- Buttons (ordered):
  1. GitHub Sponsors (if enabled)
  2. Buy Me a Coffee / Ko-fi / PayPal (based on final platform choice)
  3. "Sponsor via Company" outbound contact link
- Include transparent note:
  - "Hosted demo remains free during beta; donations fund reliability and open-source maintenance."

### 6.7 Footer
- Links: repo, docs, security policy, license, changelog.
- Small legal note and build/version badge placeholder.

## 7. Component Map (Proposed)

Server components (RSC):
1. `src/app/pages/landing/LandingPage.tsx`
2. `src/app/components/landing/LandingShell.tsx`
3. `src/app/components/landing/HeroSection.tsx`
4. `src/app/components/landing/ValueStrip.tsx`
5. `src/app/components/landing/PathCards.tsx`
6. `src/app/components/landing/DonateSection.tsx`
7. `src/app/components/landing/LandingFooter.tsx`

Client islands:
1. `src/app/components/landing/BranchingDemoIsland.tsx`
2. `src/app/components/landing/TopBarClient.tsx` (scroll-state only if needed)

Routing:
1. Add `route("/landing", LandingPage)` in `src/worker.tsx`.
2. Keep `/` behavior unchanged for product flow, then optionally repoint root after approval.

## 8. Data and State Ownership
- Landing content source: server constants (or env-driven links) read on server.
- Demo state: local client state only (`step`, `selectedSpan`, `childVisible`, `autoplay`).
- No Durable Object reads/writes from landing.
- No "use server" imports into landing SSR tree.

Suggested config surface (server-only):
1. `LANDING_HOSTED_URL`
2. `LANDING_REPO_URL`
3. `LANDING_DONATE_URL`
4. `LANDING_COMPANY_SPONSOR_URL`

## 9. Accessibility Requirements
1. Full keyboard flow for demo controls and CTAs.
2. Semantic heading hierarchy (`h1` -> `h2` ...).
3. Live demo announcements via polite ARIA region for step transitions.
4. Color contrast minimum AA for all text and controls.
5. `prefers-reduced-motion` disables autoplay animations.

## 10. Responsive Behavior
1. Desktop-first, but fully usable on mobile.
2. Demo collapses from split-pane to stacked sequence below `md` breakpoint.
3. CTA bars remain above fold on common mobile viewport heights.
4. No horizontal scrolling at 320px width.

## 11. Performance Budget
1. Landing SSR CPU target <= 25ms on edge.
2. Demo island JS <= 35KB gzipped target.
3. LCP target <= 2.2s on fast 4G for hosted deployment.
4. Avoid layout shifts from late-loading media.

## 12. Analytics Events
1. `landing_view`
2. `landing_cta_click` (`cta=hosted|repo|donate`)
3. `landing_demo_step` (`step=1|2|3`)
4. `landing_demo_replay`
5. `landing_path_select` (`path=hosted|oss`)
6. `landing_donate_click` (`provider=...`)

## 13. Acceptance Criteria
1. Landing clearly communicates branching workflow in under 20 seconds of reading.
2. Interactive demo runs deterministically with no backend/network dependency.
3. Hosted and OSS paths are both visible above the fold on desktop.
4. Donation path is present, transparent, and non-intrusive.
5. Lighthouse accessibility score target >= 95 on landing route.
6. No hydration mismatch warnings on landing interactions.

## 14. Open Decisions (Need Your Approval)
1. Should `/` become landing, or keep `/` as chat and use `/landing` for marketing?
2. Final external URLs:
   - hosted app URL
   - OSS repo URL
   - donation provider URL(s)
3. Donation stack preference for South Africa (one primary + one backup).
4. Keep strict brutalist style, or soften hero visuals for broader audience?

## 15. Implementation Plan (after approval)
1. PR A: route + layout skeleton + static sections.
2. PR B: interactive branching demo island + keyboard/a11y + analytics hooks.
3. PR C: polish, copy pass, responsive refinements, performance cleanup.

No code implementation should start until section 14 decisions are approved.
