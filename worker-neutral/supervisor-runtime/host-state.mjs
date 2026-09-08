import { createHash } from "node:crypto";
import { validateTaskCheckpoint } from "../../supervisor-policy/task-continuation.mjs";

export const HOST_STATE_VERSION = 1;
export const HOST_PHASES = Object.freeze(["observing", "action_pending", "awaiting_ack", "reconciling", "human_required", "terminal"]);

function plain(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${label} must be a plain object`);
  return value;
}
function text(value, label, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) throw new TypeError(`${label} must be a non-empty trimmed string${nullable ? " or null" : ""}`);
  return value;
}
function integer(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a non-negative safe integer`);
  return value;
}
function exact(value, keys, label) {
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new TypeError(`${label} has unknown key ${key}`);
  for (const key of keys) if (!Object.hasOwn(value, key)) throw new TypeError(`${label}.${key} is required`);
}
function frozen(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) frozen(child); }
  return value;
}

export function canonicalJson(value) { return `${JSON.stringify(value, Object.keys(value).sort())}\n`; }
export function digestHostPayload(payload) { return `sha256:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`; }

export function validateHostState(input) {
  const state = structuredClone(plain(input, "host_state"));
  exact(state, ["host_state_version", "sequence", "phase", "task_checkpoint", "active_action", "claims", "receipts", "last_observation", "escalation"], "host_state");
  if (state.host_state_version !== HOST_STATE_VERSION) throw new TypeError("host_state_version is unsupported");
  integer(state.sequence, "host_state.sequence");
  if (!HOST_PHASES.includes(state.phase)) throw new TypeError("host_state.phase is invalid");
  state.task_checkpoint = validateTaskCheckpoint(state.task_checkpoint);
  if (state.active_action !== null) plain(state.active_action, "host_state.active_action");
  if (!Array.isArray(state.claims) || new Set(state.claims.map((v, i) => text(v, `host_state.claims[${i}]`))).size !== state.claims.length) throw new TypeError("host_state.claims must be unique strings");
  if (!Array.isArray(state.receipts)) throw new TypeError("host_state.receipts must be an array");
  for (const [index, receipt] of state.receipts.entries()) {
    plain(receipt, `host_state.receipts[${index}]`);
    exact(receipt, ["sequence", "event", "claim_key", "worker_id", "native_session_id", "status", "evidence_ref"], `host_state.receipts[${index}]`);
    integer(receipt.sequence, `host_state.receipts[${index}].sequence`); text(receipt.event, `host_state.receipts[${index}].event`);
    for (const key of ["claim_key", "worker_id", "native_session_id", "evidence_ref"]) text(receipt[key], `host_state.receipts[${index}].${key}`, true);
    text(receipt.status, `host_state.receipts[${index}].status`);
  }
  if (state.last_observation !== null) plain(state.last_observation, "host_state.last_observation");
  if (state.escalation !== null) { plain(state.escalation, "host_state.escalation"); exact(state.escalation, ["reason_code", "evidence_ref"], "host_state.escalation"); text(state.escalation.reason_code, "host_state.escalation.reason_code"); text(state.escalation.evidence_ref, "host_state.escalation.evidence_ref", true); }
  if (state.task_checkpoint.task.status === "completed" || state.task_checkpoint.task.status === "cancelled") {
    if (state.phase !== "terminal") throw new TypeError("terminal task checkpoint requires terminal host phase");
  }
  return frozen(state);
}

export function createHostState(task_checkpoint) {
  const checkpoint = validateTaskCheckpoint(task_checkpoint);
  return validateHostState({ host_state_version: HOST_STATE_VERSION, sequence: 0, phase: checkpoint.task.status === "completed" || checkpoint.task.status === "cancelled" ? "terminal" : "observing", task_checkpoint: checkpoint, active_action: null, claims: [], receipts: [], last_observation: null, escalation: null });
}

export function transitionHostState(input, event) {
  const state = validateHostState(input); plain(event, "event"); text(event.type, "event.type");
  const next = structuredClone(state); next.sequence += 1;
  if (event.type === "observation_recorded") {
    if (state.phase === "terminal") throw new TypeError("terminal host cannot observe");
    next.last_observation = structuredClone(plain(event.observation, "event.observation"));
  } else if (event.type === "action_planned") {
    if (state.phase !== "observing") throw new TypeError("action can only be planned while observing");
    const action = structuredClone(plain(event.action, "event.action")); text(action.claim_key, "event.action.claim_key");
    if (state.claims.includes(action.claim_key)) throw new TypeError("duplicate host action claim");
    next.phase = "action_pending"; next.active_action = action;
  } else if (event.type === "action_started") {
    if (state.phase !== "action_pending" || state.active_action?.claim_key !== event.claim_key) throw new TypeError("action start does not match pending claim");
    next.phase = "awaiting_ack";
  } else if (event.type === "spawn_observed") {
    if (state.phase !== "awaiting_ack" || state.active_action?.claim_key !== event.claim_key) throw new TypeError("spawn evidence does not match active claim");
    const workerId = text(event.worker_id, "event.worker_id"); const sessionId = text(event.native_session_id, "event.native_session_id");
    next.active_action = { ...state.active_action, spawn_evidence: { acknowledgement: "accepted", worker_id: workerId, native_session_id: sessionId, response_ref: text(event.evidence_ref, "event.evidence_ref", true) } };
    next.receipts.push({ sequence: next.sequence, event: "spawn_observed", claim_key: event.claim_key, worker_id: workerId, native_session_id: sessionId, status: "accepted_pending_checkpoint", evidence_ref: text(event.evidence_ref, "event.evidence_ref", true) });
  } else if (event.type === "action_acknowledged") {
    if (state.phase !== "awaiting_ack" || state.active_action?.claim_key !== event.claim_key) throw new TypeError("action acknowledgement does not match active claim");
    next.task_checkpoint = validateTaskCheckpoint(event.task_checkpoint);
    next.claims.push(text(event.claim_key, "event.claim_key"));
    next.receipts.push({ sequence: next.sequence, event: "action_acknowledged", claim_key: event.claim_key, worker_id: text(event.worker_id, "event.worker_id"), native_session_id: text(event.native_session_id, "event.native_session_id"), status: "accepted", evidence_ref: text(event.evidence_ref, "event.evidence_ref", true) });
    next.active_action = null; next.phase = "observing";
  } else if (event.type === "reconciliation_required") {
    if (state.phase === "terminal") throw new TypeError("terminal host cannot reconcile");
    next.phase = "reconciling"; next.escalation = { reason_code: text(event.reason_code, "event.reason_code"), evidence_ref: text(event.evidence_ref, "event.evidence_ref", true) };
  } else if (event.type === "human_required") {
    next.phase = "human_required"; next.escalation = { reason_code: text(event.reason_code, "event.reason_code"), evidence_ref: text(event.evidence_ref, "event.evidence_ref", true) };
  } else if (event.type === "terminal") {
    next.task_checkpoint = validateTaskCheckpoint(event.task_checkpoint); next.phase = "terminal"; next.active_action = null;
  } else throw new TypeError(`unsupported host event: ${event.type}`);
  return validateHostState(next);
}
