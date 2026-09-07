# Evidence-to-State Contract v0

**Status:** FROZEN v0 (W4)  
**Canonical machine-readable contract:** `evidence-to-state-contract.v0.json`

This contract defines how observed information may become durable or authoritative state across worker-neutral Supervisor workflows.

It is intentionally **not** a new runtime, datastore, orchestration layer, or Bridge feature.

## Core invariant

```text
Evidence
  !=
Derived Judgment
  !=
Candidate State
  !=
Authoritative State
```

A worker can observe evidence and produce a judgment. That judgment can become a candidate. Promotion into durable or authoritative truth requires an existing domain gate and an authority owner.

## Cost boundary

The contract has a deliberate fast path.

Ordinary ephemeral tasks do **not** need a structured evidence-to-state record. This includes one-shot analysis, temporary tool observations, non-persisted worker reasoning, and ordinary answers that are not being promoted into durable system truth.

The full promotion semantics activate only when information is being made durable or authoritative, such as:

- durable memory;
- architecture decisions;
- business rules;
- verified root causes;
- truth-bearing cross-worker handoffs;
- automatic updates to an authoritative state store.

The v0 contract therefore requires:

- no new worker call;
- no new Bridge round trip;
- no new datastore;
- no mandatory raw-evidence persistence;
- no new generic state machine runtime.

## Twelve primitives

1. **Source Identity** — know where evidence came from.
2. **Freshness** — verified evidence may still be stale.
3. **Coverage** — missing observations are not automatically evidence of absence.
4. **Minimum Sufficient Evidence** — retrieve only what is needed, broaden only when necessary.
5. **Evidence Reference** — preserve a reference/hash/locator when practical instead of copying raw private contents.
6. **Derived Judgment** — model interpretation remains distinct from evidence.
7. **Typed Uncertainty** — use semantic uncertainty states, not invented numeric precision.
8. **Candidate State** — machine/worker proposals do not silently become truth.
9. **Promotion Gate** — reuse existing verification/acceptance gates; do not build a parallel promotion engine.
10. **Authority Ownership** — every authoritative state class has a declared source of truth.
11. **Correction / Supersession** — wrong or obsolete durable claims are explicitly invalidated or superseded.
12. **Provenance Navigation** — promoted state should be traceable back to supporting evidence and its promotion/correction decision.

## Always-on vs promotion-time

The contract distinguishes semantic rules from expensive enforcement.

### Always-on semantic rules

These constrain claims but do not require persistence for normal tasks:

- Source Identity
- Coverage
- Typed Uncertainty
- Authority Ownership

### Promotion-time rules

These become mandatory when a claim crosses into durable or authoritative state, or when current truth materially depends on freshness/coverage:

- Freshness
- Minimum Sufficient Evidence
- Evidence Reference
- Derived Judgment
- Candidate State
- Promotion Gate
- Correction / Supersession
- Provenance Navigation

## Reuse, do not duplicate

The contract is a unifying abstraction over mechanisms that already exist in the system:

- `supervisor-policy/context-policy.mjs` already defines `minimum_sufficient_context` and context authority.
- `supervisor-policy/memory-policy.mjs` already distinguishes candidate episodes from verified durable truth and restricts durable recording authority.
- `supervisor-policy/completion-gate.mjs` already requires verified acceptance before task closeout.
- `worker-neutral/archify/artifact-production-contract.v0.json` already separates candidate output, independent claim dimensions, and atomic promotion.
- `TRI-BRIDGE-CONTRACT-V1.md` already freezes native/Bridge/Supervisor ownership boundaries.

W4 does not change any of those contracts. It names the common information-trust semantics across them.

## What v0 does not do

W4 does not:

- modify LCB, LPB, or LClB;
- add a shared database;
- create a universal evidence registry;
- force every worker run through a promotion state machine;
- store raw logs or transcripts as durable truth;
- assign fake confidence percentages;
- make advisory memory authoritative;
- change native execution/session ownership.

## Future enforcement rule

Any future enforcement must be added only at a demonstrated high-value promotion boundary, one boundary at a time, with its execution cost measured independently.

A new enforcement mechanism should be rejected if it merely duplicates an existing Supervisor, memory, artifact, or domain gate.
