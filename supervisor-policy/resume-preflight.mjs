import { validateTaskCheckpoint } from "./task-continuation.mjs";

export const PREFLIGHT_DECISIONS = Object.freeze({
  PASS: "pass",
  STALE_REPLAN: "stale_replan",
  RECOVERY_REQUIRED: "recovery_required",
  HUMAN_REQUIRED: "human_required",
  ALREADY_COMPLETED: "already_completed",
});

export const PREFLIGHT_REASONS = Object.freeze({
  SAFE_TO_EXECUTE: "preflight_safe_to_execute",
  TASK_MISMATCH: "plan_task_mismatch",
  STALE_REVISION: "plan_checkpoint_revision_stale",
  TASK_NOT_OPEN: "task_not_open",
  UNSAFE_TO_RESUME: "checkpoint_not_safe_to_resume",
  APPROVAL_BLOCKED: "approval_blocks_execution",
  HUMAN_BLOCK: "explicit_human_block",
  SAFETY_BLOCK: "explicit_safety_block",
  WORKSPACE_PATH_MISMATCH: "workspace_path_mismatch",
  WORKSPACE_SHA_MISMATCH: "workspace_git_sha_mismatch",
  WORKSPACE_BRANCH_MISMATCH: "workspace_branch_mismatch",
  GATE_ALREADY_COMPLETED: "next_gate_already_completed",
  GATE_NOT_OPEN: "next_gate_not_open",
  COMPLETED_GATES_DRIFT: "completed_gates_drift",
  REQUIRED_REFS_DRIFT: "required_references_drift",
  DUPLICATE_CLAIM: "claim_already_recorded",
  EFFECT_UNKNOWN: "effect_state_unknown_reconcile",
  EFFECT_ALREADY_APPLIED: "effect_already_applied",
  EFFECT_KIND_UNKNOWN: "effect_kind_unknown",
});

