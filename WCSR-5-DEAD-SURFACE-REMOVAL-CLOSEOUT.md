# WCSR-5 Dead Surface Removal Closeout

Status: **CLOSED / PASS**  
Date: 2026-09-16

## Removed

- WNS's obsolete duplicate executable Host runtime, stdio Bridge transport,
  worker-specific observer, daemon/status commands, and old live-gate scripts.
  The authoritative implementations remain in Worker-Neutral-Supervisor-Host.
- The liveness chain that translated continuous progress sampling into routine
  soft-steer/interrupt/retry recommendations: binding, state/verdict/recovery,
  review-trigger, tri-worker liveness gate, and their current contract/tests.
- Liveness-specific stall/recovery fields from generic Worker Economics
  telemetry. The generic privacy-safe telemetry normalizer and aggregation are
  preserved with worker/task/routing/result/duration/token/cost/quota/fallback/
  escalation/evidence/decomposition coverage.
- LCB's `codex_checkpoint` public tool, Bridge-owned persistence implementation,
  platform path policy, tests, and docs. It had no production caller and
  duplicated durable Supervisor/Host cognition ownership.

## Preserved

- Native steer and interrupt tools in all three Bridges as exceptional explicit
  controls.
- Pending permission/request response tools and fail-closed request identity.
- Host authority, durable checkpoint, exact-effect reconciliation, restart,
  incarnation fencing, and recovery mechanics.
- Passive `reasoning-watchdog.mjs` semantic-progress normalization/diagnostics,
  which Host's pinned policy projection still consumes; the automatic control
  binding that could act on it is gone.
- Generic economics telemetry and its allowlist/privacy aggregation tests.
- WNS runtime contracts and immutable historical qualification evidence.
- LPB repository safety and the pre-existing commits `2fab7fc` and `43c4378`.

## Acceptance evidence

- WNS policy suite passes with the simplified workflow binding and preserved
  telemetry.
- WNS Archify safety suite passes through its child-process-capable test lane.
- LCB full deterministic suite passes with exactly ten public tools and no
  checkpoint persistence path.
- LClB and LPB full deterministic suites passed at WCSR-4 after the shared
  normal-path contract change; WCSR-5 did not change either repository.
- Host runtime was not changed or deleted; its full suite remains the final
  ownership/recovery regression gate.
