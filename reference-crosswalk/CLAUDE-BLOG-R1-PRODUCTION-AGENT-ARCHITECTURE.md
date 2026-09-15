# CLAUDE-BLOG-R1 — Production Agent Architecture Reference Audit Delta

**Status:** BACKLOG INTEGRATED / NO IMPLEMENTATION AUTHORIZED  
**Audit date:** 2026-09-15  
**Normative owner:** Worker-Neutral-Supervisor (WNS)  
**Host impact:** reference-only; no Host runtime or Host-owned contract changes in this audit  
**Scope:** five retained contract/backlog deltas from the CLAUDE-BLOG-R1 production-agent architecture audit

## Purpose

This record captures five reference-derived architecture deltas without opening a new implementation program. It is a documentation/reference-audit update only.

The existing ownership split remains authoritative:

```text
Supervisor / WNS
  semantic policy, authority meaning, acceptance, plan semantics

Supervisor Host
  mechanical persistence, fencing, dispatch, lifecycle/event mechanics

Bridges
  worker/provider-specific transport and adaptation

Native Workers
  model execution, native tools/session behavior, provider/model-specific behavior
```

Nothing in this audit transfers semantic policy into the Host, turns a Bridge into a workflow engine, or creates a fourth runtime.

## Backlog state vocabulary

- **P0 contract backlog** — architecture/contract clarification worth preserving now. It is **not** implementation authorization.
- **P1 freeze-only** — retained future design constraint. It is deliberately not scheduled for implementation.
- A reference being stronger than the current implementation is not, by itself, a `CONFIRMED_GAP`.
- This audit opens **no `CLAUDE-BLOG-R2` implementation line**.

## Reuse-first rule

These deltas MUST reuse existing WNS/Host primitives before any future implementation is considered. In particular they MUST NOT duplicate or fork semantics already owned by:

- OR-1 durable attempt / authority epoch / outcome-uncertainty work;
- AP-1 durable authority provenance and WNS-owned authority evaluation;
- EP-1 versioned execution plan and Worker Amendment Proposal;
- SK-1 semantic convergence / residual-work findings;
- Evidence-to-State promotion semantics;
- ASR/LSH/SHD recovery, reconciliation, receipt, and lifecycle mechanics;
- the frozen WNS ↔ Host ownership split.

---

## CBR1-OBS — Shared Runtime Evidence

**Priority/state:** P0 contract backlog  
**Primary reference-audit classification:** `REFERENCE_STRONGER` (clarification, not a confirmed gap)

### Retained rule

> Runtime evidence MUST be machine-consumable, not merely human-readable. Human views and agent reasoning SHOULD derive from the same authoritative event/evidence source.

### Existing primitives to reuse

- `worker-neutral/evidence-to-state/` already separates Evidence, Derived Judgment, Candidate State, and Authoritative State.
- Supervisor runtime/Host lifecycle already records bounded observations, transitions, acknowledgements, receipts, and reconciliation facts.
- Existing durable-observability infrastructure remains an external/mechanical concern; this delta does not create another telemetry store.

### Ownership

```text
Host/runtime event source
        ↓
structured authoritative evidence
   ├── human-facing observation plane
   └── agent/Supervisor reasoning consumer
```

The Human Observation Plane and any future agent-facing observer should consume the same authoritative evidence stream rather than maintaining two conflicting truth channels.

### Explicit non-goals

- no new event bus;
- no new telemetry datastore;
- no requirement that every ordinary tool event become durable authoritative state;
- no Host semantic interpretation of telemetry;
- no duplicate HOP implementation.

### Future admission trigger

Only open implementation work when a concrete consumer cannot reliably derive required human/agent observations from the existing authoritative evidence/event source.

---

## CBR1-CON — Execution Conservation Invariant

**Priority/state:** P0 contract backlog  
**Primary reference-audit classification:** `REFERENCE_STRONGER` (system invariant clarification, not a confirmed gap)

### Retained rule

> No accepted execution may disappear without reaching a recognized lifecycle state.

A future contract expression should preserve an accounting identity equivalent to:

```text
accepted attempts
=
terminal attempts
+ live attempts
+ explicitly reconciled/unknown-outcome attempts
```

The exact state names MUST reuse the authoritative attempt/outcome vocabulary already frozen by OR-1 / Host lifecycle contracts, including `OUTCOME_UNKNOWN` (or its current canonical equivalent) where the effect/result cannot yet be proven.

### Existing primitives to reuse

- durable attempt identity and authority fencing;
- unknown-effect / reconciliation semantics in resume preflight and Host recovery;
- deterministic claim keys and receipts;
- Host transition lineage and acknowledgement records;
- SHD recovery/reconciliation mechanics.

### Required semantic distinction

Transport timeout, Bridge loss, or missing acknowledgement MUST NOT be silently collapsed into execution failure. An accepted mutating action whose outcome cannot be proven remains an explicit unknown/reconciliation case until evidence closes it.

### Explicit non-goals

- no second attempt registry;
- no separate workflow ledger;
- no retry policy change;
- no automatic replay of uncertain effects;
- no change to SHD-4 closure status.

### Future admission trigger

Open a concrete contract/runtime change only if accepted work can currently fall outside every recognized lifecycle/reconciliation state or if conservation cannot be mechanically checked from existing records.

---

## CBR1-LP — Learning Promotion Contract

**Priority/state:** P1 freeze-only  
**Primary reference-audit classification:** `REFERENCE_STRONGER` / deferred

### Retained rule

```text
observed behavior / runtime lesson
!= authoritative policy / skill
```

Any future learning loop MUST preserve an explicit promotion path:

