# EP-1C Acceptance Evidence — Formal Closeout (PASS)

## Scope

This closeout covers **EP-1C only**: the acceptance-evidence control-plane module
(`supervisor-policy/acceptance-evidence.mjs`,
`supervisor-policy/acceptance-evidence.test.mjs`) and its wiring into
`test:supervisor-policy` in `package.json`. No Host, persistence, or
workflow-engine files were touched. Pi production cutover, live qualification,
Host<->Pi integration, and SHD-4 are explicitly **out of scope** for this run
and remain to be executed in later, separate steps.

## Base and implementation commit

- Base branch: `ep1-versioned-plan`
- Base HEAD at run start: `abd99b6eca81ce7775a5e94f281ba568f0edaca8`
  (`docs: close EP-1 execution plan gate`)
- Preflight confirmed exactly 3 dirty paths, no staged changes:
  - `M package.json`
  - `?? supervisor-policy/acceptance-evidence.mjs`
  - `?? supervisor-policy/acceptance-evidence.test.mjs`
- Implementation commit (this run): `2327c4e9db9931c7ae4ab4ead9f0688280d9bdb7`
  — `feat: add acceptance evidence closure`
  - Adds `supervisor-policy/acceptance-evidence.mjs` and
    `supervisor-policy/acceptance-evidence.test.mjs`
  - Modifies `package.json` only to append
    `supervisor-policy/acceptance-evidence.test.mjs` to the
    `test:supervisor-policy` script's file list

## Frozen semantics (implemented, not redesigned)

The implementation and tests were reviewed against the following frozen
invariants and found to implement them exactly, with no deviation:

- `CurrentAcceptanceIdentity` is the authoritative external freshness anchor
  and carries all four fields — `plan_id`, `plan_revision`, `gate_id`,
  `acceptance_spec_revision` — with `acceptance_spec_revision` enforced as a
  distinct freshness dimension from `plan_revision`.
- The worker evidence path (`evaluateWorkerEvidenceSubmission`) always
  returns `accepted: false`; a worker's `READY` / `READY_FOR_REVIEW` claim is
  never sufficient to close a gate.
- The evaluator returns an explicit `status` of `EVIDENCE_COMPLETE` or
  `EVIDENCE_INCOMPLETE`, separate from a precise `reason_code`
  (`IDENTITY_VALID`-family mismatch codes, `UNKNOWN_CRITERION`, or
  `EVIDENCE_INCOMPLETE`/`EVIDENCE_COMPLETE`). `EVIDENCE_COMPLETE` status is
  reachable only on the full-coverage path.
- A stale but internally self-consistent spec/submission pair (matching each
  other but not the current identity) is fenced by the external
  `CurrentAcceptanceIdentity`, not by internal consistency alone.
- `applySupervisorAcceptanceDecision` follows fixed precedence:
  - **P0** — structural validation of all four inputs (spec, submission,
    decision, current identity), including the submission on the reject
    path, fails closed with `TypeError` on malformed input.
  - **P1** — spec vs. current identity mismatch → `DECISION_BLOCKED_STALE_CONTEXT`.
  - **P2** — submission vs. spec mismatch → `DECISION_BLOCKED_IDENTITY_MISMATCH`.
  - **P3** — decision vs. spec mismatch → `DECISION_BLOCKED_IDENTITY_MISMATCH`.
  - **P4** — a correctly bound `reject` is always `REJECTED`, `accepted: false`,
    with no evidence-completeness requirement (zero, partial, or
    unknown-criterion evidence all still yield a valid `REJECTED`).
  - **P5** — a correctly bound `accept` yields `accepted: true` only when
    evidence is complete against the current identity; otherwise
    `ACCEPT_BLOCKED_INCOMPLETE_EVIDENCE` propagates the evaluator's precise
    `reason_code`.
- `accepted: true` is reachable through exactly one code path: P5 with
  complete current evidence.

No design changes were made to any of the above; the implementation found in
the working tree at preflight already matched this specification.

## Validation chain (normal WSL environment, `/bin/sh` present)

All commands were run in this WSL worktree, which has a real `/bin/sh`
(`/bin/sh -> dash`), superseding the prior Pi-sandbox-only failure (see
"Prior environment-only failure" below).

| Check | Result |
|---|---|
| `node --test supervisor-policy/acceptance-evidence.test.mjs` | **80/80 pass** |
| EP-1 focused suite (`authoritative-plan.test.mjs`, `plan-admission.test.mjs`, `plan-amendment.test.mjs`) | **100/100 pass** |
| `npm run test:supervisor-policy` | **464/464 pass** |
| `npm test` (full: supervisor-policy + supervisor-runtime + archify-safe) | **PASS, exit 0** — 464 + 40 + 13 tests, 0 failures |
| `npm run test:archify-safe` (explicit, in addition to full run) | **13/13 pass** |
| `git diff --check` | clean, exit 0 |

This is a true full `npm test` PASS with no waiver, run in the normal WSL
environment (not the Pi sandbox).

## Independent code review

An independent read-only review of exactly the three changed files
(`package.json`, `supervisor-policy/acceptance-evidence.mjs`,
`supervisor-policy/acceptance-evidence.test.mjs`) was performed against the
frozen invariants above. No blockers were found. No edits were made to the
implementation as part of this closeout — the code was already correct and
already reviewed READY in a prior audit; this run independently re-confirmed
that verdict with a fresh reading plus a full green test run.

## No Host / persistence / workflow-engine changes

The only file outside `supervisor-policy/` touched by the implementation
commit is `package.json`, and only to add the new test file to an existing
npm script's argument list. No Host code, no persistence layer, and no
workflow-engine code was created or modified in this closeout.

## Old candidate worktrees

This closeout was executed directly in the authoritative
`Worker-Neutral-Supervisor-EP1` worktree on `ep1-versioned-plan`. No other
candidate worktree or branch was used or merged from as part of this
closeout.

## Prior environment-only failure (classified, not a functional gap)

A previously observed full-`npm test` failure was caused solely by a Pi
sandbox environment missing `/bin/sh`, an environment defect unrelated to the
acceptance-evidence implementation. This run's WSL environment has
`/bin/sh` (`dash`) present, and the full `npm test` suite passed cleanly
end-to-end, superseding that environment-only failure with a true full PASS.

## Pi read-scope residual (explicitly out of scope)

Any Pi read-scope residual from prior investigation is **not** part of the
EP-1C acceptance criteria and is tracked separately from this closeout. It is
not a blocker for EP-1C and is not addressed by this commit.

## Explicitly not absorbed into this closeout

Per instruction, the following future-hardening items were identified but
intentionally **not** added to the implementation or its acceptance scope in
this closeout, to avoid scope creep beyond the frozen EP-1C spec:

- A `proposal_id` field or equivalent proposal-tracking identity.
- Rejected-amendment history tracking/retention.

These remain candidates for a future, separately-scoped enhancement and are
not required for EP-1C to be considered closed.

## Final state

- Branch: `ep1-versioned-plan`
- Implementation HEAD: `2327c4e9db9931c7ae4ab4ead9f0688280d9bdb7`
- Working tree: clean at the time of this document's creation (verified
  immediately before writing this file)

## Verdict

**EP-1C: PASS / CLOSED.**

Next steps per the corrected authoritative sequence (not part of this run):
Pi production cutover (`bd44371`), live qualification, Host<->Pi integration,
then SHD-4.
