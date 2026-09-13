# Worker-Neutral Convergence (SK-1)

Normative home of the worker-neutral semantic-convergence contract: judging
current-state convergence between authoritative intent and observed reality
from current state and evidence — not from Git diff or history.

## Contents

- `contract.v0.json` — frozen v0 contract: finding schema with closed enums,
  the append-only monotonic rule, the residual-to-work-item rule,
  evaluator/executor separation, and convergence-certificate proof
  requirements.
- `../../supervisor-policy/convergence.mjs` — pure, deterministic structural
  helper implementing the contract (finding normalization, finding →
  candidate residual work-item conversion, certificate evaluation). No I/O,
  no clocks, no input mutation.
- `../../supervisor-policy/convergence.test.mjs` — deterministic test suite
  (run via `npm test`).

## Semantics

- A finding carries `finding_id`, `source_ref`, `gap_type`
  (`missing` / `partial` / `contradicts` / `unrequested`), `severity`
  (`critical` / `high` / `medium` / `low`), `evidence`, `remediation`,
  `verifier`, and `status` (`open` / `resolved` / `superseded`).
- Only an open finding can be converted into a candidate residual work item.
  Conversion carries `finding_id`, `source_ref`, `remediation`, and
  `evidence_refs`, leaves the finding open, and never authorizes execution
  or promotion.
- A `convergence_certificate` is a derived verification judgment only. It
  does not close a task: final close authority remains
  `supervisor-policy/completion-gate.mjs`, and final PASS still requires the
  existing `acceptance=verified` semantics plus all other completion-gate
  requirements.
- Final verifier role may only be `supervisor` or `independent_verifier`;
  when `executor_id` is supplied, the final `verifier.id` must differ from
  that executor identity regardless of verifier role — no self-certification.
- Set-like identity/reference arrays (`finding_refs`, `open_finding_ids`,
  `verification_scope.source_refs`, and supplied `finding_id` values) reject
  duplicates instead of deduplicating, so duplicates cannot fake exact set
  coverage.
- Evidence refs reuse Evidence-to-State semantics
  (`../evidence-to-state/evidence-to-state-contract.v0.json`); no second
  provenance or promotion system is introduced.

## Boundaries

This is a semantic contract plus a pure helper — not a workflow engine,
datastore, or runtime. It adds no Host or Bridge responsibility, no
automatic repair, no automatic promotion, and no SK-2 durable cursor.
