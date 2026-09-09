# SHD-4/v1 — real Supervisor Host SIGKILL continuation/recovery contract

## 1. Identity, authority, and freeze

- **Contract ID:** `SHD-4/v1`.
- **Status:** **FROZEN / READY_FOR_LIVE_GATE**. This contract is not a SHD-4 closure or PASS record. The required live evidence is pending.
- Once this contract is committed, any semantic acceptance change requires a new contract version and independent review. The live gate MUST cite that frozen Git commit and MUST NOT edit this contract during its acceptance attempt.
- The future evidence path is reserved as `worker-neutral/supervisor-runtime/shd4-host-sigkill-live-smoke-evidence.v1.json`. It does not exist at contract-authoring time.

Normative terms **MUST**, **MUST NOT**, **REQUIRED**, and **MAY** define acceptance requirements.

## 2. Goal and ownership boundary

SHD-4 proves that one real, unexpected `SIGKILL` of the always-on Supervisor Host daemon is recovered by the existing systemd user service and durable Host state without restarting the task from the beginning, duplicating a worker spawn/effect, or blindly replaying a mutation.

The Supervisor owns semantic acceptance, escalation, and the final PASS/NOT-PASS decision. The Host owns only deterministic durable checkpoints, lock/reclaim behavior, reconciliation, and restart/continuation mechanics. Bridge, worker, and native runtime lifecycle is independently owned. Host restartability NEVER implies Bridge restartability.

## 3. Exact fault target and exclusions

The fault injection is exactly ONE `SIGKILL` sent to the captured old `MainPID` of `worker-neutral-supervisor-host.service`, which is the Supervisor Host daemon. Before sending it, the positive attempt MUST unambiguously prove the service, `MainPID`, executable/cmdline, unit, and `ExecStart` identity.

The target is NOT a Codex, Claude, or Pi Bridge; NOT a worker or native session; NOT a process group; NOT a Bridge service; and NOT `systemctl stop`, `systemctl restart`, or any broad kill. A signal to an ambiguous or wrong target invalidates the attempt.

## 4. Preconditions

Before the attempt begins, evidence MUST establish all of the following:

1. SHD-0 through SHD-3 are CLOSED/PASS.
2. `BR-Claude Recovery Validation` is CLOSED/PASS. This is an **EXTERNAL / supervisor-recorded prerequisite**; no in-repository evidence may be fabricated for it.
3. The deployed user service's exact expected unit and `ExecStart` are captured, the Host is active/ready/healthy, and `Restart=on-failure` is proven from the deployed unit.
4. Repository HEAD/worktree and repository, deployed-unit, and frozen-contract hashes are captured.
5. The workspace/fixture is disposable and read-only/non-mutating.
6. One REAL native worker session is already accepted. Its exact `worker_id` and `native_session_id` are durably recorded; its native turn id is recorded when available.
7. The durable checkpoint is valid and digest-verified, and its continuation has `safe_to_resume=true`.
8. The REQUIRED injection boundary in section 5 is durably present.

## 5. Required injection boundary

Before `SIGKILL`, durable Host state MUST contain accepted-but-not-yet-acknowledged spawn/effect evidence: durable `spawn_evidence` and phase `awaiting_ack`, or a semantically equivalent durable representation. The evidence MUST bind the deterministic claim, exact worker, exact native session, and accepted effect/response lineage.

This boundary is mandatory because it makes duplicate-spawn prevention observable. Killing the Host before an accepted effect exists does NOT satisfy the primary SHD-4 positive gate.

## 6. Required restart and recovery ordering

The positive attempt MUST preserve this order:

1. Send exactly one `SIGKILL` to the captured old Host `MainPID`.
2. Demonstrate that old `MainPID` is absent.
3. Allow systemd `Restart=on-failure` to start a NEW Host automatically. No manual start, restart, or repair is permitted.
4. Reclaim stale service/checkpoint locks only after their old owner is ESRCH-confirmed dead.
5. Load and digest-verify durable checkpoint state BEFORE taking action.
6. Read the descriptor; an expected-revision or native-session mismatch is a stale no-op.
7. Inspect the exact recorded worker/session identity.
8. Reconcile the accepted spawn/effect BEFORE any retry or spawn.
9. On an exact accepted match, record exactly one `action_acknowledged` and transition to `observing`, or a later valid continuation phase, with the same native session.
10. If runtime/effect state is unknown or unprovable, fail closed to `reconciling` or `human_required`; never blindly replay.

## 7. Primary mandatory PASS evidence

