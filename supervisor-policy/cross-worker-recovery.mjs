import { createHash } from "node:crypto";
import { selectWorker, WORKERS } from "./policy.mjs";
import { updateTaskCheckpoint, validateTaskCheckpoint } from "./task-continuation.mjs";

export const CROSS_WORKER_PLAN_VERSION = 1;
export const CROSS_WORKER_REASONS = Object.freeze({
  ELIGIBLE: "cross_worker_recovery_eligible",
  TASK_NOT_OPEN: "task_not_open",
  CLASSIFICATION_INELIGIBLE: "cross_worker_classification_ineligible",
  UNSAFE_TO_RESUME: "checkpoint_not_safe_to_resume",
  APPROVAL_BLOCKED: "approval_blocks_reroute",
  BUDGET_EXHAUSTED: "reroute_budget_exhausted",
  SOURCE_WORKER_MISSING: "source_worker_missing",
  SOURCE_SESSION_MISSING: "source_session_missing",
  SOURCE_WORKER_UNSUPPORTED: "source_worker_unsupported",
  TARGET_UNAVAILABLE: "no_supported_target_worker",
});

const RESULT_KEYS = ["classification", "reason_code", "disposition", "same_worker_retry_eligible", "cross_worker_reroute_eligible", "automatic_resume_eligible"];

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${label} must be a plain object`);
  return value;
}
function exactKeys(value, keys, label) {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new TypeError(`${label} has an unknown key: ${key}`);
  for (const key of keys) if (!Object.hasOwn(value, key)) throw new TypeError(`${label}.${key} is required`);
}
function integer(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a non-negative safe integer`);
  return value;
}
function string(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) throw new TypeError(`${label} must be a non-empty, trimmed string`);
  return value;
}
function normalizeResult(value) {
  const result = object(value, "termination_result"); exactKeys(result, RESULT_KEYS, "termination_result");
  for (const key of ["classification", "reason_code", "disposition"]) string(result[key], `termination_result.${key}`);
  for (const key of ["same_worker_retry_eligible", "cross_worker_reroute_eligible", "automatic_resume_eligible"]) if (typeof result[key] !== "boolean") throw new TypeError(`termination_result.${key} must be a boolean`);
  return result;
}
function normalizeLimit(value) {
  const policy = object(value, "policy"); exactKeys(policy, ["max_reroute_count"], "policy");
  return integer(policy.max_reroute_count, "policy.max_reroute_count");
}
function rejected(reason_code) { return Object.freeze({ planned: false, reason_code }); }
function claimKey(state, targetWorker, after) {
  const tuple = [CROSS_WORKER_PLAN_VERSION, state.task.id, state.revision, state.last_execution.worker_id, state.last_execution.native_session_id, targetWorker, after];
  return `sha256:${createHash("sha256").update(JSON.stringify(tuple)).digest("hex")}`;
}
function freeze(value) { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) freeze(child); } return value; }