```text
runtime evidence
  ↓
lesson candidate
  ↓
proposed skill/policy delta
  ↓
verification
  ↓
Supervisor/Human approval
  ↓
versioned promotion
```

### Existing primitives to reuse

- Evidence-to-State candidate-versus-authoritative separation;
- existing promotion/acceptance gates;
- native Agent Skills ownership and project Skill-content SSOT;
- SK-1 findings/residual-work semantics when a learned lesson is first represented as an unresolved finding rather than a policy mutation.

### Explicit non-goals

- no self-modifying Worker;
- no automatic AGENTS.md rewrite;
- no Host-owned learning engine;
- no autonomous Skill registry;
- no automatic policy promotion from model self-report or memory.

### Future admission trigger

Revisit only after repeated, verified runtime lessons show enough recurrence to justify a versioned improvement pipeline and the expected value exceeds the review/maintenance cost.

---

## CBR1-ID — Execution Principal Concept

**Priority/state:** P1 freeze-only  
**Primary reference-audit classification:** `MATCH` on authority separation, `REFERENCE_STRONGER` on explicit agent-principal identity

### Retained rule

Agent execution authority is conceptually distinct from a human user's identity. If a generic execution principal is introduced later, the responsibility split MUST remain:

```text
Supervisor / WNS
  permission and authority semantics
        ↓
Host
  mechanical persistence / fencing / enforcement
        ↓
Bridge
  provider-specific identity / credential mapping
        ↓
Native Worker / provider
```

### Existing primitives to reuse

AP-1 already freezes the important semantic foundation:

- authority is a durable structured record, not inferred from visible chat text;
- `authority_epoch` fences stale grants;
- WNS owns `authorized` vs `human_required` semantics;
- Host may persist, validate structurally, fence, and mechanically dispatch on the WNS-produced decision;
- scope is explicit and bounded.

A future `execution_principal` concept MUST extend/reference that authority model rather than creating a second permission system.

### Provider boundary

Provider identities, service-account identifiers, API credential formats, or vendor-specific principal semantics MUST NOT become Host-core policy fields merely because one Bridge needs them. Bridge/native-worker layers own that mapping.

### Explicit non-goals

- no new principal schema now;
- no credential broker now;
- no permanent broad service-account expansion;
- no Host semantic permission evaluator;
- no replacement of AP-1.

### Future admission trigger

Revisit when multiple workers/providers require independently auditable non-human execution identity or just-in-time credential grants that cannot be represented cleanly through the existing durable authority + Bridge mapping boundary.

---

## CBR1-PROVIDER — Provider Optimization Boundary

**Priority/state:** P0 architecture rule / contract backlog  
**Primary reference-audit classification:** `MATCH` plus explicit boundary hardening

### Retained rule

> Provider-specific prompt caching, context shaping, effort/model tuning, tool loading, API quirks, and equivalent optimization MUST remain below the Host abstraction boundary.

### Existing boundary to preserve

The canonical architecture already assigns provider/model-specific behavior to the Native Worker and worker-family-specific adaptation to Bridges. Therefore:

```text
Host
  receives/executes worker-neutral authorized intent
  does NOT optimize prompts/models/provider APIs

Bridge / Native Worker seam
  may implement provider-specific adaptation and optimization
  without changing Host semantic contracts
```

The exact split between Bridge and Native Worker remains worker-family-specific; the invariant is that these optimizations do not leak upward into Host-core policy.

### Examples that remain below Host

- prompt-cache breakpoints / TTLs;
- provider-specific context-prefix shaping;
- model-specific effort/reasoning settings;
- tool-definition ordering or deferred tool loading;
- vendor API retry/streaming quirks;
- provider-specific session/bootstrap optimization.

### Explicit non-goals

- no universal Host prompt optimizer;
- no Host model-selection heuristics based on provider API details;
- no cross-Bridge provider-quirk registry;
- no Host ownership of native tool-loading semantics.

### Future admission trigger

If an optimization must become worker-neutral policy, first prove that its semantics are truly provider-independent. Otherwise it stays in the relevant Bridge/native-worker layer.

---

## Consolidated backlog table

| ID | State | WNS/Host ownership | Reuse target | Implementation now? |
|---|---|---|---|---|
| CBR1-OBS | P0 contract backlog | WNS contract semantics; Host emits/retains mechanical evidence | Evidence-to-State + Host lifecycle/event evidence | **No** |
| CBR1-CON | P0 contract backlog | WNS invariant; Host mechanically accounts lifecycle facts | OR-1 + ASR/LSH/SHD reconciliation/receipts | **No** |
| CBR1-LP | P1 freeze-only | WNS promotion semantics | Evidence-to-State + Skill ownership + SK-1 findings | **No** |
| CBR1-ID | P1 freeze-only | WNS authority semantics; Host mechanical enforcement; Bridge identity mapping | AP-1 durable authority | **No** |
| CBR1-PROVIDER | P0 architecture rule/backlog | Host exclusion rule; Bridge/native-worker implementation ownership | frozen Bridge / Native Worker boundary | **No** |

## Audit conclusion

All five CLAUDE-BLOG-R1 findings are retained as **Reference Audit deltas** in the existing WNS contract/reference backlog. None is classified as a current `CONFIRMED_GAP`; none authorizes implementation.

The Host repository receives no duplicate policy document because WNS is the sole normative owner of worker-neutral policy/contracts. Any future Host effect must arrive through the established WNS → Host contract/projection boundary.

`CLAUDE-BLOG-R1` therefore closes as a **reuse-first architecture hardening reference**, not as a new development phase.