const PLAN_KEYS = ["planned", "reason_code", "plan_version", "action", "claim_key", "task_id", "checkpoint_revision", "source_worker_id", "source_native_session_id", "target_native_session_id", "next_action", "resume_cursor", "retry_count_before", "retry_count_after", "retry_limit", "workspace", "gates", "constraints", "evidence_refs", "receipt_refs", "handoff_refs", "semantic_progress"];
const EFFECT_KINDS = new Set(["none", "read_only", "mutating", "unknown"]);
const EFFECT_STATUSES = new Set(["none", "known_not_applied", "applied", "unknown"]);
const HUMAN_BLOCKS = new Set(["none", "human_required", "safety_block"]);

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${label} must be a plain object`);
  return value;
}
function exactKeys(value, keys, label) {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new TypeError(`${label} has an unknown key: ${key}`);
  for (const key of keys) if (!Object.hasOwn(value, key)) throw new TypeError(`${label}.${key} is required`);
}
function string(value, label, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) throw new TypeError(`${label} must be a non-empty, trimmed string${nullable ? " or null" : ""}`);
  return value;
}
function strings(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  const normalized = value.map((item, index) => string(item, `${label}[${index}]`));
  if (new Set(normalized).size !== normalized.length) throw new TypeError(`${label} must not contain duplicates`);
  return normalized;
}
function enumValue(value, allowed, label) {
  if (!allowed.has(value)) throw new TypeError(`${label} has an invalid value`);
  return value;
}
function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function decision(value, reason_code) { return Object.freeze({ decision: value, reason_code, execution_allowed: value === PREFLIGHT_DECISIONS.PASS }); }
function refsPresent(required, current) {
  return required.every((reference) => current.some((candidate) => same(candidate, reference)));
}

function normalizePlan(plan) {
  const value = object(plan, "plan");
  const crossWorker = value.action === "spawn_cross_worker";
  exactKeys(value, crossWorker ? [...PLAN_KEYS, "target_worker_id"] : PLAN_KEYS, "plan");
  if (value.planned !== true || value.plan_version !== 1 || (!crossWorker && value.action !== "spawn_same_worker") || value.target_native_session_id !== null) throw new TypeError("plan must be an executable ASR-3/5 spawn plan");
  if (crossWorker) {
    string(value.target_worker_id, "plan.target_worker_id");
    if (value.target_worker_id === value.source_worker_id) throw new TypeError("cross-worker plan target must differ from source worker");
  }
  string(value.claim_key, "plan.claim_key");
  string(value.task_id, "plan.task_id");
  if (!Number.isSafeInteger(value.checkpoint_revision) || value.checkpoint_revision < 0) throw new TypeError("plan.checkpoint_revision must be a non-negative safe integer");
  object(value.next_action, "plan.next_action");
  return value;
}

function normalizeFacts(facts) {
  const value = object(facts, "runtime_facts");
  exactKeys(value, ["workspace", "human_block", "effect"], "runtime_facts");
  const workspace = object(value.workspace, "runtime_facts.workspace");
  exactKeys(workspace, ["path", "git_sha", "branch"], "runtime_facts.workspace");
  const effect = object(value.effect, "runtime_facts.effect");
  exactKeys(effect, ["kind", "status", "prior_claim_keys"], "runtime_facts.effect");
  return {
    workspace: { path: string(workspace.path, "runtime_facts.workspace.path"), git_sha: string(workspace.git_sha, "runtime_facts.workspace.git_sha", true), branch: string(workspace.branch, "runtime_facts.workspace.branch", true) },
    human_block: enumValue(value.human_block, HUMAN_BLOCKS, "runtime_facts.human_block"),
    effect: { kind: enumValue(effect.kind, EFFECT_KINDS, "runtime_facts.effect.kind"), status: enumValue(effect.status, EFFECT_STATUSES, "runtime_facts.effect.status"), prior_claim_keys: strings(effect.prior_claim_keys, "runtime_facts.effect.prior_claim_keys") },
  };
}

/** Policy-qualified ASR-4 check only; performs no effect, spawn, or acknowledgement. */
export function evaluateResumePreflight({ checkpoint, plan, runtime_facts } = {}) {
  const state = validateTaskCheckpoint(checkpoint);
  const recoveryPlan = normalizePlan(plan);
  const facts = normalizeFacts(runtime_facts);

  if (recoveryPlan.task_id !== state.task.id) return decision(PREFLIGHT_DECISIONS.STALE_REPLAN, PREFLIGHT_REASONS.TASK_MISMATCH);
  if (recoveryPlan.checkpoint_revision !== state.revision) return decision(PREFLIGHT_DECISIONS.STALE_REPLAN, PREFLIGHT_REASONS.STALE_REVISION);
  if (state.task.status !== "open") return decision(PREFLIGHT_DECISIONS.STALE_REPLAN, PREFLIGHT_REASONS.TASK_NOT_OPEN);
  if (!state.continuation.safe_to_resume) return decision(PREFLIGHT_DECISIONS.RECOVERY_REQUIRED, PREFLIGHT_REASONS.UNSAFE_TO_RESUME);
  if (state.constraints.approval.status === "pending" || state.constraints.approval.status === "rejected") return decision(PREFLIGHT_DECISIONS.HUMAN_REQUIRED, PREFLIGHT_REASONS.APPROVAL_BLOCKED);
  if (facts.human_block === "safety_block") return decision(PREFLIGHT_DECISIONS.HUMAN_REQUIRED, PREFLIGHT_REASONS.SAFETY_BLOCK);
  if (facts.human_block === "human_required") return decision(PREFLIGHT_DECISIONS.HUMAN_REQUIRED, PREFLIGHT_REASONS.HUMAN_BLOCK);
  if (facts.workspace.path !== state.workspace.path || facts.workspace.path !== recoveryPlan.workspace.path) return decision(PREFLIGHT_DECISIONS.RECOVERY_REQUIRED, PREFLIGHT_REASONS.WORKSPACE_PATH_MISMATCH);
  if (facts.workspace.git_sha !== state.workspace.git_sha || facts.workspace.git_sha !== recoveryPlan.workspace.git_sha) return decision(PREFLIGHT_DECISIONS.RECOVERY_REQUIRED, PREFLIGHT_REASONS.WORKSPACE_SHA_MISMATCH);
  if (state.workspace.branch !== null && (facts.workspace.branch !== state.workspace.branch || facts.workspace.branch !== recoveryPlan.workspace.branch)) return decision(PREFLIGHT_DECISIONS.RECOVERY_REQUIRED, PREFLIGHT_REASONS.WORKSPACE_BRANCH_MISMATCH);

  const gateId = recoveryPlan.next_action.gate_id;
  if (gateId !== null && state.gates.completed.includes(gateId)) return decision(PREFLIGHT_DECISIONS.ALREADY_COMPLETED, PREFLIGHT_REASONS.GATE_ALREADY_COMPLETED);
  if (gateId === null || !state.gates.open.includes(gateId)) return decision(PREFLIGHT_DECISIONS.STALE_REPLAN, PREFLIGHT_REASONS.GATE_NOT_OPEN);
  if (!same(recoveryPlan.gates.completed, state.gates.completed)) return decision(PREFLIGHT_DECISIONS.STALE_REPLAN, PREFLIGHT_REASONS.COMPLETED_GATES_DRIFT);
  if (!refsPresent(recoveryPlan.evidence_refs, state.evidence_refs) || !refsPresent(recoveryPlan.receipt_refs, state.receipt_refs) || !refsPresent(recoveryPlan.handoff_refs, state.handoff_refs)) return decision(PREFLIGHT_DECISIONS.RECOVERY_REQUIRED, PREFLIGHT_REASONS.REQUIRED_REFS_DRIFT);
  if (facts.effect.prior_claim_keys.includes(recoveryPlan.claim_key)) return decision(PREFLIGHT_DECISIONS.ALREADY_COMPLETED, PREFLIGHT_REASONS.DUPLICATE_CLAIM);
  if (facts.effect.kind === "unknown") return decision(PREFLIGHT_DECISIONS.RECOVERY_REQUIRED, PREFLIGHT_REASONS.EFFECT_KIND_UNKNOWN);
  if (facts.effect.status === "unknown") return decision(PREFLIGHT_DECISIONS.RECOVERY_REQUIRED, PREFLIGHT_REASONS.EFFECT_UNKNOWN);
  if (facts.effect.status === "applied" && facts.effect.kind === "mutating") return decision(PREFLIGHT_DECISIONS.ALREADY_COMPLETED, PREFLIGHT_REASONS.EFFECT_ALREADY_APPLIED);
  return decision(PREFLIGHT_DECISIONS.PASS, PREFLIGHT_REASONS.SAFE_TO_EXECUTE);
}
