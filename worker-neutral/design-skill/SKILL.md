# Design Skill

**Purpose:** Worker-neutral methodology for non-trivial UI/UX design,
implementation, and review work. Ensures UI changes are verified against
rendered output and realistic content, not just source code.

**Trigger:** Use this skill for non-trivial UI/UX design, implementation, or
review/refactor tasks. Skip it for purely non-visual backend tasks and for
trivial, typo-only changes.

**Worker neutrality:** This skill is written for any worker (Codex, Claude,
Pi, or others). It contains no provider-specific commands or tooling
assumptions.

## Progressive disclosure

1. Start here (`SKILL.md`) for the trigger and execution sequence.
2. Load `DESIGN-SKILL-CONTRACT-v1.md` before any material UI work — it is the
   authoritative, frozen v1 contract (principles A–R).
3. Load `references/APPLE-SK2.md` only when rationale, provenance, or policy
   evolution history is needed. It is non-authoritative and never overrides
   the v1 contract.

## Execution sequence

Intent -> Current-State Inspection -> Design Direction -> [Divergent
Exploration, if major redesign] -> Implementation -> Rendered Evidence ->
Scenario Validation -> Design Verification -> Handoff.

## Hard gates (see contract for full detail)

- **Rendered evidence required.** Source review and tests alone are not
  sufficient evidence for a material UI change. If rendering is unavailable,
  report verification as BLOCKED/PARTIAL — never manufacture a PASS.
- **Realistic fixtures required.** Check NORMAL, EMPTY, LONG_TEXT,
  MANY_ITEMS, MISSING_OPTIONAL_DATA, WARNING, BLOCKING_ERROR, and
  COMPLETED/NO_ACTION content, as applicable. Mark inapplicable classes N/A.
- **Severity-proportional hierarchy.** Visual prominence follows
  BLOCKING/CRITICAL > ACTION REQUIRED > WARNING > INFORMATIONAL >
  NORMAL/NO ACTION. Never encode severity by color alone.
- **Semantic containers.** Every major container maps to a semantic role
  (content/control/status/decision/summary/exception/supporting detail). No
  gratuitous nested cards/frames.
- **Hierarchy before decoration.** Fix information priority, order, grouping,
  alignment, spacing, and typography before touching color, borders, or
  shadows.
- **Divergence for major redesigns.** Information architecture, navigation,
  decision-workflow, large-layout, or core-review-interface changes need 2-3
  structurally distinct candidates before implementation. Small local fixes
  are exempt.
- **No silent semantic drift.** A worker may propose hierarchy/layout/
  component changes, but must never silently change business meaning,
  required data, workflow semantics, authority/approval logic, or an already
  approved design direction. Propose an amendment instead. Silent semantic
  drift is a BLOCK condition.

## Verification gate

Before handoff, run the full checklist in contract section N (intent
preserved, rendered UI inspected, fixtures checked, severity hierarchy,
semantic containers, etc.), marking any inapplicable item N/A.

See `DESIGN-SKILL-CONTRACT-v1.md` for the complete, authoritative rule set.
