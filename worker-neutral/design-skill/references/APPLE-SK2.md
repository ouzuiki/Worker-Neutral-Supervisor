# APPLE-SK2 — Reference Rationale

**NON-AUTHORITATIVE REFERENCE.** This document is background rationale and
provenance only. It does NOT override, extend, or add obligations beyond
`../DESIGN-SKILL-CONTRACT-v1.md`. Where anything here appears to conflict with
the v1 contract, the v1 contract governs.

## Purpose

This file summarizes generalized design-methodology patterns that informed
this skill's v1 contract, drawing on publicly observable Apple design tooling,
guidance, and agent/skill demonstrations. It exists so future maintainers can
understand *why* v1's rules exist and *where* the pattern-mining came from,
without pulling that provenance discussion into the authoritative contract
itself.

## Important distinction: Apple sources vs. our generalization

- The bullet points below are **our extracted, generalized patterns**,
  written in our own words for worker-neutral reuse. They are not verbatim
  Apple text.
- Where a pattern is attributed to "Apple guidance," that means: publicly
  observable Apple developer documentation, WWDC/developer videos, Human
  Interface Guidelines (HIG) content, or publicly demonstrated Apple design
  agent/skill workflows (e.g., Xcode-integrated design/coding assistants).
- We do NOT claim to reproduce or have access to Apple's internal SKILL.md
  or internal prompt/skill source text line-by-line. Public web materials
  confirm the existence of Apple-authored Xcode specialists/skills and
  associated workflows, but the fully exported SwiftUI/Accessibility skill
  sources are obtained by exporting them from Xcode's own tooling, not by
  Apple publishing them line-by-line on GitHub (contrast this with e.g.
  Apple's Game Porting Toolkit, which is openly published on GitHub).
- Any inference, synthesis, or generalization in this document is ours, not
  Apple's, and should be read as "patterns we mined and adapted," not as a
  transcript of Apple material.

## Patterns mined (relevant to this v1 contract)

- **Intent Before Interface** — establish what the user/task/decision is
  before generating visual solutions. Informs contract sections A, L.
- **Go Wide -> Remix -> Repeat** — generate multiple structurally distinct
  directions before converging, then allow remixing across them. Informs
  contract section H.
- **Realistic-content prototyping** — validate layouts against representative,
  messy, real-shaped content rather than idealized placeholder data. Informs
  contract section D.
- **Rendered UI as evidence/self-verification** — treat the actual rendered
  output, inspected by the agent/worker itself, as the unit of verification,
  not just the source diff. Informs contract sections B, C.
- **Variant validation** — check a design against multiple realistic states/
  variants, not a single happy-path render. Informs contract sections C, D, N.
- **Human creative authority** — the design system/agent proposes; a human
  or product authority retains final decision-making power, especially over
  semantics and requirements. Informs contract section M.
- **Semantic visual layers** — visual containers/layers should correspond to
  a semantic role in the interface, not be arbitrary nesting for visual
  effect. Informs contract section F.
- **Hierarchy before decoration** — structural/information-hierarchy fixes
  precede stylistic polish. Informs contract section G.
- **Simplicity != minimalism** — reducing cognitive load is the goal; this is
  not the same as reducing visible element count or information density.
  Informs contract section I.
- **Severity-proportional feedback** — the intensity of visual feedback should
  scale with the actual severity/urgency of the underlying state. Informs
  contract section E.
- **Multi-channel status encoding** — status/severity should be legible
  through more than one channel (text, icon, position), not color alone.
  Informs contract section E.
- **Familiar patterns** — reach for standard, well-understood UI controls
  before inventing bespoke interaction models. Informs contract section J.
- **Adaptive UI** — design for varying viewport, content length, and dynamic
  states from the outset, not as a later-stage fix. Informs contract
  section K.
- **Accessibility integrated from start** — accessibility is treated as a
  first-class, ongoing design concern rather than a final audit pass.
  Informs contract section R (acknowledged, not expanded into a full
  standard in v1 — see contract section P).

## Compact source list (Apple official URLs only)

- https://developer.apple.com/design/human-interface-guidelines
- https://developer.apple.com/videos/
- https://developer.apple.com/documentation/
- https://developer.apple.com/accessibility/

This list is intentionally compact and non-exhaustive; it anchors provenance
rather than serving as a full bibliography.

## Relationship to the authoritative contract

This file exists to preserve rationale and provenance for maintainers. It:

- MUST be treated as background reading, loaded only when rationale,
  provenance, or policy-evolution context is needed.
- MUST NOT be cited as an independent source of obligations.
- MUST NOT be updated to add new rules — new rules belong in a new version of
  `../DESIGN-SKILL-CONTRACT-v1.md` (e.g. a v2), not here.
