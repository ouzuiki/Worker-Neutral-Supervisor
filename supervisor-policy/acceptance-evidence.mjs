export const ACCEPTANCE_EVIDENCE_VERSION = 1;

export const IDENTITY_VALID = "IDENTITY_VALID";
export const PLAN_ID_MISMATCH = "PLAN_ID_MISMATCH";
export const STALE_PLAN_REVISION = "STALE_PLAN_REVISION";
export const GATE_ID_MISMATCH = "GATE_ID_MISMATCH";
export const STALE_ACCEPTANCE_SPEC_REVISION = "STALE_ACCEPTANCE_SPEC_REVISION";

export const EVIDENCE_COMPLETE = "EVIDENCE_COMPLETE";
export const EVIDENCE_INCOMPLETE = "EVIDENCE_INCOMPLETE";
export const UNKNOWN_CRITERION = "UNKNOWN_CRITERION";

export const ACCEPTED = "ACCEPTED";
export const REJECTED = "REJECTED";
export const DECISION_BLOCKED_STALE_CONTEXT = "DECISION_BLOCKED_STALE_CONTEXT";
export const DECISION_BLOCKED_IDENTITY_MISMATCH = "DECISION_BLOCKED_IDENTITY_MISMATCH";
export const ACCEPT_BLOCKED_INCOMPLETE_EVIDENCE = "ACCEPT_BLOCKED_INCOMPLETE_EVIDENCE";

export const WORKER_CLAIMS = Object.freeze(["READY", "READY_FOR_REVIEW"]);
export const SUPERVISOR_DECISIONS = Object.freeze(["accept", "reject"]);

const GATE_ACCEPTANCE_SPEC_KEYS = Object.freeze([
  "plan_id", "plan_revision", "gate_id", "acceptance_spec_revision", "criteria",
]);

const CRITERION_KEYS = Object.freeze(["criterion_id", "description"]);

const WORKER_EVIDENCE_SUBMISSION_KEYS = Object.freeze([
  "plan_id", "plan_revision", "gate_id", "acceptance_spec_revision", "worker_claim", "evidence",
]);

const EVIDENCE_ITEM_KEYS = Object.freeze(["criterion_id", "evidence_ref"]);

const SUPERVISOR_ACCEPTANCE_DECISION_KEYS = Object.freeze([
  "plan_id", "plan_revision", "gate_id", "acceptance_spec_revision", "decision", "reason",
]);

