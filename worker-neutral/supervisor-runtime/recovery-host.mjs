import { classifySessionTermination } from "../../supervisor-policy/session-termination.mjs";
import { planSameWorkerRespawn, acknowledgeSameWorkerRespawn } from "../../supervisor-policy/same-worker-respawn.mjs";
import { evaluateResumePreflight } from "../../supervisor-policy/resume-preflight.mjs";
import { planCrossWorkerRecovery, acknowledgeCrossWorkerRecovery } from "../../supervisor-policy/cross-worker-recovery.mjs";
import { transitionHostState, validateHostState } from "./host-state.mjs";

async function persist(callback, state) { if (callback) await callback(state); return state; }

export async function runSameWorkerRecovery({ host_state, termination_evidence, runtime_facts, policy, transport, persist_state } = {}) {
  let state = validateHostState(host_state); if (state.phase !== "observing") throw new TypeError("host must be observing");
  const termination = classifySessionTermination({ checkpoint: state.task_checkpoint, termination_evidence });
  const plan = planSameWorkerRespawn({ checkpoint: state.task_checkpoint, termination_result: termination, policy });
  if (!plan.planned) return Object.freeze({ outcome: "not_planned", reason_code: plan.reason_code, state });
  const preflight = evaluateResumePreflight({ checkpoint: state.task_checkpoint, plan, runtime_facts });
  if (!preflight.execution_allowed) {
    const type = preflight.decision === "human_required" ? "human_required" : "reconciliation_required";
    state = await persist(persist_state, transitionHostState(state, { type, reason_code: preflight.reason_code, evidence_ref: null }));
    return Object.freeze({ outcome: preflight.decision, reason_code: preflight.reason_code, state });
  }
  state = await persist(persist_state, transitionHostState(state, { type: "action_planned", action: plan }));
  state = await persist(persist_state, transitionHostState(state, { type: "action_started", claim_key: plan.claim_key }));
  const spawn = await transport.spawn(plan);
  if (spawn.acknowledgement !== "accepted") {
    const reason = spawn.acknowledgement === "unknown" ? "spawn_acknowledgement_unknown" : "spawn_rejected";
    state = await persist(persist_state, transitionHostState(state, { type: "reconciliation_required", reason_code: reason, evidence_ref: spawn.response_ref }));
    return Object.freeze({ outcome: "reconciliation_required", reason_code: reason, state });
  }
  state = await persist(persist_state, transitionHostState(state, { type: "spawn_observed", claim_key: plan.claim_key, worker_id: spawn.worker_id, native_session_id: spawn.native_session_id, evidence_ref: spawn.response_ref }));
  if (spawn.native_session_id === plan.source_native_session_id) {
    state = await persist(persist_state, transitionHostState(state, { type: "reconciliation_required", reason_code: "spawn_reused_source_session", evidence_ref: spawn.response_ref }));
    return Object.freeze({ outcome: "reconciliation_required", reason_code: "spawn_reused_source_session", state });
  }
  try {
    const checkpoint = acknowledgeSameWorkerRespawn({ checkpoint: state.task_checkpoint, plan, new_native_session_id: spawn.native_session_id });
    state = await persist(persist_state, transitionHostState(state, { type: "action_acknowledged", claim_key: plan.claim_key, task_checkpoint: checkpoint, worker_id: spawn.worker_id, native_session_id: spawn.native_session_id, evidence_ref: spawn.response_ref }));
  } catch (error) {
    const reconciled = transitionHostState(state, { type: "reconciliation_required", reason_code: "post_spawn_checkpoint_failure", evidence_ref: spawn.response_ref });
    try { state = await persist(persist_state, reconciled); } catch { state = reconciled; }
    return Object.freeze({ outcome: "reconciliation_required", reason_code: "post_spawn_checkpoint_failure", state, error });
  }
  return Object.freeze({ outcome: "spawned", reason_code: "same_worker_rollover_acknowledged", state });
}

export async function runCrossWorkerRecovery({ host_state, termination_evidence, runtime_facts, policy, transport, persist_state, task, worker_state, routing_policy = {} } = {}) {
  let state = validateHostState(host_state); if (state.phase !== "observing") throw new TypeError("host must be observing");
  const termination = classifySessionTermination({ checkpoint: state.task_checkpoint, termination_evidence });
  const attemptedWorkers = state.receipts.filter(({ event }) => event === "action_acknowledged").map(({ worker_id }) => worker_id).filter(Boolean);
  const failedWorkers = [...new Set([...(worker_state?.failed_workers ?? []), ...attemptedWorkers, state.task_checkpoint.last_execution.worker_id])];
  const plan = planCrossWorkerRecovery({ checkpoint: state.task_checkpoint, termination_result: termination, task, worker_state: { ...worker_state, failed_workers: failedWorkers }, routing_policy, policy });
  if (!plan.planned) return Object.freeze({ outcome: "not_planned", reason_code: plan.reason_code, state });
  const preflight = evaluateResumePreflight({ checkpoint: state.task_checkpoint, plan, runtime_facts });
  if (!preflight.execution_allowed) { const type = preflight.decision === "human_required" ? "human_required" : "reconciliation_required"; state = await persist(persist_state, transitionHostState(state, { type, reason_code: preflight.reason_code, evidence_ref: null })); return Object.freeze({ outcome: preflight.decision, reason_code: preflight.reason_code, state }); }
  state = await persist(persist_state, transitionHostState(state, { type: "action_planned", action: plan }));
  state = await persist(persist_state, transitionHostState(state, { type: "action_started", claim_key: plan.claim_key }));
  const spawn = await transport.spawn(plan);
  if (spawn.acknowledgement !== "accepted") { const reason = spawn.acknowledgement === "unknown" ? "spawn_acknowledgement_unknown" : "spawn_rejected"; state = await persist(persist_state, transitionHostState(state, { type: "reconciliation_required", reason_code: reason, evidence_ref: spawn.response_ref })); return Object.freeze({ outcome: "reconciliation_required", reason_code: reason, state }); }
  state = await persist(persist_state, transitionHostState(state, { type: "spawn_observed", claim_key: plan.claim_key, worker_id: spawn.worker_id, native_session_id: spawn.native_session_id, evidence_ref: spawn.response_ref }));
  try {
    const checkpoint = acknowledgeCrossWorkerRecovery({ checkpoint: state.task_checkpoint, plan, new_native_session_id: spawn.native_session_id });
    state = await persist(persist_state, transitionHostState(state, { type: "action_acknowledged", claim_key: plan.claim_key, task_checkpoint: checkpoint, worker_id: spawn.worker_id, native_session_id: spawn.native_session_id, evidence_ref: spawn.response_ref }));
  } catch (error) {
    const reconciled = transitionHostState(state, { type: "reconciliation_required", reason_code: "post_spawn_checkpoint_failure", evidence_ref: spawn.response_ref }); try { state = await persist(persist_state, reconciled); } catch { state = reconciled; }
    return Object.freeze({ outcome: "reconciliation_required", reason_code: "post_spawn_checkpoint_failure", state, error });
  }
  return Object.freeze({ outcome: "spawned", reason_code: "cross_worker_recovery_acknowledged", state, target_worker_id: plan.target_worker_id });
}
