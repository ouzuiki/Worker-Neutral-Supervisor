import {
  validatePlanAmendmentProposal,
  validatePlanAmendmentReview,
  validatePlanAmendmentHistoryRecord,
} from "./plan-amendment.mjs";

export const AUTHORITATIVE_PLAN_VERSION = 1;

const PLAN_KEYS = Object.freeze([
  "plan_id", "plan_revision", "gates", "dependencies",
  "authorized_gates", "completed_gates", "blocked_gates", "amendment_history",
]);

const DEPENDENCY_KEYS = Object.freeze(["gate_id", "requires"]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function assertExactKeys(value, requiredKeys, name) {
  if (!isPlainObject(value)) throw new TypeError(`${name} must be a plain object`);
  const seen = new Set(Object.keys(value));
  for (const key of Object.keys(value)) {
    if (!requiredKeys.includes(key)) throw new TypeError(`${name} has an unknown key: ${key}`);
  }
  for (const key of requiredKeys) {
    if (!seen.has(key)) throw new TypeError(`${name} is missing required key: ${key}`);
  }
}

function requireTrimmedString(value, name) {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value || value.trim().length === 0) {
    throw new TypeError(`${name} must be a trimmed, non-empty string`);
  }
  return value;
}

function requirePositiveSafeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be a positive safe integer`);
  return value;
}

function requireUniqueTrimmedStringArray(value, name, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new TypeError(`${name} must be ${allowEmpty ? "an" : "a non-empty"} array`);
  }
  const items = value.map((item, index) => requireTrimmedString(item, `${name}[${index}]`));
  if (new Set(items).size !== items.length) throw new TypeError(`${name} must not contain duplicate entries`);
  return items;
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function normalizeDependency(dependency, index, gateIdSet) {
  const name = `dependencies[${index}]`;
  assertExactKeys(dependency, DEPENDENCY_KEYS, name);
  const gateId = requireTrimmedString(dependency.gate_id, `${name}.gate_id`);
  if (!gateIdSet.has(gateId)) throw new TypeError(`${name}.gate_id references unknown gate: ${gateId}`);
  const requires = requireUniqueTrimmedStringArray(dependency.requires, `${name}.requires`);
  for (const requiredGateId of requires) {
    if (!gateIdSet.has(requiredGateId)) {
      throw new TypeError(`${name}.requires references unknown gate: ${requiredGateId}`);
    }
    if (requiredGateId === gateId) {
      throw new TypeError(`${name} declares a self dependency on gate: ${gateId}`);
    }
  }
  return { gate_id: gateId, requires };
}

function detectCycle(dependencies) {
  const requiresByGate = new Map(dependencies.map((dependency) => [dependency.gate_id, dependency.requires]));
  const state = new Map();

  function visit(gateId, path) {
    const status = state.get(gateId);
    if (status === "done") return;
    if (status === "visiting") {
      const cycleStart = path.indexOf(gateId);
      throw new TypeError(`dependencies contain a cycle: ${[...path.slice(cycleStart), gateId].join(" -> ")}`);
    }
    state.set(gateId, "visiting");
    for (const requiredGateId of requiresByGate.get(gateId) ?? []) {
      visit(requiredGateId, [...path, gateId]);
    }
    state.set(gateId, "done");
  }

  for (const gateId of requiresByGate.keys()) visit(gateId, []);
}

function normalizeAmendmentRecord(record, index) {
  try {
    return validatePlanAmendmentHistoryRecord(record);
  } catch (error) {
    throw new TypeError(`amendment_history[${index}]: ${error.message}`);
  }
}

function shallowEqual(a, b) {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => a[key] === b[key]);
}

function normalizePlan(plan) {
  assertExactKeys(plan, PLAN_KEYS, "plan");

  const planId = requireTrimmedString(plan.plan_id, "plan.plan_id");
  const planRevision = requirePositiveSafeInteger(plan.plan_revision, "plan.plan_revision");
  const gates = requireUniqueTrimmedStringArray(plan.gates, "plan.gates");
  const gateIdSet = new Set(gates);

  if (!Array.isArray(plan.dependencies)) throw new TypeError("plan.dependencies must be an array");
  const dependencies = plan.dependencies.map((dependency, index) => normalizeDependency(dependency, index, gateIdSet));
  const dependencyGateIds = dependencies.map((dependency) => dependency.gate_id);
  if (new Set(dependencyGateIds).size !== dependencyGateIds.length) {
    throw new TypeError("plan.dependencies must not declare more than one entry for the same gate_id");
  }
  detectCycle(dependencies);

  const authorizedGates = requireUniqueTrimmedStringArray(plan.authorized_gates, "plan.authorized_gates", { allowEmpty: true });
  const completedGates = requireUniqueTrimmedStringArray(plan.completed_gates, "plan.completed_gates", { allowEmpty: true });
  const blockedGates = requireUniqueTrimmedStringArray(plan.blocked_gates, "plan.blocked_gates", { allowEmpty: true });
  for (const [listName, list] of [
    ["plan.authorized_gates", authorizedGates],
    ["plan.completed_gates", completedGates],
    ["plan.blocked_gates", blockedGates],
  ]) {
    for (const gateId of list) {
      if (!gateIdSet.has(gateId)) throw new TypeError(`${listName} references unknown gate: ${gateId}`);
    }
  }

  if (!Array.isArray(plan.amendment_history)) throw new TypeError("plan.amendment_history must be an array");
  const amendmentHistory = plan.amendment_history.map((record, index) => normalizeAmendmentRecord(record, index));

  return {
    plan_id: planId,
    plan_revision: planRevision,
    gates,
    dependencies,
    authorized_gates: authorizedGates,
    completed_gates: completedGates,
    blocked_gates: blockedGates,
    amendment_history: amendmentHistory,
  };
}

/**
 * Validate a candidate AuthoritativePlan against the exact WNS schema:
 * strict key set, trimmed unique gate IDs, dependency graph integrity
 * (no unknown refs, no self dependency, no cycles). Returns a deep-frozen,
 * copy-safe plan. Throws on any structural violation. Never mutates input.
 *
 * This validates graph integrity only; it is not a scheduler or optimizer.
 */
export function validateAuthoritativePlan(plan) {
  const normalized = normalizePlan(plan);
  return deepFreeze(structuredClone(normalized));
}

/**
 * Construct and validate a new AuthoritativePlan from a plain descriptor.
 * Convenience wrapper around validateAuthoritativePlan with defaults for
 * the bookkeeping lists on a freshly created plan (plan_revision 1, empty
 * authorized/completed/blocked/amendment_history unless supplied).
 */
export function createAuthoritativePlan({
  plan_id,
  plan_revision = 1,
  gates,
  dependencies = [],
  authorized_gates = [],
  completed_gates = [],
  blocked_gates = [],
  amendment_history = [],
} = {}) {
  return validateAuthoritativePlan({
    plan_id,
    plan_revision,
    gates,
    dependencies,
    authorized_gates,
    completed_gates,
    blocked_gates,
    amendment_history,
  });
}

/**
 * Apply a Supervisor-reviewed plan amendment. Narrow, provenance-checking
 * gate only: it does not derive next_plan from proposal.proposal_type — the
 * Supervisor supplies next_plan, and this function only enforces that the
 * proposal targets the current plan/revision, that a reject leaves the plan
 * untouched, and that an accept/modify appends exactly one matching history
 * record while incrementing plan_revision by exactly one. Returns a
 * deep-frozen validated plan (either the unchanged current plan, on reject,
 * or the validated next plan).
 */
export function applySupervisorPlanAmendment(plan, proposal, review, next_plan) {
  const currentPlan = validateAuthoritativePlan(plan);
  const validatedProposal = validatePlanAmendmentProposal(proposal);
  const validatedReview = validatePlanAmendmentReview(review);

  if (validatedProposal.plan_id !== currentPlan.plan_id) {
    throw new TypeError("proposal.plan_id does not match current plan.plan_id");
  }
  if (validatedProposal.observed_plan_revision !== currentPlan.plan_revision) {
    throw new TypeError("proposal.observed_plan_revision is stale relative to current plan.plan_revision");
  }

  if (validatedReview.decision === "reject") {
    return currentPlan;
  }

  if (!isPlainObject(next_plan)) {
    throw new TypeError("next_plan must be a plain object");
  }

  const expectedFinalRecord = validatePlanAmendmentHistoryRecord({
    proposal_id: validatedProposal.proposal_id,
    observed_plan_revision: currentPlan.plan_revision,
    applied_plan_revision: currentPlan.plan_revision + 1,
    decision: validatedReview.decision,
    reason: validatedReview.reason,
  });

  const candidatePlan = validateAuthoritativePlan(next_plan);

  if (candidatePlan.plan_id !== currentPlan.plan_id) {
    throw new TypeError("next_plan.plan_id must equal current plan.plan_id");
  }
  if (candidatePlan.plan_revision !== currentPlan.plan_revision + 1) {
    throw new TypeError("next_plan.plan_revision must equal current plan.plan_revision + 1");
  }

  const expectedHistoryLength = currentPlan.amendment_history.length + 1;
  if (candidatePlan.amendment_history.length !== expectedHistoryLength) {
    throw new TypeError("next_plan.amendment_history must equal current amendment_history plus exactly one appended record");
  }
  for (let index = 0; index < currentPlan.amendment_history.length; index += 1) {
    if (!shallowEqual(candidatePlan.amendment_history[index], currentPlan.amendment_history[index])) {
      throw new TypeError(`next_plan.amendment_history[${index}] must match current plan.amendment_history[${index}]`);
    }
  }
  const finalRecord = candidatePlan.amendment_history[expectedHistoryLength - 1];
  if (!shallowEqual(finalRecord, expectedFinalRecord)) {
    throw new TypeError("next_plan.amendment_history final record does not match the expected applied amendment record");
  }

  return candidatePlan;
}

/**
 * Progressive disclosure for Workers: given an authoritative plan and a
 * single gate_id the Worker is authorized to execute, return only the
 * minimal context needed for that gate. This is deliberately NOT dependency
 * traversal or scheduling — blocked_downstream is the plan's blocked_gates
 * list minus the authorized gate, in plan order, nothing more. Never
 * exposes plan_id, gates, dependencies, amendment_history, or the full
 * graph.
 */
export function createWorkerPlanContext(plan, authorized_gate_id) {
  const validatedPlan = validateAuthoritativePlan(plan);
  const gateId = requireTrimmedString(authorized_gate_id, "authorized_gate_id");

  if (!validatedPlan.gates.includes(gateId) || !validatedPlan.authorized_gates.includes(gateId)) {
    throw new TypeError(`authorized_gate_id must be an authorized gate present in the plan: ${gateId}`);
  }

  const blockedDownstream = validatedPlan.blocked_gates.filter((existingGateId) => existingGateId !== gateId);

  return deepFreeze({
    current_authorized_gate: gateId,
    plan_revision: validatedPlan.plan_revision,
    blocked_downstream: blockedDownstream,
    amendment_instruction: "If execution evidence reveals a missing dependency, submit PROPOSE_PLAN_AMENDMENT. Do not silently change the plan.",
  });
}
