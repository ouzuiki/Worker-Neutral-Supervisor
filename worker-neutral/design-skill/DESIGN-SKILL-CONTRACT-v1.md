# Design Skill Contract — v1

- Version: 1.0.0
- Status: FROZEN (authoritative within this skill)
- Owner: Worker-Neutral-Supervisor (WNS) — shared, worker-neutral Design Methodology
- Scope: Reusable UI/UX design methodology contract for any worker (Codex, Claude,
  Pi, or others) performing non-trivial UI/UX design, implementation, or review
  work in any project that adopts this skill. This document is project-neutral:
  it MUST NOT encode Pet Hotel or any other project-specific business rules.
  Project-specific overlays belong in that project's own repo, layered on top
  of this contract, never edited into it.

This contract is the authoritative source of truth for the Design Skill. The
companion `references/APPLE-SK2.md` is non-authoritative rationale only and
MUST NOT be treated as a source of obligations independent of this document.

## A. Core completion rule

UI work is NOT complete when code is written. A material UI change MUST have:

1. Intent preserved,
2. Realistic content tested,
3. Rendered output inspected,
4. Critical variants checked,
5. Visual hierarchy matching business priority.

A worker MUST NOT report a material UI change as done on the basis of source
review or unit tests alone.

## B. Required workflow

Intent -> Current-State Inspection -> Design Direction -> Implementation ->
Rendered Evidence -> Scenario Validation -> Design Verification -> Handoff.

For a major redesign (see H), a Divergent Exploration step is inserted between
Design Direction and Implementation.

## C. Rendered Evidence Required

Source inspection or automated tests alone are insufficient evidence of visual
correctness. The required loop is:

Modify -> Render -> Inspect -> Compare -> Correct -> Render Again.

- A worker MUST NOT claim a visual PASS without rendered evidence when
  rendering is available and applicable to the change.
- If runtime rendering is unavailable in the current environment, the worker
  MUST report verification as BLOCKED or PARTIAL, with the reason stated, and
  MUST NOT manufacture a PASS result.

## D. Realistic Content Stress Testing

Material UI changes MUST be checked against realistic content fixture classes,
as applicable to the surface under change:

- NORMAL
- EMPTY
- LONG_TEXT
- MANY_ITEMS
- MISSING_OPTIONAL_DATA
- WARNING
- BLOCKING_ERROR
- COMPLETED / NO_ACTION

A layout validated only against ideal/demo data is not validated. Not every
fixture class applies to every surface; inapplicable classes MUST be marked
N/A rather than silently skipped.

## E. Severity-Proportional Visual Hierarchy

Visual prominence MUST be proportional to severity, in this order:

BLOCKING/CRITICAL > ACTION REQUIRED > WARNING > INFORMATIONAL > NORMAL/NO ACTION

- The normal/no-action state MUST remain clear but calm — it MUST NOT compete
  visually with higher-severity states.
- Severity MUST NOT be conveyed by color alone. Combine text, icon, label,
  position, and color as appropriate to the surface.

## F. Semantic Containers

Every major visual container MUST map to a semantic role, e.g.: content,
control, status, decision, summary, exception, or supporting detail.

- Gratuitous nested large cards/frames are disallowed.
- Prefer a parent decision region with sibling semantic units over deep
  nesting, where applicable.

## G. Hierarchy Before Decoration

When diagnosing or fixing a visual problem, address in this order:

1. Information priority
2. Content order
3. Grouping
4. Alignment
5. Spacing
6. Typography
7. Contrast/color
8. Borders/shadows/decoration

A worker MUST NOT mask a structural hierarchy problem with color, borders, or
shadows instead of fixing structure.

## H. Divergent Exploration for Major Redesigns

A "major redesign" is a change to information architecture, navigation,
decision workflow, a large layout, or a core review interface.

