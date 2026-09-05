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

## 3. No commit / push without explicit user request

Do not `git commit`, `git push`, create branches/tags, or open GitHub
resources unless the user explicitly asks.
