# Branchy Chat Visual Language

## Purpose

This document is the durable visual contract for Branchy Chat across the retained RedwoodSDK web application and Electron desktop application. It prevents individual features, agents, and generated code from drifting into generic component-library or AI-generated aesthetics.

Use it before changing a user-facing surface. Feature-specific design specifications may add constraints, but they should not silently replace this vocabulary.

## Visual Thesis

Branchy Chat is a focused thinking workspace: calm, flat, precise, and spatial. The interface should make conversation lineage and the current writing context immediately legible without surrounding the work in decorative chrome.

The canvas is the product's distinctive visual idea. Branch relationships, selected context, and active work should carry the personality—not gradients, inflated cards, ornamental illustrations, or marketing-style copy.

## Composition

- Design around the active conversation, its spatial lineage, and the composer.
- Use asymmetric or spatial composition when it clarifies branching. Do not force the canvas into a centered document column or generic dashboard grid.
- Keep navigation and account controls visually subordinate to the thinking surface.
- Prefer open layout, restrained separators, and changes in spacing or tone over nested containers.
- A card is justified when it is the manipulable branch object, a temporary overlay, or a genuinely bounded interaction. Ordinary explanatory content does not become a card by default.
- Avoid repeated rows of interchangeable feature cards, equal-weight dashboard tiles, and vertically stacked full-width sections with centered headings.

## Color

- Use the existing neutral black, white, and gray foundation with the established warm red product accent.
- Communicate branch lineage through spatial topology, labels, breadcrumbs, and neutral marks. Branch cards, connectors, selection rails, outlines, and shadows remain neutral; do not assign lineage colors to canvas chrome.
- Keep the warm red accent out of branch edges and elevation. Reserve it for established branded, destructive, or error states where color communicates an actual action or condition.
- Do not introduce purple-to-blue gradients, default Tailwind indigo/violet palettes, or extra accent colors merely to create visual interest.
- Do not use gradients as a substitute for hierarchy, imagery, or composition. A gradient is acceptable only when it communicates a real state or is part of an explicitly approved visual artifact.
- Maintain WCAG AA contrast for text and controls in both light and dark themes.

## Typography

- The current product typography is an inherited constraint for existing surfaces. Match it consistently across web and desktop until a deliberate product-wide typography decision replaces it.
- Do not treat Inter, system UI, or any fashionable display face as an automatic choice for new products or new visual systems.
- Establish hierarchy through size, weight, line height, measure, and spacing before introducing another typeface.
- Keep dense application labels direct and scannable. Avoid landing-page language inside the workspace.

## Radius, Boundaries, and Elevation

- Use the established restrained radius vocabulary; do not introduce `rounded-2xl` or `rounded-3xl` styling as a default.
- Prefer one visible boundary. Do not stack a border, inner ring, outer ring, and shadow around the same surface.
- Ordinary panels and branch objects remain flat. Use neutral tone or a restrained border before using a shadow.
- Reserve elevation for temporary layers that physically overlap the workspace: menus, popovers, dialogs, dragged objects, and similar transient UI.
- Never add hover halos, colored outlines, or glow effects to compensate for weak hierarchy.

## Copy

- Use concrete product language describing an object, state, or action.
- Headings should orient the user: what this is, what happened, or what they can do.
- Do not ship placeholder claims such as “Empower your workflow,” “Unlock productivity,” “Transform your conversations,” “Seamless integration,” or “Built for modern teams.”
- Avoid generic enthusiasm, design commentary, and claims without evidence.
- Empty states should name the next useful action without pretending the absence of data is an inspirational moment.

## Interaction and Motion

- Motion should explain canvas movement, branching, selection, streaming progress, reconciliation, or appearance of a temporary layer.
- Keep transitions brief and interruptible. Respect reduced-motion preferences.
- Do not add entrance choreography, parallax, floating decoration, or hover movement without a product reason.
- Preserve visible focus, keyboard navigation, text selection, and stable target positions.

## Required Design Workflow

Before implementation:

1. Inspect the affected surface, tokens, neighboring components, and any approved visual reference.
2. Write three short statements: visual thesis, content hierarchy, and interaction plan.
3. Identify which existing tokens and component patterns will be reused.
4. Call out any deliberate exception to this document before coding it.

During implementation:

1. Build the information hierarchy and composition first.
2. Add containers, borders, radius, color, and motion only when each serves a named purpose.
3. Keep web and desktop vocabulary aligned when the same product concept appears in both.
4. Use real product content or representative fixtures rather than polished placeholder marketing copy.

Before completion:

1. Run the repository's required type, test, and lint gates.
2. Verify the result in a real browser or packaged desktop app, as applicable.
3. Capture representative screenshots for each affected theme and important viewport.
4. Review normal, hover, focus, active, disabled, loading, empty, error, overflow, and reduced-motion states where relevant.
5. Compare the result with any approved reference and with neighboring product surfaces.
6. Apply the anti-template review below.

## Anti-Template Review

Do not approve the work until the answer is defensible:

- Could this composition have come unchanged from a generic SaaS starter?
- Are cards being used as automatic wrappers rather than meaningful objects?
- Did framework-default colors, radii, shadows, type, or spacing make the design decisions?
- Is decoration compensating for weak hierarchy?
- Does the copy sound generated, abstract, or interchangeable with another product?
- Is the product's branching model visually unmistakable?
- Would the design remain coherent if all non-essential shadows and gradients were removed?
- Does the feature belong to the same product in both light and dark themes?

If the interface still looks generated, do not add more polish. Rework the composition, hierarchy, vocabulary, or copy that caused the resemblance.
