# Supervisor Runtime Contract

`contract.v0.json` is the canonical worker-neutral boundary record. ASR-1 freezes
its `durable_task_continuation` interface; it does not introduce a Supervisor
host, datastore, workflow engine, or automatic recovery behavior.

The authoritative task checkpoint belongs to the Supervisor. Its `task.id` is
independent of `last_execution.native_session_id`: a worker session may be
interrupted or replaced without losing completed gates, evidence/receipt/handoff
references, remaining gates, or the structured next action.

`supervisor-policy/task-continuation.mjs` provides pure deterministic validation,
canonical JSON serialization/restoration, and whole-section checkpoint updates.
Each meaningful gate, evidence, approval, handoff, workspace, semantic-progress,
or continuation change may produce the next revision for a caller to persist.
ASR-1 defines the durable representation but deliberately does not choose its
storage transport.

Evidence, receipts, and handoffs remain in their existing authoritative stores;
the checkpoint carries stable references and optional digests rather than copied
payloads. `semantic_progress` reuses the existing Supervisor normalizer. Free-form
model output, event logs, worker self-report, and advisory memory are not
authoritative checkpoint state.

Automatic respawn, retry execution, leases, and concurrent claiming remain
deferred beyond ASR-2.

## ASR-2 termination classification

`supervisor-policy/session-termination.mjs` deterministically classifies one
bounded termination signal against an ASR-1 checkpoint. It returns stable
classification, reason, disposition, same-worker retry eligibility, cross-worker
reroute eligibility, and automatic-resume eligibility. These are policy facts,
not executed recovery actions.

Precedence is terminal task state, approval state, safety block, contradictory or
absent evidence, then one recognized termination signal. Unknown or conflicting
evidence requires review. Pending/rejected approval and safety blocks require a
human and disable every automatic recovery eligibility. The classifier accepts no
free-form failure prose or provider-specific branches and does not mutate its
checkpoint input.

## ASR-3 same-worker respawn plan

`supervisor-policy/same-worker-respawn.mjs` is policy-qualified only. It does not
operate a live Supervisor Host or call a Bridge. For eligible ASR-2 outcomes it
builds a bounded `spawn_same_worker` envelope with a deterministic claim key,
the source execution identity, continuation cursor/action, retry transition,
workspace and gate snapshots, constraints, semantic progress, and references to
evidence, receipts, and handoffs. The target session remains `null`; transport
must create and return a new native session id.

The acknowledgement transition accepts that host-supplied id, rejects reuse of
the source session, advances checkpoint revision and retry count, and preserves
durable task material. Repeating the same acknowledgement is idempotent;
mismatched acknowledgements fail closed. ASR-3 does not implement host transport,
worker spawning, cross-worker rerouting, leases, or concurrency control.

## ASR-4 resume preflight

`supervisor-policy/resume-preflight.mjs` is a policy-qualified check over an
ASR-1 checkpoint, an ASR-3 same-worker or ASR-5 cross-worker spawn plan, and
closed host-observed facts. Only `pass` permits execution. Other stable decisions
are `stale_replan`, `recovery_required`, `human_required`, and
`already_completed`.

Preflight checks plan currency, task and workspace identity, approval/safety,
next-gate openness, completed-gate and reference continuity, prior claim keys,
and explicit effect kind/status. Unknown effects require reconciliation; applied
mutations and duplicate claims are not replayed. Read-only replay is allowed only
when the host explicitly classifies the effect as `read_only`. Preflight itself
does not inspect the filesystem, execute a plan/effect, call a Bridge, spawn a
session, or acknowledge execution.

## ASR-5 cross-worker recovery

`supervisor-policy/cross-worker-recovery.mjs` is policy-qualified only. For an
ASR-2 reroute-eligible outcome it delegates target choice to the existing
`selectWorker` policy while marking the source worker failed. Capability,
availability, quota, and task-shape rules therefore remain authoritative and the
source cannot be selected as its own recovery target.

The bounded `spawn_cross_worker` plan preserves the ASR-1 continuation material,
uses the checkpoint retry counter against `max_reroute_count`, and carries a
deterministic recovery claim key. Its target native session remains `null` until
a Host supplies one. Acknowledgement installs the selected target worker/session,
increments revision and retry count, preserves durable task state, is idempotent
for an exact duplicate, and rejects stale or mismatched transitions.

Cross-worker plans use ASR-4 preflight before execution, including its safety,
workspace, gate/reference, ambiguous-effect, applied-mutation, and duplicate-claim
checks. ASR-5 does not provide live Host enforcement, transport, Bridge calls,
session spawning, effects, timers, or daemon behavior.

## LSH-1 host runtime skeleton

`host-state.mjs` and `checkpoint-store.mjs` introduce the host-owned runtime
boundary without creating a fourth worker. The host state machine records an
ordered observation/action/acknowledgement lineage around the ASR-1 task
checkpoint. Native session identity remains replaceable while task identity is
stable.

The file store writes a checksummed envelope through an exclusive temporary
file, sync, and atomic rename. A per-checkpoint exclusive claim prevents two
host processes from supervising the same task concurrently. Missing state is a
clean first start; malformed or checksum-mismatched state fails closed. LSH-1
does not bind a live bridge or automatically spawn a worker.

## LSH-2 live observation binding

`bridge-observer.mjs` maps the existing Codex, Claude, and Pi observation/result
shapes into closed worker-neutral lifecycle facts. It preserves native session,
cursor, stream, pending-approval, and semantic-progress evidence and classifies
unknown lifecycle data as unknown. `mcp-stdio-port.mjs` is a thin JSON-RPC/MCP
client for existing bridge launchers; it contains no worker policy or transport
reimplementation. LSH-2 performs no replacement spawn.

