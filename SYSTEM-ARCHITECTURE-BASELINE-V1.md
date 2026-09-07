# System Architecture Baseline v1

**Status:** FROZEN v1  
**Date:** 2026-09-07  
**Canonical repository:** `ouzuiki/Worker-Neutral-Supervisor`  
**Baseline parent:** `e946e735707fd6959e811c5d70ba24912a7e1c4c`

This document freezes the current system architecture shared by the local worker fleet. It describes responsibility, authority, trust, execution, and information-flow boundaries. It does not create a new runtime.

## 1. System shape

```text
                         User / ChatGPT Supervisor
                                  │
                    ┌─────────────┴─────────────┐
                    │ Worker-neutral Supervisor │
                    │ policy / contracts        │
                    └─────────────┬─────────────┘
                                  │
          ┌───────────────────────┼───────────────────────┐
          │                       │                       │
  Context / Routing       Evidence-to-State       Artifact Production
      / Acceptance           Contract v0             Contract v0
          │                       │                       │
          └───────────────────────┼───────────────────────┘
                                  │
                 ┌────────────────┼────────────────┐
                 │                │                │
                LCB              LPB             LClB
           thin adapter     thin adapter     thin adapter
                 │                │                │
               Codex              Pi          Claude Code
                 │                │                │
                 └──── native execution/session/history ────┘

Adjacent external infrastructure:
Secure Tunnel / service lifecycle / TencentDB memory / secrets /
durable observability / deployment configuration
```

The central rule remains:

> Bridges adapt one native worker family. They are not generic agent runtimes, workflow engines, shared state stores, evidence engines, memory systems, or cross-worker orchestrators.

## 2. Canonical responsibility layers

### A. User / ChatGPT Supervisor

Owns semantic supervision:

- goals and explicit constraints;
- task decomposition;
- worker selection and fallback intent;
- steering and HITL decisions;
- acceptance and verification;
- semantic retry and stall judgment;
- commit/push authorization;
- cross-worker handoff intent;
- next action.

### B. Worker-neutral Supervisor policy / contracts

Owns shared semantics that must not drift across LCB, LPB, and LClB:

- worker eligibility, quota/budget and routing policy;
- context authority and minimum sufficient context;
- memory admission and durable-truth policy;
- completion/acceptance gates;
- worker-neutral artifact-production semantics;
- worker-neutral evidence-to-state semantics;
- cross-worker conformance contracts and reference audits.

This layer may contain pure policy functions, schemas, contracts, and deterministic wrappers. It must not become a fourth worker runtime.

### C. Bridge layer

LCB, LPB, and LClB own only worker-family-specific adaptation:

- transport and native protocol adaptation;
- bounded live state;
- event and terminal projection;
- current pending-request projection;
- exact mutation acknowledgement semantics;
- validation, sanitization, and bounding;
- narrow deterministic worker-specific safety shims where needed.

A Bridge may faithfully project source/state metadata. It does not decide whether a claim becomes durable truth.

### D. Native Worker

Codex, Pi, and Claude Code retain native ownership of:

- model execution and reasoning;
- native tools, shell, filesystem, and Git capability;
- native session/thread/history;
- native sandbox and permission semantics;
- provider/model-specific behavior;
- native retry/compaction where applicable.

### E. External infrastructure

External infrastructure owns reusable machine/service concerns:

- Secure Tunnel;
- systemd/service lifecycle and health;
- secrets and deployment configuration;
- TencentDB/shared memory service;
- durable observability/storage;
- updater/deployment infrastructure.

## 3. Authority ownership baseline

Authoritative state must have one declared owner or source of truth.

| State class | Authority owner / source of truth |
|---|---|
| Native execution/session/history | Native Worker |
| Current pending HITL | Current pending-request projection |
| Bridge transport/control state | Bridge bounded projection |
| Current task constraints | User / Supervisor task contract |
| Shared project instructions | Project-owned contract such as `AGENTS.md` |
| Cross-worker policy | Worker-Neutral-Supervisor canonical contracts |
| Durable verified memory | Authorized durable memory path after verification/acceptance |
| Repository state | Repository/files/Git, not worker recollection |
| Artifact final state | Existing domain/artifact promotion gate |

Derived reports, event history, advisory memory, worker self-report, and generated summaries do not override the authoritative owner by inference.

## 4. Context and information authority

The context authority ordering remains:

```text
security hard runtime
  > current task and project contract
  > verified current evidence
  > skill/procedure
  > advisory memory
  > historical raw context
```

Native context loaders remain authoritative. Bridges do not build a universal prompt stack. Skills are loaded through native worker mechanisms, and memory is advisory unless separately promoted into verified durable truth.

## 5. Execution reliability path

Execution reliability is governed by the worker-neutral artifact/acceptance model:

```text
Task
  ↓
Minimum Context / Execution Plan
  ↓
Native Worker execution
  ↓
Candidate artifact / result
  ↓
Independent verification dimensions
  ↓
Promotion / acceptance gate
  ↓
Last-good final artifact / closeout
```

