# EP-1 Execution Plan Gate Closeout

**Gate ID:** EP-1 — Versioned Execution Plan + Worker Amendment Proposal
**Status:** PASS / CLOSED
**Date:** 2026-09-12
**Owner:** Supervisor / WNS

Host remains stateless/mechanical and does NOT own semantic gate acceptance. Acceptance of EP-1 is Supervisor/WNS-owned end to end.

---

## Scope boundary

EP-1 is a minimal versioned execution-plan control plane: plan identity/revision (`plan_id`, `plan_revision`), gate and dependency state, worker amendment proposals, supervisor review, and an immutable amendment history. It is **not** a workflow engine — there is no scheduling, no execution semantics beyond gate/dependency bookkeeping, and no orchestration logic.

EP-1C — Acceptance Evidence Closure is explicitly **OUT OF SCOPE** for this closeout and is the next gate. EP-1C requires that current gate acceptance criteria be explicitly represented, that concrete evidence be bound to those criteria, that evidence be checked against the current `plan_id`/`plan_revision` (including freshness / non-stale semantics), that a worker's READY claim alone cannot satisfy or close a gate, and that Supervisor/WNS owns the final acceptance decision after verifying all current criteria/evidence. None of that acceptance-evidence-binding machinery is implemented or claimed by EP-1.

---

## Implementation commits / evidence

```text
d3bcde12329645fb2388202de69ece785a1f2b39   feat: add versioned execution plan control plane
                                            (six EP-1 control-plane files checkpoint)
16b20e5a34136530c7b2d580cd433add0c148585   fix: fence gate authorization on completed dependencies
                                            (gate-state disjointness + completed-dependency
                                             authorization fencing)
fa8241e4792442b6f96e55b58987381bb3179081   test: wire EP-1 into supervisor policy suite
                                            (canonical test wiring)
```

---

## Acceptance criteria and evidence

All criteria below are enforced by `supervisor-policy/authoritative-plan.mjs`, `supervisor-policy/plan-admission.mjs`, and `supervisor-policy/plan-amendment.mjs`, and verified by deterministic regression tests.

- **plan_id / plan_revision** — every authoritative plan carries a `plan_id` and a positive-integer `plan_revision`; admission requires the caller's observed `plan_id`/`plan_revision` to match the current authoritative plan.
- **Gates / dependencies + authorized / completed / blocked** — each gate carries mutually exclusive state (`authorized`, `completed`, `blocked`); dependency edges are validated against declared gates.
- **Amendment proposal / review / history** — a worker submits a proposal; the supervisor reviews it (accept / modify / reject); an accepted or modified review is appended to an immutable `amendment_history`.
- **Worker cannot self-apply / self-authorize** — `applySupervisorPlanAmendment` is the only path that mutates plan state, and it requires a supervisor review record; there is no worker-callable path that authorizes a gate or applies an amendment directly.
- **Stale plan id/revision admission fencing** — plan admission rejects any observed `plan_id`/`plan_revision` that does not exactly match the current authoritative plan's `plan_id`/`plan_revision` (no forward- or back-compatible fuzzy matching).
- **Unmet dependency cannot be authorized** — a gate whose declared dependencies are not all in the `completed` state cannot transition to `authorized`; this fencing was the specific fix in `16b20e5`.
- **State lists mutually exclusive** — `authorized`, `completed`, and `blocked` gate sets are validated as pairwise disjoint; a gate cannot appear in more than one state list.
- **Progressive disclosure** — `createWorkerPlanContext` exposes an exact, deep-frozen 4-key worker-facing projection of the authoritative plan, withholding supervisor-only internals.
- **Immutable / copy-safe / no mutation** — all validators return deep-frozen structures; mutation attempts on returned objects fail silently or throw per standard `Object.freeze` semantics, and no validator mutates its input.
- **Host boundary** — no Host-owned file, script, or contract was touched by this work; Host continues to invoke plan operations mechanically without interpreting gate/dependency semantics.

---

## Test evidence

```text
focused EP-1 (authoritative-plan.test.mjs, plan-admission.test.mjs,
              plan-amendment.test.mjs)                              100/100 PASS

npm run test:supervisor-policy (canonical, includes the 3 EP-1
              files appended to the allowlist by fa8241e)           384/384 PASS

npm test (full suite)
    supervisor-policy                                               384/384 PASS
    supervisor-runtime                                                40/40 PASS
    archify-safe                                                      13/13 PASS
    total                                                            437/437 PASS

git diff --check                                                    clean
```

---

## Independent acceptance evidence

Production Pi/DeepSeek Flash independently audited HEAD `16b20e5a34136530c7b2d580cd433add0c148585` (before the test-wiring patch) and found 9/9 criteria PASS, with the focused EP-1 tests passing 100/100 at that HEAD. The only blocker that audit identified was that the three EP-1 test files existed but were not wired into the canonical `test:supervisor-policy` npm script. That blocker was subsequently fixed by `fa8241e4792442b6f96e55b58987381bb3179081`, and the full canonical/full-suite test evidence above was captured at that HEAD by this closeout, not by the independent audit. The independent audit did not itself re-run against `fa8241e`.

---

## Explicit non-blocking deferred items (not part of frozen EP-1 acceptance)

The independent audit identified two items that are deliberately **not** absorbed into this EP-1 acceptance, are **not** EP-1C scope, and require a separate future decision if desired:

1. The supervisor review object does not carry an in-band `proposal_id` binding back to the worker's amendment proposal.
2. Rejected amendments are not appended to `amendment_history` (only accepted/modified amendments are recorded).

These remain open, non-blocking future-hardening observations only.

---

## Quarantined prior work

`/home/ouzuiki/projects/Worker-Neutral-Supervisor-EP1C-TXN` (a prior, dirty EP-1C schema-rewrite attempt) remains quarantined and unmerged. Its schema rewrite is not part of, and was not used for, this EP-1 closeout.

---

## Final decision

```text
EP-1   PASS / CLOSED
```

### Ordering after closeout

```text
EP-1C — Acceptance Evidence Closure     NEXT
HOST_V2_PI_V2_INTEGRATION_PASS          NOT STARTED / NOT PASS until EP-1C closes
SHD4_LIVE_GATE                          downstream blocked
```

No Host, Pi, SHD-4, or EP1C semantics are changed by this closeout.
