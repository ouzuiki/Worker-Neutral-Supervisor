# WCSR-2 Usage & Dependency Audit

Status: **CLOSED / PASS**  
Date: 2026-09-16  
Scope: Local Codex Bridge (LCB), Local Pi Bridge (LPB), Local Claude Bridge
(LClB), Worker-Neutral-Supervisor (WNS), and Worker-Neutral-Supervisor-Host
(Host).

## Frozen premise

Workers run autonomously toward an authorized goal. The Supervisor retains
permission approval, semantic-drift correction, stage/final acceptance, and
exceptional steering or interruption. Continuous high-frequency progress
intervention is no longer a normal execution requirement.

Native worker controls remain worker capabilities. WCSR does not weaken native
permissions, authority fences, reconciliation, durable recovery, or repository
safety, and it does not turn a Bridge into a policy or workflow engine.

## Evidence method

The audit inspected public tool definitions, non-test references, Host adapter
and observation registries, daemon startup requirements, WNS live-gate scripts,
package test lanes, and repository ownership contracts at the repository HEADs
listed below.

| Repository | Audited HEAD | Worktree fact |
|---|---|---|
| WNS | `727a82f` | clean at audit start |
| Host | `25db17c` | clean at audit start |
| LCB | `2921540` | clean at audit start |
| LClB | `6f30e6e` | clean at audit start |
| LPB | `43c4378` | clean; `2fab7fc` and `43c4378` are pre-existing repository-policy fixes and are not WCSR changes |

Generated build output, fixtures, tests, frozen evidence JSON, and historical
live-gate references were distinguished from production callers.

## Current normal path

Host's production adapter registry requires only these worker execution and
observation surfaces:

| Worker | Start | Observe/result | Durable address |
|---|---|---|---|
| Codex | `codex_turn` | `codex_observe` | native `thread_id` |
| Claude | `claude_start` | `claude_observe`, `claude_result` | Bridge `run_id`, separate from native `session_id` |
| Pi | `pi_start` | `pi_observe`, `pi_result` | current Pi session identity/cursor projection |

`scripts/supervisor-host-daemon.mjs` checks those exact required tools before a
Bridge port is accepted. Host recovery uses the same adapter/observer path and
durable response reference. It does not call a steer or interrupt tool as part
of ordinary execution.

## Classification

### KEEP — normal execution or observation

- LCB: `codex_turn`, `codex_observe`, `codex_threads`, `codex_models`, and
  `codex_rate_limits`.
- LClB: `claude_start`, `claude_observe`, `claude_result`, and
  `claude_health`.
- LPB: `pi_start`, `pi_observe`, and `pi_result`.
- Host adapter registry, endpoint resolution, exact observation addressing,
  bounded polling, durable checkpoints, and terminal/result normalization.

The history/model/quota/health tools are read-only native projections. They do
not imply continuous intervention and remain useful for selection, diagnosis,
capacity, and exceptional recovery even when Host's minimal normal path does
not call every one of them.

### KEEP — necessary authority and safety

- `codex_respond`, `claude_respond`, and `pi_respond`: exact pending-request
  replies. These are permission/HITL mechanisms, not progress intervention.
- Native permission enforcement, request identity, fail-closed timeout/denial,
  mutation acknowledgement, authority epoch/fence, authorized Host effects,
  reconciliation-before-retry, and repository closure/promotion policy.
- Host restart/incarnation fencing and exact accepted-effect reconciliation.
- Bridge shutdown cleanup and exact-run cancellation needed to avoid orphaned
  processes or unsafe continuation.

### KEEP — exceptional native control, outside the normal path

- `codex_steer`, `claude_steer`, `pi_steer`.
- `codex_interrupt`, `claude_interrupt`, `pi_interrupt`.

Production-code reference inspection found no Host normal-path caller for any
steer tool. Interrupt references outside the Bridges are qualification/live
smokes and Host's Codex source-interrupt preparation for a specifically fenced
recovery scenario. These controls therefore remain public native capabilities
for explicit semantic-drift correction, user cancellation, test preparation,
and exceptional safety/recovery. Their existence must not be interpreted as an
instruction to poll and intervene continuously.

### RELOCATE

- Worker-specific Bridge launch, tool-name mapping, response decoding, and
  observation-address rules belong to Host. Host already has the current
  `bridge-adapter-registry.mjs` and provider-neutral observer implementation.
  WNS still contains an older duplicated mechanical runtime and Bridge-specific
  branches; that copy has only WNS tests and historical live-gate scripts as
  callers and is not the deployed Host implementation.
- Worker-neutral semantic policy remains in WNS and is projected into Host by
  the existing pinned policy-runtime provenance mechanism.
- Repository mutation/closure decisions remain repository policy enforced by
  LPB Core and the authorized Host-effect boundary. The two existing LPB
  repository-policy commits are preserved as pre-WCSR work.

### RETIRE

- Automatic translation of elapsed/reasoning telemetry into `soft_steer` and
  `interrupt` recommendations in the WNS liveness/watchdog control chain.
  Its only justification is continuous strong supervision. No deployed Host
  caller executes this chain.
- The obsolete duplicated WNS mechanical Host runtime after its ownership
  statements and any still-relevant historical evidence are preserved. The
  authoritative implementation is Host.
- Live-smoke assertions that make routine steering/interruption part of the
  normal execution story. Exceptional-control conformance tests remain.
- `codex_checkpoint`, after compatibility references are removed. Repository
  evidence identifies it as a frozen LCB-only legacy boundary exception; it has
  no Host, WNS production, or sibling-Bridge caller and duplicates durable
  Supervisor/Host cognition ownership.

## Retirement constraints

1. Do not remove steer or interrupt from any Bridge public surface.
2. Do not remove exact pending-request response tools.
3. Do not weaken recovery, reconciliation, authority, permission, shutdown, or
   repository safety behavior.
4. Remove WNS mechanical runtime only after package scripts and documentation
   point to Host and no WNS production import remains.
5. Remove `codex_checkpoint` only with its implementation, schemas, tests, and
   docs in one LCB closure, while leaving native Codex threads untouched.
6. Historical evidence files may remain as immutable records; they are not
   active dependencies and must not be rewritten to claim the new baseline.

## WCSR-2 acceptance

PASS: each public control category has an evidence-backed disposition; normal
path is separated from legacy/qualification/exceptional use; unsafe retirement
candidates are explicitly protected; the ownership move and retirement order
are fixed for WCSR-3 through WCSR-5; no runtime or public surface changed in
this stage.