Important invariants:

- accepted/start acknowledgement is not task completion;
- successful generation does not imply browser/perceptual/human acceptance;
- independent claim dimensions require independent evidence;
- failed promotion preserves last-known-good output where the domain contract requires it;
- Supervisor owns final semantic acceptance.

## 6. Information reliability path

Information reliability is governed by `worker-neutral/evidence-to-state/evidence-to-state-contract.v0.json`:

```text
Source
  ↓
Evidence
  ↓
Derived Judgment
  ↓
Candidate State
  ↓
Verification / Promotion Gate
  ↓
Authoritative State
  ↓
Correction / Supersession when needed
```

Core invariant:

```text
Evidence
!= Derived Judgment
!= Candidate State
!= Authoritative State
```

A verified observation may still be stale. Missing observations are not evidence of absence when coverage is partial, stale, failed, or unknown. Worker/model interpretation cannot silently become durable truth.

## 7. Cost boundary

The architecture explicitly rejects making information trust a mandatory heavy runtime path.

### Ordinary fast path

Ordinary one-shot analysis, temporary tool observations, non-persisted reasoning, and normal answers do not require a structured Evidence-to-State record.

Always-on rules are semantic and lightweight:

- Source Identity;
- Coverage;
- Typed Uncertainty;
- Authority Ownership.

### Promotion-time path

Full evidence-to-state semantics activate only when information crosses into durable or authoritative state, including durable memory, architecture decisions, business rules, verified root causes, truth-bearing cross-worker handoffs, or automatic updates to an authoritative store.

No baseline requirement adds:

- a new worker call;
- a new Bridge round trip;
- a new datastore;
- mandatory raw-evidence persistence;
- a generic evidence state-machine runtime.

## 8. Cross-worker handoff rule

Cross-worker handoff is a Supervisor concern. A handoff may carry:

- task intent and explicit constraints;
- verified current evidence;
- bounded relevant advisory context;
- accepted artifacts or machine-readable receipts;
- candidate claims clearly marked as candidates.

A handoff must not silently promote worker self-report, advisory memory, or unverified conclusions into authoritative truth.

## 9. Memory rule

Durable memory is not a transcript dump and not a worker-owned truth channel.

Durable categories remain allowlisted and require existing verification/acceptance semantics. Raw logs, transcripts, raw command output, credentials, temporary task state, worker self-report, and unverified hypotheses remain excluded from durable truth by default.

Corrections and supersession must eventually prevent obsolete durable claims from being returned as current authority. W4 freezes this semantic; v1 baseline does not mandate a new persistence implementation.

## 10. Artifact and evidence symmetry

The architecture intentionally treats artifact reliability and information reliability as two complementary axes:

```text
Information reliability: Source → Evidence → State
Execution reliability:   Task   → Artifact → Delivery
```

They share recurring architectural motifs:

- minimum sufficient input;
- candidate vs final state;
- independent verification;
- explicit promotion;
- authority ownership;
- provenance/receipts;
- bounded failure semantics.

They must reuse existing domain gates rather than create parallel promotion engines.

## 11. Explicit non-goals

Do not introduce, without a separately proven need:

- a fourth generic Supervisor runtime;
- Bridge-to-Bridge calls;
- a universal worker session database;
- a centralized Skill-content loader;
- a Bridge-owned memory/evidence engine;
- a generic workflow/DAG engine;
- a universal evidence registry;
- automatic promotion of worker self-report;
- mandatory full provenance for ephemeral answers;
- duplicated sandbox/HITL/approval engines when native semantics already exist.

## 12. Canonical contracts included by reference

This baseline is composed from, and does not replace, the following canonical contracts:

- `TRI-BRIDGE-CONTRACT-V1.md`
- `supervisor-policy/context-policy.mjs`
- `supervisor-policy/memory-policy.mjs`
- `supervisor-policy/completion-gate.mjs`
- `worker-neutral/archify/artifact-production-contract.v0.json`
- `worker-neutral/evidence-to-state/evidence-to-state-contract.v0.json`
- relevant `reference-crosswalk/` closeout records

When a lower-level contract provides more specific semantics for its owned domain, that contract remains authoritative unless this baseline is explicitly revised.

## 13. Change policy

`System Architecture Baseline v1` changes only when a shared architectural boundary changes materially, for example:

- moving responsibility between Supervisor, Bridge, Native Worker, or external infrastructure;
- replacing native session/context ownership with shared runtime ownership;
- changing how authoritative truth is promoted or owned;
- introducing a required common runtime/datastore across all workers;
- changing the meaning of execution or information promotion gates.

Normal worker upgrades, model additions, new native events/tools, or domain-specific adapters do not reopen the baseline by themselves.

Any future enforcement of Evidence-to-State must be admitted one high-value promotion boundary at a time and must measure execution cost independently.

# Baseline v1: FROZEN
