# Worker-Neutral-Supervisor

Canonical home for the worker-neutral Supervisor contracts, policy engine, and
cross-worker tooling shared across the local bridge fleet
([Local-Codex-Bridge](https://github.com/ouzuiki/Local-Codex-Bridge),
[Local-Claude-Bridge](https://github.com/ouzuiki/Local-Claude-Bridge),
[Local-Pi-Bridge](https://github.com/ouzuiki/Local-Pi-Bridge)).

## Frozen boundary

Each bridge is a thin, worker-specific adapter. It owns its own transport,
runtime, and worker-local client code. It does **not** own worker
selection/fallback, quota/budget routing, health judgment, acceptance, or
cross-worker handoff — that policy is worker-neutral and lives here, once,
so the three bridges stay comparable instead of drifting into three
divergent reimplementations.

Bridges depend on this repo only as documentation/contract reference, never
as a runtime import. A developer may check this repo out as a sibling
directory (`../Worker-Neutral-Supervisor`) purely as a local convenience;
that path is never a hard runtime dependency of any bridge.

## Contents

- `supervisor-policy/` — the worker-selection, quota, telemetry, memory-policy,
  registry-admission, and completion-gate policy engine, plus its tests.
- `worker-neutral/archify/` — the worker-neutral artifact-production
  ("archify") contract and admission profile.
- `scripts/archify-safe.mjs` + `test/archify-safe.test.mjs` — the standalone,
  worker-neutral archify-safe wrapper and its deterministic test suite.
- `reference-crosswalk/` — cross-worker reference audits and closeout records.
- `TRI-BRIDGE-*.md`, `TRI-WORKER-CONTEXT-SMOKE.md` — the tri-bridge contract
  history and the cross-worker context smoke-test definition.

## Testing

```
npm test
```

Runs the `supervisor-policy` suite and the `archify-safe` suite via plain
`node --test`. No production dependencies; no build step.
