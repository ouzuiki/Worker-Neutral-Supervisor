import { normalizeSemanticProgress } from "./reasoning-watchdog.mjs";

export const TASK_CHECKPOINT_VERSION = 1;

const TASK_STATUSES = new Set(["open", "blocked", "awaiting_approval", "completed", "cancelled"]);
const APPROVAL_STATUSES = new Set(["not_required", "pending", "approved", "rejected"]);
const NATIVE_STATUSES = new Set(["not_started", "running", "interrupted", "completed", "failed", "unknown"]);

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${label} must be a plain object`);
  return value;
}
function exactKeys(value, keys, label) {
  const expected = new Set(keys);
  for (const key of Object.keys(value)) if (!expected.has(key)) throw new TypeError(`${label} has an unknown key: ${key}`);
  for (const key of keys) if (!Object.hasOwn(value, key)) throw new TypeError(`${label}.${key} is required`);
}
function string(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) throw new TypeError(`${label} must be a non-empty, trimmed string${nullable ? " or null" : ""}`);
  return value;
}
function enumValue(value, allowed, label) {
  if (!allowed.has(value)) throw new TypeError(`${label} has an invalid value`);
  return value;
}
function strings(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  const result = value.map((item, index) => string(item, `${label}[${index}]`));
  if (new Set(result).size !== result.length) throw new TypeError(`${label} must not contain duplicates`);
  return result;
}
function reference(value, label) {
  const source = object(value, label);
  exactKeys(source, ["id", "kind", "locator", "digest"], label);
  return { id: string(source.id, `${label}.id`), kind: string(source.kind, `${label}.kind`), locator: string(source.locator, `${label}.locator`), digest: string(source.digest, `${label}.digest`, { nullable: true }) };
}
function references(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  const result = value.map((item, index) => reference(item, `${label}[${index}]`));
  if (new Set(result.map(({ id }) => id)).size !== result.length) throw new TypeError(`${label} ids must be unique`);
  return result;
}
function constraint(value, label) {
  const source = object(value, label);
  exactKeys(source, ["id", "status", "source_ref"], label);
  return { id: string(source.id, `${label}.id`), status: enumValue(source.status, new Set(["active", "satisfied", "waived"]), `${label}.status`), source_ref: string(source.source_ref, `${label}.source_ref`) };
}

export function validateTaskCheckpoint(checkpoint) {
  const source = object(checkpoint, "checkpoint");
  exactKeys(source, ["checkpoint_version", "revision", "task", "gates", "workspace", "constraints", "evidence_refs", "receipt_refs", "handoff_refs", "semantic_progress", "last_execution", "continuation"], "checkpoint");
  if (source.checkpoint_version !== TASK_CHECKPOINT_VERSION) throw new TypeError("checkpoint.checkpoint_version is unsupported");
  if (!Number.isSafeInteger(source.revision) || source.revision < 0) throw new TypeError("checkpoint.revision must be a non-negative safe integer");
  const task = object(source.task, "checkpoint.task");
  exactKeys(task, ["id", "project", "goal", "phase", "status"], "checkpoint.task");
  const gates = object(source.gates, "checkpoint.gates");
  exactKeys(gates, ["completed", "open"], "checkpoint.gates");
  const completed = strings(gates.completed, "checkpoint.gates.completed");
  const open = strings(gates.open, "checkpoint.gates.open");
  if (completed.some((gate) => open.includes(gate))) throw new TypeError("completed and open gates must be disjoint");
  const workspace = object(source.workspace, "checkpoint.workspace");
  exactKeys(workspace, ["path", "git_sha", "branch"], "checkpoint.workspace");
  const constraints = object(source.constraints, "checkpoint.constraints");
  exactKeys(constraints, ["items", "approval"], "checkpoint.constraints");
  if (!Array.isArray(constraints.items)) throw new TypeError("checkpoint.constraints.items must be an array");
  const items = constraints.items.map((item, index) => constraint(item, `checkpoint.constraints.items[${index}]`));
  if (new Set(items.map(({ id }) => id)).size !== items.length) throw new TypeError("constraint ids must be unique");
  const approval = object(constraints.approval, "checkpoint.constraints.approval");
  exactKeys(approval, ["status", "request_refs"], "checkpoint.constraints.approval");
  const execution = object(source.last_execution, "checkpoint.last_execution");
  exactKeys(execution, ["worker_id", "native_session_id", "native_status"], "checkpoint.last_execution");
  const semanticProgress = object(source.semantic_progress, "checkpoint.semantic_progress");
  exactKeys(semanticProgress, ["semantic_state", "last_productive_at", "last_productive_cursor", "thinking_tokens_since_productive"], "checkpoint.semantic_progress");
  const continuation = object(source.continuation, "checkpoint.continuation");
  exactKeys(continuation, ["next_action", "resume_cursor", "retry_count", "safe_to_resume"], "checkpoint.continuation");
  const nextAction = object(continuation.next_action, "checkpoint.continuation.next_action");
  exactKeys(nextAction, ["kind", "gate_id", "input_ref"], "checkpoint.continuation.next_action");
  if (!Number.isSafeInteger(continuation.retry_count) || continuation.retry_count < 0) throw new TypeError("checkpoint.continuation.retry_count must be a non-negative safe integer");
  if (typeof continuation.safe_to_resume !== "boolean") throw new TypeError("checkpoint.continuation.safe_to_resume must be a boolean");
  return {
    checkpoint_version: TASK_CHECKPOINT_VERSION, revision: source.revision,
    task: { id: string(task.id, "checkpoint.task.id"), project: string(task.project, "checkpoint.task.project"), goal: string(task.goal, "checkpoint.task.goal"), phase: string(task.phase, "checkpoint.task.phase"), status: enumValue(task.status, TASK_STATUSES, "checkpoint.task.status") },
    gates: { completed, open },
    workspace: { path: string(workspace.path, "checkpoint.workspace.path"), git_sha: string(workspace.git_sha, "checkpoint.workspace.git_sha", { nullable: true }), branch: string(workspace.branch, "checkpoint.workspace.branch", { nullable: true }) },
    constraints: { items, approval: { status: enumValue(approval.status, APPROVAL_STATUSES, "checkpoint.constraints.approval.status"), request_refs: strings(approval.request_refs, "checkpoint.constraints.approval.request_refs") } },
    evidence_refs: references(source.evidence_refs, "checkpoint.evidence_refs"), receipt_refs: references(source.receipt_refs, "checkpoint.receipt_refs"), handoff_refs: references(source.handoff_refs, "checkpoint.handoff_refs"),
    semantic_progress: normalizeSemanticProgress(semanticProgress),
    last_execution: { worker_id: string(execution.worker_id, "checkpoint.last_execution.worker_id", { nullable: true }), native_session_id: string(execution.native_session_id, "checkpoint.last_execution.native_session_id", { nullable: true }), native_status: enumValue(execution.native_status, NATIVE_STATUSES, "checkpoint.last_execution.native_status") },
    continuation: { next_action: { kind: string(nextAction.kind, "checkpoint.continuation.next_action.kind"), gate_id: string(nextAction.gate_id, "checkpoint.continuation.next_action.gate_id", { nullable: true }), input_ref: string(nextAction.input_ref, "checkpoint.continuation.next_action.input_ref", { nullable: true }) }, resume_cursor: string(continuation.resume_cursor, "checkpoint.continuation.resume_cursor"), retry_count: continuation.retry_count, safe_to_resume: continuation.safe_to_resume },
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}
export function serializeTaskCheckpoint(checkpoint) { return `${JSON.stringify(canonicalize(validateTaskCheckpoint(checkpoint)))}\n`; }
export function restoreTaskCheckpoint(serialized) {
  if (typeof serialized !== "string") throw new TypeError("serialized checkpoint must be a string");
  let parsed;
  try { parsed = JSON.parse(serialized); } catch { throw new TypeError("serialized checkpoint must be valid JSON"); }
  const normalized = validateTaskCheckpoint(parsed);
  if (serialized !== serializeTaskCheckpoint(normalized)) throw new TypeError("serialized checkpoint must use canonical serialization");
  return normalized;
}
export function updateTaskCheckpoint(previous, changes) {
  const current = validateTaskCheckpoint(previous);
  const patch = object(changes, "changes");
  const allowed = new Set(["task", "gates", "workspace", "constraints", "evidence_refs", "receipt_refs", "handoff_refs", "semantic_progress", "last_execution", "continuation"]);
  for (const key of Object.keys(patch)) if (!allowed.has(key)) throw new TypeError(`changes has an unknown key: ${key}`);
  return validateTaskCheckpoint({ ...current, ...patch, checkpoint_version: TASK_CHECKPOINT_VERSION, revision: current.revision + 1 });
}
