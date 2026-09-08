import { createHash } from "node:crypto";
import { updateTaskCheckpoint, validateTaskCheckpoint } from "./task-continuation.mjs";

export const RESPAWN_PLAN_VERSION = 1;

export const RESPAWN_PLAN_REASONS = Object.freeze({
  ELIGIBLE: "same_worker_respawn_eligible",
  TASK_NOT_OPEN: "task_not_open",
  CLASSIFICATION_INELIGIBLE: "termination_classification_ineligible",
  UNSAFE_TO_RESUME: "checkpoint_not_safe_to_resume",
  APPROVAL_BLOCKED: "approval_blocks_respawn",
  RETRY_BUDGET_EXHAUSTED: "retry_budget_exhausted",
  SOURCE_WORKER_MISSING: "source_worker_missing",
  SOURCE_SESSION_MISSING: "source_session_missing",
});

const RESULT_KEYS = ["classification", "reason_code", "disposition", "same_worker_retry_eligible", "cross_worker_reroute_eligible", "automatic_resume_eligible"];
const ELIGIBLE_REASONS = new Set([
  "session_interrupted", "session_timeout", "runtime_timeout", "context_exhausted",
  "transient_provider_error", "model_stall",
]);

function plainObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${label} must be a plain object`);
  return value;
}
function exactKeys(value, keys, label) {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new TypeError(`${label} has an unknown key: ${key}`);
  for (const key of keys) if (!Object.hasOwn(value, key)) throw new TypeError(`${label}.${key} is required`);
}
function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a non-negative safe integer`);
  return value;
}
function nonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) throw new TypeError(`${label} must be a non-empty, trimmed string`);
  return value;
}
function normalizeTerminationResult(value) {
  const result = plainObject(value, "termination_result");
  exactKeys(result, RESULT_KEYS, "termination_result");
  for (const key of ["classification", "reason_code", "disposition"]) nonEmptyString(result[key], `termination_result.${key}`);
  for (const key of ["same_worker_retry_eligible", "cross_worker_reroute_eligible", "automatic_resume_eligible"]) if (typeof result[key] !== "boolean") throw new TypeError(`termination_result.${key} must be a boolean`);
  return result;
}
function normalizePolicy(policy) {
  const value = plainObject(policy, "policy");
  exactKeys(value, ["max_retry_count"], "policy");
  return { max_retry_count: nonNegativeInteger(value.max_retry_count, "policy.max_retry_count") };
}
function rejected(reason_code) { return Object.freeze({ planned: false, reason_code }); }
function claimKey(taskId, revision, workerId, sessionId, retryAfter) {
  return `sha256:${createHash("sha256").update(JSON.stringify([RESPAWN_PLAN_VERSION, taskId, revision, workerId, sessionId, retryAfter])).digest("hex")}`;
}
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function planSameWorkerRespawn({ checkpoint, termination_result, policy } = {}) {
  const state = validateTaskCheckpoint(checkpoint);
  const result = normalizeTerminationResult(termination_result);
  const limits = normalizePolicy(policy);
  if (state.task.status !== "open") return rejected(RESPAWN_PLAN_REASONS.TASK_NOT_OPEN);
  const eligibleClassification = result.classification === "resumable" || result.classification === "retry_same_worker_candidate";
  if (!eligibleClassification || !ELIGIBLE_REASONS.has(result.reason_code) || (!result.automatic_resume_eligible && !result.same_worker_retry_eligible)) return rejected(RESPAWN_PLAN_REASONS.CLASSIFICATION_INELIGIBLE);
  if (!state.continuation.safe_to_resume) return rejected(RESPAWN_PLAN_REASONS.UNSAFE_TO_RESUME);
  if (state.constraints.approval.status === "pending" || state.constraints.approval.status === "rejected") return rejected(RESPAWN_PLAN_REASONS.APPROVAL_BLOCKED);
  if (state.continuation.retry_count >= limits.max_retry_count) return rejected(RESPAWN_PLAN_REASONS.RETRY_BUDGET_EXHAUSTED);
  if (state.last_execution.worker_id === null) return rejected(RESPAWN_PLAN_REASONS.SOURCE_WORKER_MISSING);
  if (state.last_execution.native_session_id === null) return rejected(RESPAWN_PLAN_REASONS.SOURCE_SESSION_MISSING);

  const retryAfter = state.continuation.retry_count + 1;
  return deepFreeze({
    planned: true,
    reason_code: RESPAWN_PLAN_REASONS.ELIGIBLE,
    plan_version: RESPAWN_PLAN_VERSION,
    action: "spawn_same_worker",
    claim_key: claimKey(state.task.id, state.revision, state.last_execution.worker_id, state.last_execution.native_session_id, retryAfter),
    task_id: state.task.id,
    checkpoint_revision: state.revision,
    source_worker_id: state.last_execution.worker_id,
    source_native_session_id: state.last_execution.native_session_id,
    target_native_session_id: null,
    next_action: state.continuation.next_action,
    resume_cursor: state.continuation.resume_cursor,
    retry_count_before: state.continuation.retry_count,
    retry_count_after: retryAfter,
    retry_limit: limits.max_retry_count,
    workspace: state.workspace,
    gates: state.gates,
    constraints: state.constraints,
    evidence_refs: state.evidence_refs,
    receipt_refs: state.receipt_refs,
    handoff_refs: state.handoff_refs,
    semantic_progress: state.semantic_progress,
  });
}

export function acknowledgeSameWorkerRespawn({ checkpoint, plan, new_native_session_id } = {}) {
  const state = validateTaskCheckpoint(checkpoint);
  const newSessionId = nonEmptyString(new_native_session_id, "new_native_session_id");
  const respawnPlan = plainObject(plan, "plan");
  if (respawnPlan.planned !== true || respawnPlan.action !== "spawn_same_worker" || respawnPlan.plan_version !== RESPAWN_PLAN_VERSION) throw new TypeError("plan is not an ASR-3 same-worker respawn plan");
  if (newSessionId === respawnPlan.source_native_session_id) throw new TypeError("new_native_session_id must differ from source_native_session_id");

  const isFirstAck = state.revision === respawnPlan.checkpoint_revision;
  const isDuplicateAck = state.revision === respawnPlan.checkpoint_revision + 1 && state.last_execution.native_session_id === newSessionId && state.last_execution.worker_id === respawnPlan.source_worker_id && state.continuation.retry_count === respawnPlan.retry_count_after;
  if (isDuplicateAck) return state;
  if (!isFirstAck) throw new TypeError("acknowledgement checkpoint revision does not match plan");
  if (state.task.id !== respawnPlan.task_id || state.last_execution.worker_id !== respawnPlan.source_worker_id || state.last_execution.native_session_id !== respawnPlan.source_native_session_id || state.continuation.retry_count !== respawnPlan.retry_count_before) throw new TypeError("acknowledgement checkpoint does not match plan source");
  const expectedKey = claimKey(state.task.id, state.revision, state.last_execution.worker_id, state.last_execution.native_session_id, respawnPlan.retry_count_after);
  if (respawnPlan.claim_key !== expectedKey || respawnPlan.retry_count_after !== respawnPlan.retry_count_before + 1 || respawnPlan.retry_count_after > respawnPlan.retry_limit) throw new TypeError("respawn plan transition is invalid");
  return updateTaskCheckpoint(state, {
    last_execution: { worker_id: respawnPlan.source_worker_id, native_session_id: newSessionId, native_status: "running" },
    continuation: { ...state.continuation, retry_count: respawnPlan.retry_count_after },
  });
}
