import { acknowledgeSameWorkerRespawn } from "../../supervisor-policy/same-worker-respawn.mjs";
import { acknowledgeCrossWorkerRecovery } from "../../supervisor-policy/cross-worker-recovery.mjs";
import { transitionHostState, validateHostState } from "./host-state.mjs";

export function hostStatus(host_state) {
  const state = validateHostState(host_state); const spawn = state.active_action?.spawn_evidence ?? null;
  return Object.freeze({ healthy: !["reconciling", "human_required"].includes(state.phase), phase: state.phase, task_id: state.task_checkpoint.task.id, checkpoint_revision: state.task_checkpoint.revision, sequence: state.sequence, retry_count: state.task_checkpoint.continuation.retry_count, worker_id: state.task_checkpoint.last_execution.worker_id, native_session_id: state.task_checkpoint.last_execution.native_session_id, active_claim: state.active_action?.claim_key ?? null, accepted_uncheckpointed_session: spawn?.native_session_id ?? null, escalation: state.escalation });
}

export async function reconcileAcceptedSpawn({ host_state, inspect_spawn, persist_state } = {}) {
  let state = validateHostState(host_state); const action = state.active_action; const evidence = action?.spawn_evidence;
  if (!action || !evidence || !["awaiting_ack", "reconciling"].includes(state.phase)) throw new TypeError("no accepted spawn is available to reconcile");
  const observed = await inspect_spawn(evidence);
  if (observed?.status !== "accepted" || observed.worker_id !== evidence.worker_id || observed.native_session_id !== evidence.native_session_id) {
    state = transitionHostState(state, { type: "human_required", reason_code: observed?.status === "rejected" ? "accepted_spawn_not_found" : "spawn_reconciliation_unresolved", evidence_ref: evidence.response_ref });
    if (persist_state) await persist_state(state); return Object.freeze({ outcome: "human_required", state });
  }
  const checkpoint = action.action === "spawn_same_worker" ? acknowledgeSameWorkerRespawn({ checkpoint: state.task_checkpoint, plan: action, new_native_session_id: evidence.native_session_id }) : acknowledgeCrossWorkerRecovery({ checkpoint: state.task_checkpoint, plan: action, new_native_session_id: evidence.native_session_id });
  state = transitionHostState({ ...state, phase: "awaiting_ack", escalation: null }, { type: "action_acknowledged", claim_key: action.claim_key, task_checkpoint: checkpoint, worker_id: evidence.worker_id, native_session_id: evidence.native_session_id, evidence_ref: evidence.response_ref });
  if (persist_state) await persist_state(state); return Object.freeze({ outcome: "reconciled", state });
}

export async function resumeHostAfterRestart({ host_state, inspect_spawn, spawn_transport, persist_state } = {}) {
  const state = validateHostState(host_state);
  if (state.active_action?.spawn_evidence && ["awaiting_ack", "reconciling"].includes(state.phase)) return reconcileAcceptedSpawn({ host_state: state, inspect_spawn, persist_state });
  if (state.phase === "action_pending") {
    if (typeof spawn_transport?.spawn !== "function") throw new TypeError("spawn_transport.spawn is required for an unstarted pending action");
    return Object.freeze({ outcome: "spawn_required", spawn_result: await spawn_transport.spawn(state.active_action), state });
  }
  return Object.freeze({ outcome: "observe", state });
}

export async function superviseUntilBoundary({ host_state, observe_once, max_cycles = 100, persist_state } = {}) {
  let state = validateHostState(host_state); if (!Number.isSafeInteger(max_cycles) || max_cycles < 1) throw new TypeError("max_cycles must be positive");
  for (let cycle = 0; cycle < max_cycles; cycle += 1) {
    if (["terminal", "human_required", "reconciling"].includes(state.phase)) return Object.freeze({ boundary: state.phase, cycles: cycle, state });
    const event = await observe_once(state); if (event === null) continue; state = transitionHostState(state, event); if (persist_state) await persist_state(state);
  }
  state = transitionHostState(state, { type: "human_required", reason_code: "supervision_cycle_budget_exhausted", evidence_ref: null }); if (persist_state) await persist_state(state);
  return Object.freeze({ boundary: "human_required", cycles: max_cycles, state });
}
