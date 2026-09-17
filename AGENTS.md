# AGENTS.md — Worker-Neutral-Supervisor

Rules for any agent (human or model) working in this repository.

## 1. What lives here

This repo owns worker-neutral Supervisor policy and cross-worker contracts
only: worker selection/fallback, quota/budget routing, health judgment,
acceptance, cross-worker handoff, and the shared archify-safe tooling. It is
not a fourth bridge runtime and must not grow one.

## 2. What does not live here

Bridge-local adapter code (transport, worker-specific client libraries,
platform/deployment code) stays in each bridge repo
(`Local-Codex-Bridge`, `Local-Claude-Bridge`, `Local-Pi-Bridge`). Do not pull
those in here, and do not add runtime imports from this repo into any bridge
repo or vice versa — the relationship is documentation/contract reference
only.

## 3. Architectural replacement default

`ARCHITECTURAL-REPLACEMENT-DEFAULT-POLICY-v1.md` is normative for major
Worker/Bridge/Host/Supervisor architecture changes.

When a component's core role changes, replacement is the default rather than
renovation. In particular, if two or more of role, authority model, lifecycle,
or primary data/control flow change materially; if more than roughly half the
existing capability becomes legacy; or if proving old capability is inert costs
as much as building the minimal target, agents MUST propose freeze + minimal
replacement + cutover + archive before proposing further renovation.

Sunk cost is excluded from forward architecture choice. Existing safety controls
must remain intact until the legacy authority/path is actually removed. Choosing
renovation despite a replacement-default trigger requires an explicit human
exception rationale before implementation begins.

## 4. No commit / push without explicit user request

Do not `git commit`, `git push`, create branches/tags, or open GitHub
resources unless the user explicitly asks.