`lsh2-live-probe-evidence.v0.json` records three independent successful
initialize/tool-list probes. A read-only retained Codex thread probe also
produced a normalized Host fact. Its bridge-local runtime is not reconstructable
from a fresh launcher, so lifecycle and semantic telemetry are explicitly
unknown/unavailable; the Host maps missing telemetry to a conservative blocked
watchdog shape while retaining `semantic_progress_available: false`.

## LSH-3 same-worker automatic rollover

`recovery-host.mjs` executes the ASR-2 → ASR-3 → ASR-4 sequence and delegates
the accepted spawn plan to `bridge-transport.mjs`. The transport injects the
bounded worker-neutral envelope from `continuation-envelope.mjs` into a fresh
native session through the existing Bridge tool. It never supplies the old
session as a continuation target.

The Host persists the planned, started, and acknowledged transitions. An
accepted response must include a native session identity different from the
source before the ASR acknowledgement advances the durable checkpoint. A
rejected or unknown acknowledgement enters reconciliation with the claim still
active and is not replayed. Pending approval and ambiguous effects stop before
transport.

The real Codex smoke in `lsh3-codex-live-smoke-evidence.v0.json` used one
persistent Bridge process for source start, observation, interruption,
replacement, and replacement observation. It proves distinct source/replacement
thread ids, stable Supervisor task identity, preserved completed gates, a real
atomic checkpoint, receipt chaining, continuation-envelope delivery without the
old thread id, and an unchanged read-only fixture.

## LSH-4 cross-worker recovery

The Host cross-worker path executes ASR-2 → ASR-5 → ASR-4, then uses the same
Bridge transport, continuation envelope, two-stage spawn receipt, and durable
acknowledgement boundary as LSH-3. It does not contain a router: ASR-5 delegates
selection to `selectWorker`.

The current source and every previously acknowledged worker in the recovery
lineage are supplied as `failed_workers`. Together with ASR-5's retry counter,
this prevents immediate A-B-A ping-pong and bounds the reroute chain. Exhausted
or unavailable routing returns without transport.

`lsh4-cross-worker-live-smoke-evidence.v0.json` records a real read-only Codex
interruption followed by ASR-5/`selectWorker` choosing Claude. All three Bridge
surfaces were available, the Claude native session was accepted and observable
on its persistent port, the Host checkpoint and receipt chain were durable, and
the disposable fixture hash was unchanged.

## LSH-5 production guardrails

`host-service.mjs` reconciles an accepted-but-not-checkpointed native session
after restart by inspecting that exact recorded worker/session identity; it
never issues another spawn. A match completes the original ASR acknowledgement,
while absent or unknown evidence becomes `human_required`. The bounded
supervision loop stops at terminal, reconciliation, or human-required state and
escalates when its cycle budget is exhausted.

Checkpoint locks protect concurrent claims and may be reclaimed only when the
recorded owner PID is demonstrably absent. Corrupt or checksum-mismatched state,
unreadable/unverifiable locks, duplicate claims, approval/safety blocks,
ambiguous effects, retry exhaustion, and post-spawn persistence failures all
fail closed. `scripts/supervisor-host-status.mjs` provides a read-only bounded
health/status projection.

`lsh5-host-restart-live-smoke-evidence.v0.json` records the real crash/restart
smoke. A child checkpoint owner exited with the dedicated simulated-crash code
91 and left its lock; a fresh Host reclaimed it only after ESRCH, observed the
exact existing Codex turn through the still-live parent Bridge, and reconciled
with the injected duplicate-spawn canary remaining at zero. A fresh Bridge
process could not reconstruct that runtime and correctly escalated to
`human_required`; Bridge-process restartability is not claimed.

## LSH-6 tri-worker source continuity

LSH-6 is CLOSED/PASS for the on-demand Host path. The existing Codex-source
baseline plus fresh Pi-source and Claude-source live lanes establish that each
supported worker can be the interrupted source of a cross-worker continuation.
Both new lanes used `scripts/lsh6-cross-source-live-smoke.mjs` against the real
deployed Bridge launchers from a host-capable environment.

The Pi lane derives its exact native source identity from
`pi_result.stats.sessionId` after an acknowledged soft interrupt and terminal
`interrupted` result. The Claude lane binds the Bridge run id to the native
`session_id` and records an acknowledged interrupt with terminal reason
`user_interrupt`. In both lanes ASR-5 delegates to `selectWorker`, excludes the
source, and selects a fresh Codex target. The target's accepted `thread_id`
matches the durable checkpoint identity and the exact same thread is observable
with live bridge runtime on the persistent target port.

The `SUPERVISOR_CONTINUATION_V1` envelope carries the stable task id and
completed LSH-1 through LSH-5 gates. Each disposable Git fixture remains byte-,
tree-, and status-clean; recovery advances exactly one bounded retry and persists
one deterministic claim with its spawn and acknowledgement receipts. The exact
native identities and receipt references are retained in
`lsh6-pi-source-live-smoke-evidence.v0.json` and
`lsh6-claude-source-live-smoke-evidence.v0.json`.

This qualification closes the LSH sequence without claiming a background
daemon, an always-on deployment, Bridge-process restartability, or Bridge-local
implementation changes. The Host remains an explicitly invoked runtime that
uses the existing Bridge transports and worker-neutral policy.
