# WeChat Intelligence Hub Reference Audit / Pattern Mining Closeout

**Status:** CLOSED  
**Date:** 2026-09-07  
**Reference:** `Rion-Wu-tech/wechat-intelligence-hub`  
**Scope:** architecture/pattern mining only; no adoption of WeChat data-access implementation.

## Purpose

The audit examined the reference project for reusable architecture patterns relevant to the worker-neutral local execution system. The goal was not to integrate WeChat-specific code or Codex-specific Skill wiring, but to identify general information-trust patterns that complement the existing artifact/execution quality layer.

## W0 — Architecture Decomposition

Reference architecture was reduced to four deliberate layers:

```text
Reader
  ↓
Index / Evidence
  ↓
Intelligence / State
  ↓
Interface / Delivery
```

Key boundary: the reader is replaceable and read-only; failed live reading creates a coverage gap rather than proving absence of data.

## W1 — Extracted patterns

Nine patterns were retained for evaluation:

1. Source Freshness Gate
2. Narrowest Sufficient Retrieval
3. Evidence != Judgment != State
4. Human / evidence-backed Promotion Gate
5. Persistent Correction
6. Machine IR -> Semantic Pass
7. Evidence Navigation
8. Coverage Honesty
9. Utility-oriented quality metrics rather than output volume

## W2 — Mapping into the current system

The audit found that the reference project primarily contributes to **information reliability**, whereas the existing Archify-derived contract primarily governs **execution/artifact reliability**.

```text
Information reliability: Source -> Evidence -> State
Execution reliability:   Task   -> Artifact -> Delivery
```

The patterns therefore belong in the worker-neutral Supervisor/reference architecture, not inside LCB, LPB, or LClB.

## W3 — Gap Analysis

The proposed Evidence-to-State primitives were compared against the current system.

Summary at audit time:

```text
Already present:      Promotion Gate, Authority Ownership
Partially present:    Source Identity, Coverage, Minimum Sufficient Evidence,
                      Evidence Reference, Typed Uncertainty, Candidate State,
                      Provenance Navigation
Implicit:             Derived Judgment
Missing as generic:   Freshness, Correction / Supersession
```

The important finding was that the system already contained much of the required behavior in `memory-policy`, `context-policy`, `completion-gate`, Tri-Bridge ownership semantics, and the Archify artifact contract. A new runtime was therefore unnecessary.

## W4 — Minimal contract result

W4 produced and froze:

`worker-neutral/evidence-to-state/evidence-to-state-contract.v0.json`

with twelve primitives:

1. Source Identity
2. Freshness
3. Coverage
4. Minimum Sufficient Evidence
5. Evidence Reference
6. Derived Judgment
7. Typed Uncertainty
8. Candidate State
9. Promotion Gate
10. Authority Ownership
11. Correction / Supersession
12. Provenance Navigation

The contract intentionally preserves an ordinary-task fast path and requires no new worker call, Bridge round trip, datastore, raw-evidence persistence, or generic state-machine runtime.

## W5 — Architecture integration

The resulting information-trust semantics are integrated into `SYSTEM-ARCHITECTURE-BASELINE-V1.md` as a peer to the existing artifact/execution quality path.

The final architecture is not:

```text
Supervisor -> new evidence runtime -> Bridges
```

It is:

```text
Worker-neutral Supervisor
  ├─ context / routing / acceptance
  ├─ Evidence-to-State semantics
  └─ Artifact Production semantics
             ↓
        thin Bridges
             ↓
        native Workers
```

## Adopt / Reuse / Reject decisions

### ADOPT AS GENERAL SEMANTICS

- freshness and coverage honesty;
- evidence / judgment / candidate / authoritative-state separation;
- minimum sufficient evidence;
- typed uncertainty;
- promotion before durable truth;
- correction/supersession;
- provenance navigation.

### REUSE EXISTING SYSTEM MECHANISMS

- Supervisor authority and acceptance;
- memory candidate-to-durable-truth policy;
- context minimum-sufficient principle;
- Archify candidate/promotion and independent-claim semantics;
- Tri-Bridge ownership boundary;
- existing domain-specific promotion gates.

### DO NOT ADOPT

- WeChat-specific reader/access implementation;
- WeChat key/access acquisition paths;
- Codex-specific Skill installation/wiring;
- domain-specific opportunity pipeline semantics as generic Supervisor state;
- a new evidence datastore/runtime;
- direct source-code absorption from the reference project.

## Licensing boundary

The reference repository is treated as a pattern/reference source. No code-copy dependency or runtime integration is created by this audit. Independent architecture reimplementation remains the preferred path.

## Final outcome

The highest-value result of the audit is not a WeChat capability. It is the formalization of a missing architecture axis:

```text
Evidence
!= Derived Judgment
!= Candidate State
!= Authoritative State
```

This closes the audit without adding runtime complexity.

# W0-W5: CLOSED