export function planCrossWorkerRecovery({ checkpoint, termination_result, task, worker_state, routing_policy = {}, policy } = {}) {
  const state = validateTaskCheckpoint(checkpoint);
  const result = normalizeResult(termination_result);
  const limit = normalizeLimit(policy);
  object(task, "task"); object(worker_state, "worker_state"); object(routing_policy, "routing_policy");
  if (state.task.status !== "open") return rejected(CROSS_WORKER_REASONS.TASK_NOT_OPEN);
  if (state.constraints.approval.status === "pending" || state.constraints.approval.status === "rejected") return rejected(CROSS_WORKER_REASONS.APPROVAL_BLOCKED);
  if (result.classification !== "retry_or_reroute_candidate" || result.reason_code !== "tool_runtime_failure" || !result.cross_worker_reroute_eligible) return rejected(CROSS_WORKER_REASONS.CLASSIFICATION_INELIGIBLE);
  if (!state.continuation.safe_to_resume) return rejected(CROSS_WORKER_REASONS.UNSAFE_TO_RESUME);
  if (state.continuation.retry_count >= limit) return rejected(CROSS_WORKER_REASONS.BUDGET_EXHAUSTED);
  if (state.last_execution.worker_id === null) return rejected(CROSS_WORKER_REASONS.SOURCE_WORKER_MISSING);
  if (state.last_execution.native_session_id === null) return rejected(CROSS_WORKER_REASONS.SOURCE_SESSION_MISSING);
  if (!WORKERS.includes(state.last_execution.worker_id)) return rejected(CROSS_WORKER_REASONS.SOURCE_WORKER_UNSUPPORTED);

  const failedWorkers = [...new Set([...(worker_state.failed_workers ?? []), state.last_execution.worker_id])];
  const selection = selectWorker({ task, state: { ...worker_state, active_worker: null, active_terminal: true, pending_hitl: false, mutation_ack: null, failed_workers: failedWorkers }, policy: routing_policy });
  if (selection.action !== "select" || selection.worker === null || selection.worker === state.last_execution.worker_id) return rejected(CROSS_WORKER_REASONS.TARGET_UNAVAILABLE);
  const after = state.continuation.retry_count + 1;
  return freeze({
    planned: true, reason_code: CROSS_WORKER_REASONS.ELIGIBLE, plan_version: CROSS_WORKER_PLAN_VERSION,
    action: "spawn_cross_worker", claim_key: claimKey(state, selection.worker, after),
    task_id: state.task.id, checkpoint_revision: state.revision,
    source_worker_id: state.last_execution.worker_id, source_native_session_id: state.last_execution.native_session_id,
    target_worker_id: selection.worker, target_native_session_id: null,
    next_action: state.continuation.next_action, resume_cursor: state.continuation.resume_cursor,
    retry_count_before: state.continuation.retry_count, retry_count_after: after, retry_limit: limit,
    workspace: state.workspace, gates: state.gates, constraints: state.constraints,
    evidence_refs: state.evidence_refs, receipt_refs: state.receipt_refs,
    handoff_refs: state.handoff_refs, semantic_progress: state.semantic_progress,
  });
}

export function acknowledgeCrossWorkerRecovery({ checkpoint, plan, new_native_session_id } = {}) {
  const state = validateTaskCheckpoint(checkpoint);
  const recoveryPlan = object(plan, "plan");
  const newSession = string(new_native_session_id, "new_native_session_id");
  if (recoveryPlan.planned !== true || recoveryPlan.plan_version !== CROSS_WORKER_PLAN_VERSION || recoveryPlan.action !== "spawn_cross_worker") throw new TypeError("plan is not an ASR-5 cross-worker recovery plan");
  if (recoveryPlan.source_worker_id === recoveryPlan.target_worker_id) throw new TypeError("target worker must differ from source worker");
  if (!WORKERS.includes(recoveryPlan.target_worker_id)) throw new TypeError("target worker is unsupported");
  if (newSession === recoveryPlan.source_native_session_id) throw new TypeError("new_native_session_id must differ from source_native_session_id");
  const duplicate = state.revision === recoveryPlan.checkpoint_revision + 1 && state.last_execution.worker_id === recoveryPlan.target_worker_id && state.last_execution.native_session_id === newSession && state.continuation.retry_count === recoveryPlan.retry_count_after;
  if (duplicate) return state;
  if (state.revision !== recoveryPlan.checkpoint_revision) throw new TypeError("acknowledgement checkpoint revision does not match plan");
  if (state.task.id !== recoveryPlan.task_id || state.last_execution.worker_id !== recoveryPlan.source_worker_id || state.last_execution.native_session_id !== recoveryPlan.source_native_session_id || state.continuation.retry_count !== recoveryPlan.retry_count_before) throw new TypeError("acknowledgement checkpoint does not match plan source");
  if (recoveryPlan.claim_key !== claimKey(state, recoveryPlan.target_worker_id, recoveryPlan.retry_count_after) || recoveryPlan.retry_count_after !== recoveryPlan.retry_count_before + 1 || recoveryPlan.retry_count_after > recoveryPlan.retry_limit) throw new TypeError("cross-worker recovery plan transition is invalid");
  return updateTaskCheckpoint(state, { last_execution: { worker_id: recoveryPlan.target_worker_id, native_session_id: newSession, native_status: "running" }, continuation: { ...state.continuation, retry_count: recoveryPlan.retry_count_after } });
}