- MUST produce 2-3 genuinely different candidates before implementation.
- Differences MUST be structural, not merely stylistic.
- Small, local fixes are exempt from this requirement.
- Remixing elements across candidates after selection is allowed.

## I. Cognitive Simplicity

Optimize for reduced cognitive work, ambiguity, and hunting/interaction cost —
not for the smallest possible element count. A worker MUST NOT hide useful
context merely to achieve visual minimalism.

## J. Familiar Interaction First

Prefer established interaction patterns — tables, selects, checkboxes, radios,
tabs, dialogs, drawers, status badges, forms, buttons — unless a custom
interaction has a concrete, statable usability advantage over the familiar
pattern.

## K. Adaptive Layout by Default

Design MUST account for, from the start: viewport size, content growth, browser
zoom, long labels, and dynamic sections. Validating against a single
screenshot width is insufficient.

## L. Design Intent Contract

Before a material redesign, the following fields MUST be established if not
already supplied by authoritative context (product spec, prior decision,
ticket, or explicit stakeholder input):

- Primary user
- Primary task
- Primary decision
- Most important information
- Exceptional/blocking information
- Supporting information
- Must-remain-unchanged elements
- Known business constraints

A worker MUST NOT re-ask for fields already established by authoritative
context in scope.

## M. Scope and Authority

A worker MAY:

- Identify hierarchy problems
- Propose alternative layouts/structures
- Simplify redundant presentation
- Adjust grouping, alignment, spacing
- Recommend component restructuring
- Flag accessibility or responsive issues

A worker MUST NOT silently change: business meaning, required data, workflow
semantics, authority/approval logic, product requirements, or an already
approved design direction. If a design improvement requires a semantic change,
the worker MUST propose an amendment rather than silently implementing it.

## N. Verification Gate Checklist

Before handoff, confirm each item explicitly (mark N/A where inapplicable):

- [ ] Intent preserved
- [ ] Rendered UI inspected
- [ ] No material preview/implementation mismatch
- [ ] Realistic content fixtures checked
- [ ] Relevant edge cases checked
- [ ] Severity hierarchy correct
- [ ] Meaning not conveyed by color alone
- [ ] Semantic containers correct
- [ ] No unnecessary nested frames
- [ ] Alignment/spacing coherent
- [ ] Primary action/decision easy to locate
- [ ] Relevant viewport/content variants checked
- [ ] No required business information lost

## O. Failure Modes

The following are named failure modes to actively guard against:

- Code-only PASS (claiming done without rendered evidence)
- Demo-data illusion (validated only against ideal content)
- Visual severity collapse (all states look equally prominent/calm)
- Card proliferation (excessive nested containers)
- Decoration-before-structure (fixing color/shadow instead of hierarchy)
- First-draft lock-in on a major redesign (skipping divergent exploration)
- Silent semantic drift (unauthorized change to meaning/workflow/authority)

Silent semantic drift is a BLOCK condition, not merely a rework item.

## P. v1 Non-Goals

This v1 contract explicitly does NOT attempt to define:

- A complete visual design system
- Brand identity
- Exact palette/spacing/typography/animation tokens
- A generic workflow engine
- Automated screenshot-diff infrastructure
- A full WCAG conformance framework
- A complete breakpoint specification

## Q. Frozen v1 Principles

- Rendered UI is evidence.
- Real content is design testing.
- Prominence follows business severity.
- Containers express semantic structure.
- Hierarchy before decoration.
- Major redesign explores before converging.
- Cognitive simplicity outranks visual minimalism.
- Familiar patterns first.
- Adaptivity is considered during design, not bolted on after.
- Workers propose; product authority decides externally.

## R. Accessibility

Accessibility MUST be acknowledged and integrated as a design concern
throughout the workflow (e.g., contrast, focus order, non-color-only signaling,
label clarity). This v1 does NOT expand into a full accessibility standard or
WCAG conformance framework (see P); a dedicated accessibility contract, if
needed, belongs in a future version or overlay.