A PASS requires one coherent evidence artifact proving every item below:

- Before the kill, the Host is active/ready/healthy and its old `MainPID`, exact service identity, unit, executable/cmdline, and `ExecStart` are captured.
- Exactly one `SIGKILL` targets that old `MainPID`, and the old PID is afterward absent.
- systemd recovers the service automatically: the new `MainPID` differs from the old one, and the Host is active/ready/healthy within a bounded 30 seconds, with zero manual start/restart/repair actions.
- Host service/daemon path and unit are unchanged.
- Bridge service/process and the SAME native worker session remain alive/available and are NOT restarted by Host recovery; captured identities are sufficient to prove continuity.
- Durable task identity, completed/open gates, workspace, continuation, and resume cursor survive.
- The checkpoint envelope and digest verify after restart.
- The exact prior `worker_id` and `native_session_id` are observed after restart; the native turn id also matches when available.
- `spawn_calls_after_restart = 0`, and no duplicate claim exists.
- Receipt lineage contains the pre-kill accepted `spawn_observed` and exactly ONE post-restart `action_acknowledged` for that claim.
- Resulting phase is `observing`, or a later valid continuation phase, with the same native session.
- Disposable fixture before/after hashes match and `mutation_effect = none`.
- Repository HEAD/worktree, systemd unit, and frozen contract remain unchanged throughout the attempt.

All claims MUST be supported by captured facts, not process assumptions or worker self-report.

## 8. NOT-PASS and safe failure

SHD-4 is NOT PASS if any duplicate spawn/effect or blind replay occurs; Host recovery causes a Bridge/worker restart; signal targeting is wrong or ambiguous; checkpoint state is corrupt or unverifiable; retry precedes reconciliation; the task restarts from the beginning; manual service start/repair is required; repository/unit/contract mutation occurs during the attempt; or exact worker/session identity cannot be proven.

Fail-closed ambiguity ending in `reconciling` or `human_required` is SAFE behavior, but it does NOT satisfy the primary positive-path PASS.

## 9. Single-attempt discipline

Once the real `SIGKILL` acceptance attempt begins, there MUST be no retry, repair, second signal, manual service start/restart, or fixture rewrite within that attempt. On unexpected failure, STOP and perform only a read-only forensic audit. Any later retry is a new, separately authorized attempt against a known baseline with a distinct attempt id.

## 10. Reserved future evidence schema

The future artifact `worker-neutral/supervisor-runtime/shd4-host-sigkill-live-smoke-evidence.v1.json` MUST contain, at minimum:

- contract id/version and `frozen_commit`;
- attempt id and timestamps;
- baseline repository HEAD/worktree plus repository, deployed-unit, and frozen-contract hashes;
- external prerequisite references and all precondition results;
- fault-target service, old `MainPID`, executable/cmdline, signal type/count, and target-identity proof;
- pre-kill Host, Bridge/process, worker, native-session, and available native-turn identities;
- durable pre-kill task/gates/workspace/continuation/phase, `spawn_evidence`, effect, and claim state;
- restart timing, old-PID absence, new `MainPID`, automatic-restart proof, and bounded health results;
- service/checkpoint lock owner, ESRCH, and reclaim facts;
- post-restart checkpoint envelope/digest verification and preserved task/gate/workspace/continuation facts;
- exact worker/session/turn reconciliation and Bridge/session continuity facts;
- `spawn_calls_after_restart`, claims, and full relevant receipt lineage;
- fixture before/after hashes and `mutation_effect`;
- post-attempt repository HEAD/worktree and repository/unit/contract hashes;
- manual intervention count; and
- verdict plus every failed criterion, if any.

The artifact MUST distinguish observed values from derived assertions and MUST be sufficient to audit every section 7 claim. It is evidence, not authority to weaken this contract.

## 11. Non-goals

SHD-4 does not prove machine reboot or logout survival, Bridge crash recovery, cross-worker reroute, production-task mutation, native-worker survival after Bridge death, broad kill/process-group recovery, a Host implementation change, or generalization from `SIGKILL` to every failure mode.

## 12. Prior-evidence caveat

Existing LSH-5 tests and `lsh5-host-restart-live-smoke-evidence.v0.json` are supporting prior evidence for reconciliation and stale-lock mechanics only. They used a simulated crash/checkpoint-owner boundary and do NOT prove the exact SHD-4 real always-on Host `SIGKILL` gate, automatic systemd recovery, or the required full continuity evidence. Likewise, Host restartability does not prove Bridge restartability.
