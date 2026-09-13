export const PLAN_AMENDMENT_VERSION = 1;

export const PROPOSAL_TYPES = Object.freeze([
  "INSERT_PREREQUISITE",
  "REMOVE_PREREQUISITE",
  "REORDER",
  "SPLIT_GATE",
  "ADD_GATE",
  "HOLD_CURRENT_GATE",
]);

export const EXECUTION_RECOMMENDATIONS = Object.freeze([
  "CONTINUE_CURRENT_GATE",
  "HOLD_BEFORE_NEXT_EFFECT",
]);

export const REVIEW_DECISIONS = Object.freeze(["accept", "modify", "reject"]);

const PROPOSAL_KEYS = Object.freeze([
  "proposal_id", "plan_id", "observed_plan_revision", "proposed_by",
  "proposal_type", "affected_gates", "reason", "evidence_refs",
  "execution_recommendation",
]);

const PROPOSED_BY_KEYS = Object.freeze(["worker", "session_id"]);

const REVIEW_KEYS = Object.freeze(["decision", "reason"]);

const HISTORY_KEYS = Object.freeze([
  "proposal_id", "observed_plan_revision", "applied_plan_revision", "decision", "reason",
]);

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

function requireTrimmedStringOrNull(value, name) {
  if (value === null) return value;
  return requireTrimmedString(value, name);
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

function requireEnum(value, allowed, name) {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new TypeError(`${name} must be one of: ${allowed.join(", ")}`);
  }
  return value;
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function normalizeProposedBy(proposedBy) {
  const name = "proposal.proposed_by";
  assertExactKeys(proposedBy, PROPOSED_BY_KEYS, name);
  return {
    worker: requireTrimmedString(proposedBy.worker, `${name}.worker`),
    session_id: requireTrimmedString(proposedBy.session_id, `${name}.session_id`),
  };
}

function normalizeProposal(proposal) {
  assertExactKeys(proposal, PROPOSAL_KEYS, "proposal");

  const proposalId = requireTrimmedString(proposal.proposal_id, "proposal.proposal_id");
  const planId = requireTrimmedString(proposal.plan_id, "proposal.plan_id");
  const observedPlanRevision = requirePositiveSafeInteger(proposal.observed_plan_revision, "proposal.observed_plan_revision");
  const proposedBy = normalizeProposedBy(proposal.proposed_by);
  const proposalType = requireEnum(proposal.proposal_type, PROPOSAL_TYPES, "proposal.proposal_type");
  const affectedGates = requireUniqueTrimmedStringArray(proposal.affected_gates, "proposal.affected_gates");
  const reason = requireTrimmedString(proposal.reason, "proposal.reason");
  const evidenceRefs = requireUniqueTrimmedStringArray(proposal.evidence_refs, "proposal.evidence_refs", { allowEmpty: true });
  const executionRecommendation = requireEnum(
    proposal.execution_recommendation,
    EXECUTION_RECOMMENDATIONS,
    "proposal.execution_recommendation",
  );

  return {
    proposal_id: proposalId,
    plan_id: planId,
    observed_plan_revision: observedPlanRevision,
    proposed_by: proposedBy,
    proposal_type: proposalType,
    affected_gates: affectedGates,
    reason,
    evidence_refs: evidenceRefs,
    execution_recommendation: executionRecommendation,
  };
}

function normalizeReview(review) {
  assertExactKeys(review, REVIEW_KEYS, "review");
  const decision = requireEnum(review.decision, REVIEW_DECISIONS, "review.decision");
  const reason = requireTrimmedStringOrNull(review.reason, "review.reason");
  return { decision, reason };
}

function normalizeHistoryRecord(record) {
  assertExactKeys(record, HISTORY_KEYS, "history record");

  const proposalId = requireTrimmedString(record.proposal_id, "history record.proposal_id");
  const observedPlanRevision = requirePositiveSafeInteger(record.observed_plan_revision, "history record.observed_plan_revision");
  const decision = requireEnum(record.decision, REVIEW_DECISIONS, "history record.decision");

  let appliedPlanRevision;
  if (decision === "reject") {
    if (record.applied_plan_revision !== null) {
      throw new TypeError("history record.applied_plan_revision must be null when decision is reject");
    }
    appliedPlanRevision = null;
  } else {
    appliedPlanRevision = requirePositiveSafeInteger(record.applied_plan_revision, "history record.applied_plan_revision");
  }

  const reason = requireTrimmedStringOrNull(record.reason, "history record.reason");

  return {
    proposal_id: proposalId,
    observed_plan_revision: observedPlanRevision,
    applied_plan_revision: appliedPlanRevision,
    decision,
    reason,
  };
}

/**
 * Validate a candidate PlanAmendmentProposal against the exact WNS schema:
 * strict key set (including nested proposed_by), enum-checked proposal_type
 * and execution_recommendation, unique trimmed gate/evidence lists. Returns
 * a deep-frozen, copy-safe proposal. Throws on any structural violation.
 * Never mutates input, and never applies the proposal to any plan.
 */
export function validatePlanAmendmentProposal(proposal) {
  const normalized = normalizeProposal(proposal);
  return deepFreeze(structuredClone(normalized));
}

/**
 * Validate a minimal Supervisor review record for a proposal: an exact
 * {decision, reason} pair. Not a workflow engine — carries no linkage to
 * the plan or proposal beyond what the caller tracks separately. Returns
 * a deep-frozen, copy-safe review.
 */
export function validatePlanAmendmentReview(review) {
  const normalized = normalizeReview(review);
  return deepFreeze(structuredClone(normalized));
}

/**
 * Validate an immutable PlanAmendmentHistoryRecord: the exact fields
 * needed by authoritative-plan to later verify amendment_history entries.
 * applied_plan_revision must be a positive integer for accept/modify, and
 * must be null for reject. Returns a deep-frozen, copy-safe record.
 */
export function validatePlanAmendmentHistoryRecord(record) {
  const normalized = normalizeHistoryRecord(record);
  return deepFreeze(structuredClone(normalized));
}