const CURRENT_ACCEPTANCE_IDENTITY_KEYS = Object.freeze([
  "plan_id", "plan_revision", "gate_id", "acceptance_spec_revision",
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

function requirePositiveSafeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be a positive safe integer`);
  return value;
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

function normalizeCriterion(criterion, index, namePrefix) {
  const name = `${namePrefix}[${index}]`;
  assertExactKeys(criterion, CRITERION_KEYS, name);
  return {
    criterion_id: requireTrimmedString(criterion.criterion_id, `${name}.criterion_id`),
    description: requireTrimmedString(criterion.description, `${name}.description`),
  };
}

function normalizeEvidenceItem(item, index) {
  const name = `submission.evidence[${index}]`;
  assertExactKeys(item, EVIDENCE_ITEM_KEYS, name);
  return {
    criterion_id: requireTrimmedString(item.criterion_id, `${name}.criterion_id`),
    evidence_ref: requireTrimmedString(item.evidence_ref, `${name}.evidence_ref`),
  };
}

function normalizeGateAcceptanceSpec(spec) {
  assertExactKeys(spec, GATE_ACCEPTANCE_SPEC_KEYS, "spec");

  const planId = requireTrimmedString(spec.plan_id, "spec.plan_id");
  const planRevision = requirePositiveSafeInteger(spec.plan_revision, "spec.plan_revision");
  const gateId = requireTrimmedString(spec.gate_id, "spec.gate_id");
  const acceptanceSpecRevision = requirePositiveSafeInteger(
    spec.acceptance_spec_revision,
    "spec.acceptance_spec_revision",
  );

  if (!Array.isArray(spec.criteria) || spec.criteria.length === 0) {
    throw new TypeError("spec.criteria must be a non-empty array");
  }
  const criteria = spec.criteria.map((criterion, index) => normalizeCriterion(criterion, index, "spec.criteria"));
  const criterionIds = criteria.map((criterion) => criterion.criterion_id);
  if (new Set(criterionIds).size !== criterionIds.length) {
    throw new TypeError("spec.criteria must not contain duplicate criterion_id");
  }

  return {
    plan_id: planId,
    plan_revision: planRevision,
    gate_id: gateId,
    acceptance_spec_revision: acceptanceSpecRevision,
    criteria,
  };
}

function normalizeWorkerEvidenceSubmission(submission) {
  assertExactKeys(submission, WORKER_EVIDENCE_SUBMISSION_KEYS, "submission");

  const planId = requireTrimmedString(submission.plan_id, "submission.plan_id");
  const planRevision = requirePositiveSafeInteger(submission.plan_revision, "submission.plan_revision");
  const gateId = requireTrimmedString(submission.gate_id, "submission.gate_id");
  const acceptanceSpecRevision = requirePositiveSafeInteger(
    submission.acceptance_spec_revision,
    "submission.acceptance_spec_revision",
  );
  const workerClaim = requireEnum(submission.worker_claim, WORKER_CLAIMS, "submission.worker_claim");

  if (!Array.isArray(submission.evidence)) throw new TypeError("submission.evidence must be an array");
  const evidence = submission.evidence.map((item, index) => normalizeEvidenceItem(item, index));

  return {
    plan_id: planId,
    plan_revision: planRevision,
    gate_id: gateId,
    acceptance_spec_revision: acceptanceSpecRevision,
    worker_claim: workerClaim,
    evidence,
  };
}

function normalizeSupervisorAcceptanceDecision(decision) {
  assertExactKeys(decision, SUPERVISOR_ACCEPTANCE_DECISION_KEYS, "decision");

  return {
    plan_id: requireTrimmedString(decision.plan_id, "decision.plan_id"),
    plan_revision: requirePositiveSafeInteger(decision.plan_revision, "decision.plan_revision"),
    gate_id: requireTrimmedString(decision.gate_id, "decision.gate_id"),
    acceptance_spec_revision: requirePositiveSafeInteger(
      decision.acceptance_spec_revision,
      "decision.acceptance_spec_revision",
    ),
    decision: requireEnum(decision.decision, SUPERVISOR_DECISIONS, "decision.decision"),
    reason: requireTrimmedString(decision.reason, "decision.reason"),
  };
}

function normalizeCurrentAcceptanceIdentity(identity) {
  assertExactKeys(identity, CURRENT_ACCEPTANCE_IDENTITY_KEYS, "current_acceptance_identity");

  return {
    plan_id: requireTrimmedString(identity.plan_id, "current_acceptance_identity.plan_id"),
    plan_revision: requirePositiveSafeInteger(
      identity.plan_revision,
      "current_acceptance_identity.plan_revision",
    ),
    gate_id: requireTrimmedString(identity.gate_id, "current_acceptance_identity.gate_id"),
    acceptance_spec_revision: requirePositiveSafeInteger(
      identity.acceptance_spec_revision,
      "current_acceptance_identity.acceptance_spec_revision",
    ),
  };
}

/**
 * Compare two acceptance identities on the fixed precedence
 * plan_id -> plan_revision -> gate_id -> acceptance_spec_revision.
 * Returns IDENTITY_VALID only when all four fields match. This is the
 * single place where the acceptance_spec_revision freshness anchor is
 * enforced; callers must not collapse it into plan_revision.
 */
function compareIdentity(left, right) {
  if (left.plan_id !== right.plan_id) return PLAN_ID_MISMATCH;
  if (left.plan_revision !== right.plan_revision) return STALE_PLAN_REVISION;
  if (left.gate_id !== right.gate_id) return GATE_ID_MISMATCH;
  if (left.acceptance_spec_revision !== right.acceptance_spec_revision) return STALE_ACCEPTANCE_SPEC_REVISION;
  return IDENTITY_VALID;
}

function evaluationResult(readyForSupervisorReview, reasonCode, coveredCriteria, missingCriteria) {
  return deepFreeze({
    status: readyForSupervisorReview ? EVIDENCE_COMPLETE : EVIDENCE_INCOMPLETE,
    ready_for_supervisor_review: readyForSupervisorReview,
    accepted: false,
    reason_code: reasonCode,
    covered_criteria: coveredCriteria,
    missing_criteria: missingCriteria,
  });
}

function decisionResult(accepted, status, reasonCode) {
  return deepFreeze({ accepted, status, reason_code: reasonCode });
}

/**
 * Validate a candidate GateAcceptanceSpec against the exact WNS schema:
 * strict 5-key set, trimmed non-empty strings, positive safe integer
 * plan/acceptance_spec revisions, non-empty criteria with strict
 * {criterion_id, description} items and unique criterion_id. Returns a
 * deep-frozen, copy-safe spec. Throws on any structural violation. Never
 * mutates input.
 */
export function validateGateAcceptanceSpec(spec) {
  const normalized = normalizeGateAcceptanceSpec(spec);
  return deepFreeze(structuredClone(normalized));
}

/**
 * Validate a candidate WorkerEvidenceSubmission against the exact WNS
 * schema: strict 6-key set, trimmed non-empty strings, positive safe
 * integer revisions, worker_claim enum READY | READY_FOR_REVIEW, and a
 * (possibly empty) evidence array of strict {criterion_id, evidence_ref}
 * items. Returns a deep-frozen, copy-safe submission. Throws on any
 * structural violation. Never mutates input.
 */
export function validateWorkerEvidenceSubmission(submission) {
  const normalized = normalizeWorkerEvidenceSubmission(submission);
  return deepFreeze(structuredClone(normalized));
}

/**
 * Validate a candidate SupervisorAcceptanceDecision against the exact WNS
 * schema: strict 6-key set, trimmed non-empty strings, positive safe
 * integer revisions, and a decision enum accept | reject. Returns a
 * deep-frozen, copy-safe decision. Throws on any structural violation.
 * Never mutates input.
 */
export function validateSupervisorAcceptanceDecision(decision) {
  const normalized = normalizeSupervisorAcceptanceDecision(decision);
  return deepFreeze(structuredClone(normalized));
}

/**
 * Validate the authoritative external freshness anchor, the
 * CurrentAcceptanceIdentity: exact 4-key set, trimmed non-empty strings,
 * positive safe integer plan/acceptance_spec revisions. This external
 * anchor is what makes acceptance_spec_revision freshness enforceable even
 * when plan_revision is unchanged. Returns a deep-frozen, copy-safe
 * identity. Throws on any structural violation. Never mutates input.
 */
export function validateCurrentAcceptanceIdentity(identity) {
  const normalized = normalizeCurrentAcceptanceIdentity(identity);
  return deepFreeze(structuredClone(normalized));
}

/**
 * Evaluate a Worker evidence submission against a GateAcceptanceSpec and
 * the authoritative CurrentAcceptanceIdentity. Structural validation runs
 * first (fail closed on malformed input). The spec is bound to the current
 * identity on the full 4-field identity (including
 * acceptance_spec_revision); then the submission is bound to the spec on
 * the same 4 fields. Any evidence item referencing a criterion_id absent
 * from the spec fails closed with UNKNOWN_CRITERION. Missing spec criteria
 * yield EVIDENCE_INCOMPLETE. Full coverage yields EVIDENCE_COMPLETE and
 * ready_for_supervisor_review=true, with status EVIDENCE_COMPLETE only on
 * that full-coverage path; every blocked path reports status
 * EVIDENCE_INCOMPLETE with the precise reason_code. `accepted` is false on
 * every path: READY / READY_FOR_REVIEW is only a worker claim and can
 * never close a gate. Returns a deep-frozen deterministic result with
 * covered_criteria/missing_criteria in spec order.
 */
export function evaluateWorkerEvidenceSubmission(spec, submission, currentAcceptanceIdentity) {
  const validatedSpec = normalizeGateAcceptanceSpec(spec);
  const validatedSubmission = normalizeWorkerEvidenceSubmission(submission);
  const validatedCurrent = normalizeCurrentAcceptanceIdentity(currentAcceptanceIdentity);

  const specVersusCurrent = compareIdentity(validatedSpec, validatedCurrent);
  if (specVersusCurrent !== IDENTITY_VALID) {
    return evaluationResult(false, specVersusCurrent, [], []);
  }

  const submissionVersusSpec = compareIdentity(validatedSubmission, validatedSpec);
  if (submissionVersusSpec !== IDENTITY_VALID) {
    return evaluationResult(false, submissionVersusSpec, [], []);
  }

  const specCriterionIds = validatedSpec.criteria.map((criterion) => criterion.criterion_id);
  const specCriterionIdSet = new Set(specCriterionIds);
  const evidencedCriterionIdSet = new Set(
    validatedSubmission.evidence.map((item) => item.criterion_id),
  );
  const hasUnknownCriterion = validatedSubmission.evidence.some(
    (item) => !specCriterionIdSet.has(item.criterion_id),
  );

  const coveredCriteria = specCriterionIds.filter((criterionId) => evidencedCriterionIdSet.has(criterionId));
  const missingCriteria = specCriterionIds.filter((criterionId) => !evidencedCriterionIdSet.has(criterionId));

  if (hasUnknownCriterion) {
    return evaluationResult(false, UNKNOWN_CRITERION, coveredCriteria, missingCriteria);
  }
  if (missingCriteria.length > 0) {
    return evaluationResult(false, EVIDENCE_INCOMPLETE, coveredCriteria, missingCriteria);
  }
  return evaluationResult(true, EVIDENCE_COMPLETE, coveredCriteria, missingCriteria);
}

/**
 * Apply a Supervisor acceptance decision. Mechanical precedence only, no
 * workflow engine and no evidence interpretation beyond the evaluator.
 * P0: all four inputs (spec, submission, decision, current identity) are
 * structurally validated, including the submission even on the reject
 * path, so malformed input fails closed with a TypeError. P1: spec versus
 * current identity mismatch blocks with DECISION_BLOCKED_STALE_CONTEXT.
 * P2/P3: submission/decision versus spec mismatch blocks with
 * DECISION_BLOCKED_IDENTITY_MISMATCH. P4: a correctly bound reject is
 * always a valid REJECTED and requires no evidence coverage. P5: a
 * correctly bound accept requires ready_for_supervisor_review=true against
 * the same current identity; otherwise ACCEPT_BLOCKED_INCOMPLETE_EVIDENCE
 * propagates the evaluator reason code. accepted=true is returned only on
 * the P5 complete-evidence path.
 */
export function applySupervisorAcceptanceDecision(spec, submission, decision, currentAcceptanceIdentity) {
  const validatedSpec = normalizeGateAcceptanceSpec(spec);
  const validatedSubmission = normalizeWorkerEvidenceSubmission(submission);
  const validatedDecision = normalizeSupervisorAcceptanceDecision(decision);
  const validatedCurrent = normalizeCurrentAcceptanceIdentity(currentAcceptanceIdentity);

  const specVersusCurrent = compareIdentity(validatedSpec, validatedCurrent);
  if (specVersusCurrent !== IDENTITY_VALID) {
    return decisionResult(false, DECISION_BLOCKED_STALE_CONTEXT, specVersusCurrent);
  }

  const submissionVersusSpec = compareIdentity(validatedSubmission, validatedSpec);
  if (submissionVersusSpec !== IDENTITY_VALID) {
    return decisionResult(false, DECISION_BLOCKED_IDENTITY_MISMATCH, submissionVersusSpec);
  }

  const decisionVersusSpec = compareIdentity(validatedDecision, validatedSpec);
  if (decisionVersusSpec !== IDENTITY_VALID) {
    return decisionResult(false, DECISION_BLOCKED_IDENTITY_MISMATCH, decisionVersusSpec);
  }

  if (validatedDecision.decision === "reject") {
    return decisionResult(false, REJECTED, REJECTED);
  }

  const evaluation = evaluateWorkerEvidenceSubmission(validatedSpec, validatedSubmission, validatedCurrent);
  if (evaluation.ready_for_supervisor_review === true) {
    return decisionResult(true, ACCEPTED, ACCEPTED);
  }
  return decisionResult(false, ACCEPT_BLOCKED_INCOMPLETE_EVIDENCE, evaluation.reason_code);
}
