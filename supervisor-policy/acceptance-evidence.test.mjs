import assert from "node:assert/strict";
import test from "node:test";
import {
  validateGateAcceptanceSpec,
  validateWorkerEvidenceSubmission,
  validateSupervisorAcceptanceDecision,
  validateCurrentAcceptanceIdentity,
  evaluateWorkerEvidenceSubmission,
  applySupervisorAcceptanceDecision,
  WORKER_CLAIMS,
  SUPERVISOR_DECISIONS,
  IDENTITY_VALID,
  PLAN_ID_MISMATCH,
  STALE_PLAN_REVISION,
  GATE_ID_MISMATCH,
  STALE_ACCEPTANCE_SPEC_REVISION,
  EVIDENCE_COMPLETE,
  EVIDENCE_INCOMPLETE,
  UNKNOWN_CRITERION,
  ACCEPTED,
  REJECTED,
  DECISION_BLOCKED_STALE_CONTEXT,
  DECISION_BLOCKED_IDENTITY_MISMATCH,
  ACCEPT_BLOCKED_INCOMPLETE_EVIDENCE,
} from "./acceptance-evidence.mjs";

function spec(overrides = {}) {
  return {
    plan_id: "plan-1",
    plan_revision: 7,
    gate_id: "gate-a",
    acceptance_spec_revision: 3,
    criteria: [
      { criterion_id: "criterion-1", description: "first criterion" },
      { criterion_id: "criterion-2", description: "second criterion" },
      { criterion_id: "criterion-3", description: "third criterion" },
    ],
    ...overrides,
  };
}

function submission(overrides = {}) {
  return {
    plan_id: "plan-1",
    plan_revision: 7,
    gate_id: "gate-a",
    acceptance_spec_revision: 3,
    worker_claim: "READY",
    evidence: [
      { criterion_id: "criterion-1", evidence_ref: "evidence:1" },
      { criterion_id: "criterion-2", evidence_ref: "evidence:2" },
      { criterion_id: "criterion-3", evidence_ref: "evidence:3" },
    ],
    ...overrides,
  };
}

function decision(overrides = {}) {
  return {
    plan_id: "plan-1",
    plan_revision: 7,
    gate_id: "gate-a",
    acceptance_spec_revision: 3,
    decision: "accept",
    reason: "criteria satisfied",
    ...overrides,
  };
}

function current(overrides = {}) {
  return {
    plan_id: "plan-1",
    plan_revision: 7,
    gate_id: "gate-a",
    acceptance_spec_revision: 3,
    ...overrides,
  };
}

// --- exact constants and enum spelling ---

test("identity reason codes have exact literal values", () => {
  assert.equal(IDENTITY_VALID, "IDENTITY_VALID");
  assert.equal(PLAN_ID_MISMATCH, "PLAN_ID_MISMATCH");
  assert.equal(STALE_PLAN_REVISION, "STALE_PLAN_REVISION");
  assert.equal(GATE_ID_MISMATCH, "GATE_ID_MISMATCH");
  assert.equal(STALE_ACCEPTANCE_SPEC_REVISION, "STALE_ACCEPTANCE_SPEC_REVISION");
});

test("evidence reason codes have exact literal values", () => {
  assert.equal(EVIDENCE_COMPLETE, "EVIDENCE_COMPLETE");
  assert.equal(EVIDENCE_INCOMPLETE, "EVIDENCE_INCOMPLETE");
  assert.equal(UNKNOWN_CRITERION, "UNKNOWN_CRITERION");
});

test("final decision status codes have exact literal values", () => {
  assert.equal(ACCEPTED, "ACCEPTED");
  assert.equal(REJECTED, "REJECTED");
  assert.equal(DECISION_BLOCKED_STALE_CONTEXT, "DECISION_BLOCKED_STALE_CONTEXT");
  assert.equal(DECISION_BLOCKED_IDENTITY_MISMATCH, "DECISION_BLOCKED_IDENTITY_MISMATCH");
  assert.equal(ACCEPT_BLOCKED_INCOMPLETE_EVIDENCE, "ACCEPT_BLOCKED_INCOMPLETE_EVIDENCE");
});

test("worker claim and decision enums are exact and frozen", () => {
  assert.deepEqual(WORKER_CLAIMS, ["READY", "READY_FOR_REVIEW"]);
  assert.deepEqual(SUPERVISOR_DECISIONS, ["accept", "reject"]);
  assert.ok(Object.isFrozen(WORKER_CLAIMS));
  assert.ok(Object.isFrozen(SUPERVISOR_DECISIONS));
});

// --- gate acceptance spec validator ---

test("a well-formed gate acceptance spec validates and is deep-frozen", () => {
  const result = validateGateAcceptanceSpec(spec());
  assert.deepEqual(result, spec());
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.criteria));
  assert.ok(Object.isFrozen(result.criteria[0]));
});

test("validating a spec does not mutate or alias the input", () => {
  const input = spec();
  const before = structuredClone(input);
  const result = validateGateAcceptanceSpec(input);
  assert.deepEqual(input, before);
  input.criteria.push({ criterion_id: "criterion-4", description: "fourth criterion" });
  input.criteria[0].criterion_id = "mutated";
  input.plan_id = "mutated";
  assert.deepEqual(result.criteria.map((criterion) => criterion.criterion_id), [
    "criterion-1", "criterion-2", "criterion-3",
  ]);
  assert.equal(result.plan_id, "plan-1");
  assert.equal(result.criteria[0].criterion_id, "criterion-1");
});

test("spec rejects a non-object", () => {
  assert.throws(() => validateGateAcceptanceSpec("not-a-spec"), TypeError);
  assert.throws(() => validateGateAcceptanceSpec(null), TypeError);
  assert.throws(() => validateGateAcceptanceSpec([]), TypeError);
});

test("spec rejects a missing key", () => {
  const { gate_id, ...missing } = spec();
  assert.throws(() => validateGateAcceptanceSpec(missing), TypeError);
});

test("spec rejects an unknown key", () => {
  assert.throws(() => validateGateAcceptanceSpec(spec({ extra: "x" })), TypeError);
});

test("spec rejects an empty criteria array", () => {
  assert.throws(() => validateGateAcceptanceSpec(spec({ criteria: [] })), TypeError);
});

test("spec rejects a non-array criteria value", () => {
  assert.throws(() => validateGateAcceptanceSpec(spec({ criteria: "nope" })), TypeError);
});

test("spec rejects duplicate criterion_id", () => {
  assert.throws(
    () =>
      validateGateAcceptanceSpec(
        spec({
          criteria: [
            { criterion_id: "criterion-1", description: "first" },
            { criterion_id: "criterion-1", description: "duplicate" },
          ],
        }),
      ),
    TypeError,
  );
});

test("spec rejects a criterion with a missing or unknown key", () => {
  assert.throws(
    () => validateGateAcceptanceSpec(spec({ criteria: [{ criterion_id: "criterion-1" }] })),
    TypeError,
  );
  assert.throws(
    () =>
      validateGateAcceptanceSpec(
        spec({ criteria: [{ criterion_id: "criterion-1", description: "first", extra: "x" }] }),
      ),
    TypeError,
  );
  assert.throws(() => validateGateAcceptanceSpec(spec({ criteria: ["criterion-1"] })), TypeError);
});

test("spec rejects untrimmed or empty strings", () => {
  assert.throws(() => validateGateAcceptanceSpec(spec({ plan_id: "" })), TypeError);
  assert.throws(() => validateGateAcceptanceSpec(spec({ plan_id: "  plan-1  " })), TypeError);
  assert.throws(() => validateGateAcceptanceSpec(spec({ gate_id: "   " })), TypeError);
  assert.throws(
    () =>
      validateGateAcceptanceSpec(
        spec({ criteria: [{ criterion_id: "criterion-1", description: "" }] }),
      ),
    TypeError,
  );
  assert.throws(
    () =>
      validateGateAcceptanceSpec(
        spec({ criteria: [{ criterion_id: " criterion-1", description: "first" }] }),
      ),
    TypeError,
  );
});

test("spec rejects non-positive-safe-integer revisions", () => {
  assert.throws(() => validateGateAcceptanceSpec(spec({ plan_revision: 0 })), TypeError);
  assert.throws(() => validateGateAcceptanceSpec(spec({ plan_revision: -1 })), TypeError);
  assert.throws(() => validateGateAcceptanceSpec(spec({ plan_revision: 1.5 })), TypeError);
  assert.throws(() => validateGateAcceptanceSpec(spec({ plan_revision: "7" })), TypeError);
  assert.throws(() => validateGateAcceptanceSpec(spec({ acceptance_spec_revision: 0 })), TypeError);
  assert.throws(() => validateGateAcceptanceSpec(spec({ acceptance_spec_revision: "3" })), TypeError);
});

// --- worker evidence submission validator ---

test("a well-formed submission validates and is deep-frozen", () => {
  const result = validateWorkerEvidenceSubmission(submission());
  assert.deepEqual(result, submission());
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.evidence));
  assert.ok(Object.isFrozen(result.evidence[0]));
});

test("submission evidence may be empty", () => {
  const result = validateWorkerEvidenceSubmission(submission({ evidence: [] }));
  assert.deepEqual(result.evidence, []);
});

test("validating a submission does not mutate or alias the input", () => {
  const input = submission();
  const before = structuredClone(input);
  const result = validateWorkerEvidenceSubmission(input);
  assert.deepEqual(input, before);
  input.evidence.push({ criterion_id: "criterion-4", evidence_ref: "evidence:4" });
  input.evidence[0].evidence_ref = "mutated";
  assert.deepEqual(result.evidence.map((item) => item.evidence_ref), [
    "evidence:1", "evidence:2", "evidence:3",
  ]);
});

test("submission rejects a non-object", () => {
  assert.throws(() => validateWorkerEvidenceSubmission(null), TypeError);
  assert.throws(() => validateWorkerEvidenceSubmission([]), TypeError);
});

test("submission rejects a missing or unknown key", () => {
  const { worker_claim, ...missing } = submission();
  assert.throws(() => validateWorkerEvidenceSubmission(missing), TypeError);
  assert.throws(() => validateWorkerEvidenceSubmission(submission({ extra: "x" })), TypeError);
});

test("submission rejects an invalid worker_claim", () => {
  assert.throws(() => validateWorkerEvidenceSubmission(submission({ worker_claim: "DONE" })), TypeError);
  assert.throws(() => validateWorkerEvidenceSubmission(submission({ worker_claim: "ready" })), TypeError);
});

test("submission accepts each documented worker_claim", () => {
  for (const workerClaim of WORKER_CLAIMS) {
    const result = validateWorkerEvidenceSubmission(submission({ worker_claim: workerClaim }));
    assert.equal(result.worker_claim, workerClaim);
  }
});

test("submission rejects a non-array evidence value", () => {
  assert.throws(() => validateWorkerEvidenceSubmission(submission({ evidence: "nope" })), TypeError);
});

test("submission rejects an evidence item with a missing or unknown key", () => {
  assert.throws(
    () => validateWorkerEvidenceSubmission(submission({ evidence: [{ criterion_id: "criterion-1" }] })),
    TypeError,
  );
  assert.throws(
    () =>
      validateWorkerEvidenceSubmission(
        submission({ evidence: [{ criterion_id: "criterion-1", evidence_ref: "e", extra: "x" }] }),
      ),
    TypeError,
  );
});

test("submission rejects untrimmed or empty evidence strings", () => {
  assert.throws(
    () =>
      validateWorkerEvidenceSubmission(
        submission({ evidence: [{ criterion_id: "criterion-1", evidence_ref: "" }] }),
      ),
    TypeError,
  );
  assert.throws(
    () =>
      validateWorkerEvidenceSubmission(
        submission({ evidence: [{ criterion_id: " criterion-1", evidence_ref: "e" }] }),
      ),
    TypeError,
  );
});

test("submission rejects non-positive-safe-integer revisions", () => {
  assert.throws(() => validateWorkerEvidenceSubmission(submission({ plan_revision: 0 })), TypeError);
  assert.throws(() => validateWorkerEvidenceSubmission(submission({ acceptance_spec_revision: 0 })), TypeError);
  assert.throws(() => validateWorkerEvidenceSubmission(submission({ plan_revision: "7" })), TypeError);
});

// --- supervisor acceptance decision validator ---

test("a well-formed decision validates and is deep-frozen", () => {
  const result = validateSupervisorAcceptanceDecision(decision());
  assert.deepEqual(result, decision());
  assert.ok(Object.isFrozen(result));
});

test("validating a decision does not mutate the input", () => {
  const input = decision();
  const before = structuredClone(input);
  const result = validateSupervisorAcceptanceDecision(input);
  assert.deepEqual(input, before);
  input.decision = "reject";
  assert.equal(result.decision, "accept");
});

test("decision rejects a non-object, missing key, or unknown key", () => {
  assert.throws(() => validateSupervisorAcceptanceDecision(null), TypeError);
  const { reason, ...missing } = decision();
  assert.throws(() => validateSupervisorAcceptanceDecision(missing), TypeError);
  assert.throws(() => validateSupervisorAcceptanceDecision(decision({ extra: "x" })), TypeError);
});

test("decision rejects an invalid decision value", () => {
  assert.throws(() => validateSupervisorAcceptanceDecision(decision({ decision: "approve" })), TypeError);
  assert.throws(() => validateSupervisorAcceptanceDecision(decision({ decision: "ACCEPT" })), TypeError);
});

test("decision accepts each documented decision", () => {
  for (const value of SUPERVISOR_DECISIONS) {
    const result = validateSupervisorAcceptanceDecision(decision({ decision: value }));
    assert.equal(result.decision, value);
  }
});

test("decision rejects untrimmed, empty, or non-string reason", () => {
  assert.throws(() => validateSupervisorAcceptanceDecision(decision({ reason: "" })), TypeError);
  assert.throws(() => validateSupervisorAcceptanceDecision(decision({ reason: "  " })), TypeError);
  assert.throws(() => validateSupervisorAcceptanceDecision(decision({ reason: " reason" })), TypeError);
  assert.throws(() => validateSupervisorAcceptanceDecision(decision({ reason: null })), TypeError);
});

test("decision rejects non-positive-safe-integer revisions", () => {
  assert.throws(() => validateSupervisorAcceptanceDecision(decision({ plan_revision: 0 })), TypeError);
  assert.throws(
    () => validateSupervisorAcceptanceDecision(decision({ acceptance_spec_revision: -2 })),
    TypeError,
  );
});

// --- current acceptance identity validator ---

test("a well-formed current acceptance identity validates and is deep-frozen", () => {
  const result = validateCurrentAcceptanceIdentity(current());
  assert.deepEqual(result, current());
  assert.ok(Object.isFrozen(result));
});

test("validating the current identity does not mutate the input", () => {
  const input = current();
  const before = structuredClone(input);
  const result = validateCurrentAcceptanceIdentity(input);
  assert.deepEqual(input, before);
  input.acceptance_spec_revision = 99;
  assert.equal(result.acceptance_spec_revision, 3);
});

test("current acceptance identity rejects a non-object, missing key, or unknown key", () => {
  assert.throws(() => validateCurrentAcceptanceIdentity(null), TypeError);
  const { acceptance_spec_revision, ...missing } = current();
  assert.throws(() => validateCurrentAcceptanceIdentity(missing), TypeError);
  assert.throws(() => validateCurrentAcceptanceIdentity(current({ extra: "x" })), TypeError);
});

test("current acceptance identity rejects untrimmed strings and bad revisions", () => {
  assert.throws(() => validateCurrentAcceptanceIdentity(current({ plan_id: "" })), TypeError);
  assert.throws(() => validateCurrentAcceptanceIdentity(current({ gate_id: " gate-a" })), TypeError);
  assert.throws(() => validateCurrentAcceptanceIdentity(current({ plan_revision: 0 })), TypeError);
  assert.throws(
    () => validateCurrentAcceptanceIdentity(current({ acceptance_spec_revision: "3" })),
    TypeError,
  );
});

// --- evaluateWorkerEvidenceSubmission ---

test("complete current evidence with claim READY is complete but never accepted", () => {
  const result = evaluateWorkerEvidenceSubmission(spec(), submission(), current());
  assert.equal(result.status, EVIDENCE_COMPLETE);
  assert.equal(result.reason_code, EVIDENCE_COMPLETE);
  assert.equal(result.ready_for_supervisor_review, true);
  assert.equal(result.accepted, false);
  assert.deepEqual(result.covered_criteria, ["criterion-1", "criterion-2", "criterion-3"]);
  assert.deepEqual(result.missing_criteria, []);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.covered_criteria));
});

test("complete current evidence with claim READY_FOR_REVIEW is complete but never accepted", () => {
  const result = evaluateWorkerEvidenceSubmission(
    spec(),
    submission({ worker_claim: "READY_FOR_REVIEW" }),
    current(),
  );
  assert.equal(result.status, EVIDENCE_COMPLETE);
  assert.equal(result.reason_code, EVIDENCE_COMPLETE);
  assert.equal(result.ready_for_supervisor_review, true);
  assert.equal(result.accepted, false);
});

test("partial evidence is incomplete and reports covered/missing in spec order", () => {
  const result = evaluateWorkerEvidenceSubmission(
    spec(),
    submission({
      evidence: [
        { criterion_id: "criterion-3", evidence_ref: "evidence:3" },
        { criterion_id: "criterion-1", evidence_ref: "evidence:1" },
      ],
    }),
    current(),
  );
  assert.equal(result.status, EVIDENCE_INCOMPLETE);
  assert.equal(result.reason_code, EVIDENCE_INCOMPLETE);
  assert.equal(result.ready_for_supervisor_review, false);
  assert.equal(result.accepted, false);
  assert.deepEqual(result.covered_criteria, ["criterion-1", "criterion-3"]);
  assert.deepEqual(result.missing_criteria, ["criterion-2"]);
});

test("zero evidence is incomplete and never accepted", () => {
  const result = evaluateWorkerEvidenceSubmission(spec(), submission({ evidence: [] }), current());
  assert.equal(result.status, EVIDENCE_INCOMPLETE);
  assert.equal(result.reason_code, EVIDENCE_INCOMPLETE);
  assert.equal(result.ready_for_supervisor_review, false);
  assert.equal(result.accepted, false);
  assert.deepEqual(result.covered_criteria, []);
  assert.deepEqual(result.missing_criteria, ["criterion-1", "criterion-2", "criterion-3"]);
});

test("an unknown criterion fails closed even when all spec criteria are covered", () => {
  const result = evaluateWorkerEvidenceSubmission(
    spec(),
    submission({
      evidence: [
        { criterion_id: "criterion-1", evidence_ref: "evidence:1" },
        { criterion_id: "criterion-2", evidence_ref: "evidence:2" },
        { criterion_id: "criterion-3", evidence_ref: "evidence:3" },
        { criterion_id: "criterion-unknown", evidence_ref: "evidence:x" },
      ],
    }),
    current(),
  );
  assert.equal(result.status, EVIDENCE_INCOMPLETE);
  assert.equal(result.reason_code, UNKNOWN_CRITERION);
  assert.equal(result.ready_for_supervisor_review, false);
  assert.equal(result.accepted, false);
  assert.deepEqual(result.covered_criteria, ["criterion-1", "criterion-2", "criterion-3"]);
  assert.deepEqual(result.missing_criteria, []);
});

test("unknown criterion takes precedence over incomplete evidence", () => {
  const result = evaluateWorkerEvidenceSubmission(
    spec(),
    submission({ evidence: [{ criterion_id: "criterion-unknown", evidence_ref: "evidence:x" }] }),
    current(),
  );
  assert.equal(result.status, EVIDENCE_INCOMPLETE);
  assert.equal(result.reason_code, UNKNOWN_CRITERION);
  assert.equal(result.ready_for_supervisor_review, false);
  assert.equal(result.accepted, false);
  assert.deepEqual(result.missing_criteria, ["criterion-1", "criterion-2", "criterion-3"]);
});

test("submission plan_id mismatch fails closed with PLAN_ID_MISMATCH", () => {
  const result = evaluateWorkerEvidenceSubmission(
    spec(),
    submission({ plan_id: "plan-other" }),
    current(),
  );
  assert.equal(result.status, EVIDENCE_INCOMPLETE);
  assert.equal(result.reason_code, PLAN_ID_MISMATCH);
  assert.equal(result.ready_for_supervisor_review, false);
  assert.equal(result.accepted, false);
  assert.deepEqual(result.covered_criteria, []);
  assert.deepEqual(result.missing_criteria, []);
});

test("submission stale plan_revision fails closed with STALE_PLAN_REVISION", () => {
  const result = evaluateWorkerEvidenceSubmission(
    spec(),
    submission({ plan_revision: 6 }),
    current(),
  );
  assert.equal(result.status, EVIDENCE_INCOMPLETE);
  assert.equal(result.reason_code, STALE_PLAN_REVISION);
  assert.equal(result.ready_for_supervisor_review, false);
  assert.equal(result.accepted, false);
});

test("submission gate_id mismatch fails closed with GATE_ID_MISMATCH", () => {
  const result = evaluateWorkerEvidenceSubmission(
    spec(),
    submission({ gate_id: "gate-b" }),
    current(),
  );
  assert.equal(result.status, EVIDENCE_INCOMPLETE);
  assert.equal(result.reason_code, GATE_ID_MISMATCH);
  assert.equal(result.ready_for_supervisor_review, false);
  assert.equal(result.accepted, false);
});

test("submission stale acceptance_spec_revision fails closed with STALE_ACCEPTANCE_SPEC_REVISION", () => {
  const result = evaluateWorkerEvidenceSubmission(
    spec(),
    submission({ acceptance_spec_revision: 2 }),
    current(),
  );
  assert.equal(result.status, EVIDENCE_INCOMPLETE);
  assert.equal(result.reason_code, STALE_ACCEPTANCE_SPEC_REVISION);
  assert.equal(result.ready_for_supervisor_review, false);
  assert.equal(result.accepted, false);
});

test("submission identity mismatch precedence is plan_id first", () => {
  const result = evaluateWorkerEvidenceSubmission(
    spec(),
    submission({
      plan_id: "plan-other",
      plan_revision: 1,
      gate_id: "gate-b",
      acceptance_spec_revision: 1,
    }),
    current(),
  );
  assert.equal(result.status, EVIDENCE_INCOMPLETE);
  assert.equal(result.reason_code, PLAN_ID_MISMATCH);
});

test("stale spec versus current plan_revision fails closed even when submission matches the stale spec", () => {
  const staleSpec = spec({ plan_revision: 6 });
  const staleSubmission = submission({ plan_revision: 6 });
  const result = evaluateWorkerEvidenceSubmission(staleSpec, staleSubmission, current());
  assert.equal(result.status, EVIDENCE_INCOMPLETE);
  assert.equal(result.reason_code, STALE_PLAN_REVISION);
  assert.equal(result.ready_for_supervisor_review, false);
  assert.equal(result.accepted, false);
});

test("stale self-consistent spec revision versus newer current spec revision fails closed", () => {
  const staleSpec = spec({ acceptance_spec_revision: 1 });
  const staleSubmission = submission({ acceptance_spec_revision: 1 });
  const newerCurrent = current({ acceptance_spec_revision: 2 });
  const result = evaluateWorkerEvidenceSubmission(staleSpec, staleSubmission, newerCurrent);
  assert.equal(result.status, EVIDENCE_INCOMPLETE);
  assert.equal(result.reason_code, STALE_ACCEPTANCE_SPEC_REVISION);
  assert.equal(result.ready_for_supervisor_review, false);
  assert.equal(result.accepted, false);
});

test("wrong current plan_id fails closed with PLAN_ID_MISMATCH", () => {
  const result = evaluateWorkerEvidenceSubmission(
    spec(),
    submission(),
    current({ plan_id: "plan-other" }),
  );
  assert.equal(result.status, EVIDENCE_INCOMPLETE);
  assert.equal(result.reason_code, PLAN_ID_MISMATCH);
  assert.equal(result.ready_for_supervisor_review, false);
});

test("wrong current gate_id fails closed with GATE_ID_MISMATCH", () => {
  const result = evaluateWorkerEvidenceSubmission(
    spec(),
    submission(),
    current({ gate_id: "gate-b" }),
  );
  assert.equal(result.status, EVIDENCE_INCOMPLETE);
  assert.equal(result.reason_code, GATE_ID_MISMATCH);
  assert.equal(result.ready_for_supervisor_review, false);
});

test("evaluator fails closed on malformed input", () => {
  assert.throws(() => evaluateWorkerEvidenceSubmission(spec(), "bad", current()), TypeError);
  assert.throws(() => evaluateWorkerEvidenceSubmission("bad", submission(), current()), TypeError);
  assert.throws(() => evaluateWorkerEvidenceSubmission(spec(), submission(), "bad"), TypeError);
});

test("evaluator does not mutate its inputs", () => {
  const inputSpec = spec();
  const inputSubmission = submission();
  const inputCurrent = current();
  const beforeSpec = structuredClone(inputSpec);
  const beforeSubmission = structuredClone(inputSubmission);
  const beforeCurrent = structuredClone(inputCurrent);
  evaluateWorkerEvidenceSubmission(inputSpec, inputSubmission, inputCurrent);
  assert.deepEqual(inputSpec, beforeSpec);
  assert.deepEqual(inputSubmission, beforeSubmission);
  assert.deepEqual(inputCurrent, beforeCurrent);
});

// --- applySupervisorAcceptanceDecision ---

test("complete current evidence plus a bound accept is the only ACCEPTED path", () => {
  const result = applySupervisorAcceptanceDecision(spec(), submission(), decision(), current());
  assert.equal(result.accepted, true);
  assert.equal(result.status, ACCEPTED);
  assert.equal(result.reason_code, ACCEPTED);
  assert.ok(Object.isFrozen(result));
});

test("complete current evidence plus a bound reject is a valid REJECTED", () => {
  const result = applySupervisorAcceptanceDecision(
    spec(),
    submission(),
    decision({ decision: "reject", reason: "not satisfied" }),
    current(),
  );
  assert.equal(result.accepted, false);
  assert.equal(result.status, REJECTED);
  assert.equal(result.reason_code, REJECTED);
});

test("bound reject with zero evidence is still a valid REJECTED", () => {
  const result = applySupervisorAcceptanceDecision(
    spec(),
    submission({ evidence: [] }),
    decision({ decision: "reject", reason: "no evidence" }),
    current(),
  );
  assert.equal(result.accepted, false);
  assert.equal(result.status, REJECTED);
  assert.equal(result.reason_code, REJECTED);
});

test("bound reject with partial evidence is still a valid REJECTED", () => {
  const result = applySupervisorAcceptanceDecision(
    spec(),
    submission({ evidence: [{ criterion_id: "criterion-1", evidence_ref: "evidence:1" }] }),
    decision({ decision: "reject", reason: "incomplete" }),
    current(),
  );
  assert.equal(result.accepted, false);
  assert.equal(result.status, REJECTED);
  assert.equal(result.reason_code, REJECTED);
});

test("bound reject with unknown-criterion evidence is still a valid REJECTED", () => {
  const result = applySupervisorAcceptanceDecision(
    spec(),
    submission({ evidence: [{ criterion_id: "criterion-unknown", evidence_ref: "evidence:x" }] }),
    decision({ decision: "reject", reason: "unknown criterion" }),
    current(),
  );
  assert.equal(result.accepted, false);
  assert.equal(result.status, REJECTED);
  assert.equal(result.reason_code, REJECTED);
});

test("accept with partial evidence cannot accept and propagates EVIDENCE_INCOMPLETE", () => {
  const result = applySupervisorAcceptanceDecision(
    spec(),
    submission({ evidence: [{ criterion_id: "criterion-1", evidence_ref: "evidence:1" }] }),
    decision(),
    current(),
  );
  assert.equal(result.accepted, false);
  assert.equal(result.status, ACCEPT_BLOCKED_INCOMPLETE_EVIDENCE);
  assert.equal(result.reason_code, EVIDENCE_INCOMPLETE);
});

test("accept with zero evidence cannot accept and propagates EVIDENCE_INCOMPLETE", () => {
  const result = applySupervisorAcceptanceDecision(
    spec(),
    submission({ evidence: [] }),
    decision(),
    current(),
  );
  assert.equal(result.accepted, false);
  assert.equal(result.status, ACCEPT_BLOCKED_INCOMPLETE_EVIDENCE);
  assert.equal(result.reason_code, EVIDENCE_INCOMPLETE);
});

test("accept with unknown-criterion evidence cannot accept and propagates UNKNOWN_CRITERION", () => {
  const result = applySupervisorAcceptanceDecision(
    spec(),
    submission({
      evidence: [
        { criterion_id: "criterion-1", evidence_ref: "evidence:1" },
        { criterion_id: "criterion-2", evidence_ref: "evidence:2" },
        { criterion_id: "criterion-3", evidence_ref: "evidence:3" },
        { criterion_id: "criterion-unknown", evidence_ref: "evidence:x" },
      ],
    }),
    decision(),
    current(),
  );
  assert.equal(result.accepted, false);
  assert.equal(result.status, ACCEPT_BLOCKED_INCOMPLETE_EVIDENCE);
  assert.equal(result.reason_code, UNKNOWN_CRITERION);
});

test("P1 stale spec revision blocks both accept and reject with DECISION_BLOCKED_STALE_CONTEXT", () => {
  const staleSpec = spec({ acceptance_spec_revision: 1 });
  const staleSubmission = submission({ acceptance_spec_revision: 1 });
  const newerCurrent = current({ acceptance_spec_revision: 2 });

  const accepted = applySupervisorAcceptanceDecision(
    staleSpec,
    staleSubmission,
    decision({ acceptance_spec_revision: 1 }),
    newerCurrent,
  );
  assert.equal(accepted.accepted, false);
  assert.equal(accepted.status, DECISION_BLOCKED_STALE_CONTEXT);
  assert.equal(accepted.reason_code, STALE_ACCEPTANCE_SPEC_REVISION);

  const rejected = applySupervisorAcceptanceDecision(
    staleSpec,
    staleSubmission,
    decision({ acceptance_spec_revision: 1, decision: "reject", reason: "stale" }),
    newerCurrent,
  );
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.status, DECISION_BLOCKED_STALE_CONTEXT);
  assert.equal(rejected.reason_code, STALE_ACCEPTANCE_SPEC_REVISION);
});

test("P1 stale spec plan_revision blocks with STALE_PLAN_REVISION", () => {
  const staleSpec = spec({ plan_revision: 6 });
  const staleSubmission = submission({ plan_revision: 6 });
  const result = applySupervisorAcceptanceDecision(
    staleSpec,
    staleSubmission,
    decision({ plan_revision: 6 }),
    current(),
  );
  assert.equal(result.accepted, false);
  assert.equal(result.status, DECISION_BLOCKED_STALE_CONTEXT);
  assert.equal(result.reason_code, STALE_PLAN_REVISION);
});

test("P1 wrong current plan_id blocks with PLAN_ID_MISMATCH", () => {
  const result = applySupervisorAcceptanceDecision(
    spec(),
    submission(),
    decision(),
    current({ plan_id: "plan-other" }),
  );
  assert.equal(result.accepted, false);
  assert.equal(result.status, DECISION_BLOCKED_STALE_CONTEXT);
  assert.equal(result.reason_code, PLAN_ID_MISMATCH);
});

test("P1 wrong current gate_id blocks with GATE_ID_MISMATCH", () => {
  const result = applySupervisorAcceptanceDecision(
    spec(),
    submission(),
    decision(),
    current({ gate_id: "gate-b" }),
  );
  assert.equal(result.accepted, false);
  assert.equal(result.status, DECISION_BLOCKED_STALE_CONTEXT);
  assert.equal(result.reason_code, GATE_ID_MISMATCH);
});

test("P1 identity precedence is plan_id first", () => {
  const result = applySupervisorAcceptanceDecision(
    spec(),
    submission(),
    decision(),
    current({ plan_id: "plan-other", plan_revision: 1, gate_id: "gate-b", acceptance_spec_revision: 1 }),
  );
  assert.equal(result.status, DECISION_BLOCKED_STALE_CONTEXT);
  assert.equal(result.reason_code, PLAN_ID_MISMATCH);
});

test("P2 reject with wrong submission plan_id is DECISION_BLOCKED_IDENTITY_MISMATCH, not REJECTED", () => {
  const result = applySupervisorAcceptanceDecision(
    spec(),
    submission({ plan_id: "plan-other" }),
    decision({ decision: "reject", reason: "would reject" }),
    current(),
  );
  assert.equal(result.accepted, false);
  assert.equal(result.status, DECISION_BLOCKED_IDENTITY_MISMATCH);
  assert.equal(result.reason_code, PLAN_ID_MISMATCH);
  assert.notEqual(result.status, REJECTED);
});

test("P2 reject with stale submission plan_revision is blocked, not REJECTED", () => {
  const result = applySupervisorAcceptanceDecision(
    spec(),
    submission({ plan_revision: 6 }),
    decision({ decision: "reject", reason: "would reject" }),
    current(),
  );
  assert.equal(result.accepted, false);
  assert.equal(result.status, DECISION_BLOCKED_IDENTITY_MISMATCH);
  assert.equal(result.reason_code, STALE_PLAN_REVISION);
  assert.notEqual(result.status, REJECTED);
});

test("P2 reject with wrong submission gate_id is blocked, not REJECTED", () => {
  const result = applySupervisorAcceptanceDecision(
    spec(),
    submission({ gate_id: "gate-b" }),
    decision({ decision: "reject", reason: "would reject" }),
    current(),
  );
  assert.equal(result.accepted, false);
  assert.equal(result.status, DECISION_BLOCKED_IDENTITY_MISMATCH);
  assert.equal(result.reason_code, GATE_ID_MISMATCH);
});

test("P2 reject with stale submission acceptance_spec_revision is blocked, not REJECTED", () => {
  const newerSpec = spec({ acceptance_spec_revision: 2 });
  const newerSubmission = submission({ acceptance_spec_revision: 2 });
  const newerCurrent = current({ acceptance_spec_revision: 2 });
  const result = applySupervisorAcceptanceDecision(
    newerSpec,
    newerSubmission,
    decision({ acceptance_spec_revision: 2, decision: "reject", reason: "would reject" }),
    newerCurrent,
  );
  assert.equal(result.accepted, false);
  assert.equal(result.status, REJECTED);

  const staleSubmission = submission({ acceptance_spec_revision: 1 });
  const blocked = applySupervisorAcceptanceDecision(
    newerSpec,
    staleSubmission,
    decision({ acceptance_spec_revision: 2, decision: "reject", reason: "would reject" }),
    newerCurrent,
  );
  assert.equal(blocked.accepted, false);
  assert.equal(blocked.status, DECISION_BLOCKED_IDENTITY_MISMATCH);
  assert.equal(blocked.reason_code, STALE_ACCEPTANCE_SPEC_REVISION);
  assert.notEqual(blocked.status, REJECTED);
});

test("P2 accept with stale submission identity cannot accept", () => {
  const newerSpec = spec({ acceptance_spec_revision: 2 });
  const newerCurrent = current({ acceptance_spec_revision: 2 });
  const result = applySupervisorAcceptanceDecision(
    newerSpec,
    submission({ acceptance_spec_revision: 1 }),
    decision({ acceptance_spec_revision: 2 }),
    newerCurrent,
  );
  assert.equal(result.accepted, false);
  assert.equal(result.status, DECISION_BLOCKED_IDENTITY_MISMATCH);
  assert.equal(result.reason_code, STALE_ACCEPTANCE_SPEC_REVISION);
});

test("P3 reject with wrong decision plan_id is DECISION_BLOCKED_IDENTITY_MISMATCH, not REJECTED", () => {
  const result = applySupervisorAcceptanceDecision(
    spec(),
    submission(),
    decision({ plan_id: "plan-other", decision: "reject", reason: "would reject" }),
    current(),
  );
  assert.equal(result.accepted, false);
  assert.equal(result.status, DECISION_BLOCKED_IDENTITY_MISMATCH);
  assert.equal(result.reason_code, PLAN_ID_MISMATCH);
  assert.notEqual(result.status, REJECTED);
});

test("P3 reject with stale decision plan_revision is blocked, not REJECTED", () => {
  const result = applySupervisorAcceptanceDecision(
    spec(),
    submission(),
    decision({ plan_revision: 6, decision: "reject", reason: "would reject" }),
    current(),
  );
  assert.equal(result.accepted, false);
  assert.equal(result.status, DECISION_BLOCKED_IDENTITY_MISMATCH);
  assert.equal(result.reason_code, STALE_PLAN_REVISION);
});

test("P3 reject with wrong decision gate_id is blocked, not REJECTED", () => {
  const result = applySupervisorAcceptanceDecision(
    spec(),
    submission(),
    decision({ gate_id: "gate-b", decision: "reject", reason: "would reject" }),
    current(),
  );
  assert.equal(result.accepted, false);
  assert.equal(result.status, DECISION_BLOCKED_IDENTITY_MISMATCH);
  assert.equal(result.reason_code, GATE_ID_MISMATCH);
});

test("P3 reject with stale decision acceptance_spec_revision is blocked, not REJECTED", () => {
  const newerSpec = spec({ acceptance_spec_revision: 2 });
  const newerSubmission = submission({ acceptance_spec_revision: 2 });
  const newerCurrent = current({ acceptance_spec_revision: 2 });
  const result = applySupervisorAcceptanceDecision(
    newerSpec,
    newerSubmission,
    decision({ acceptance_spec_revision: 1, decision: "reject", reason: "would reject" }),
    newerCurrent,
  );
  assert.equal(result.accepted, false);
  assert.equal(result.status, DECISION_BLOCKED_IDENTITY_MISMATCH);
  assert.equal(result.reason_code, STALE_ACCEPTANCE_SPEC_REVISION);
  assert.notEqual(result.status, REJECTED);
});

test("P3 accept with stale decision identity cannot accept", () => {
  const newerSpec = spec({ acceptance_spec_revision: 2 });
  const newerSubmission = submission({ acceptance_spec_revision: 2 });
  const newerCurrent = current({ acceptance_spec_revision: 2 });
  const result = applySupervisorAcceptanceDecision(
    newerSpec,
    newerSubmission,
    decision({ acceptance_spec_revision: 1 }),
    newerCurrent,
  );
  assert.equal(result.accepted, false);
  assert.equal(result.status, DECISION_BLOCKED_IDENTITY_MISMATCH);
  assert.equal(result.reason_code, STALE_ACCEPTANCE_SPEC_REVISION);
});

test("P0 malformed submission on the reject path throws TypeError before P4", () => {
  assert.throws(
    () =>
      applySupervisorAcceptanceDecision(
        spec(),
        { ...submission(), evidence: "not-an-array" },
        decision({ decision: "reject", reason: "would reject" }),
        current(),
      ),
    TypeError,
  );
  assert.throws(
    () =>
      applySupervisorAcceptanceDecision(
        spec(),
        "not-an-object",
        decision({ decision: "reject", reason: "would reject" }),
        current(),
      ),
    TypeError,
  );
});

test("P0 malformed spec, decision, or current identity throws TypeError", () => {
  assert.throws(
    () => applySupervisorAcceptanceDecision("bad", submission(), decision(), current()),
    TypeError,
  );
  assert.throws(
    () => applySupervisorAcceptanceDecision(spec(), submission(), "bad", current()),
    TypeError,
  );
  assert.throws(
    () => applySupervisorAcceptanceDecision(spec(), submission(), decision({ decision: "maybe" }), current()),
    TypeError,
  );
  assert.throws(
    () => applySupervisorAcceptanceDecision(spec(), submission(), decision(), "bad"),
    TypeError,
  );
});

test("apply does not mutate its inputs", () => {
  const inputSpec = spec();
  const inputSubmission = submission();
  const inputDecision = decision();
  const inputCurrent = current();
  const beforeSpec = structuredClone(inputSpec);
  const beforeSubmission = structuredClone(inputSubmission);
  const beforeDecision = structuredClone(inputDecision);
  const beforeCurrent = structuredClone(inputCurrent);
  applySupervisorAcceptanceDecision(inputSpec, inputSubmission, inputDecision, inputCurrent);
  assert.deepEqual(inputSpec, beforeSpec);
  assert.deepEqual(inputSubmission, beforeSubmission);
  assert.deepEqual(inputDecision, beforeDecision);
  assert.deepEqual(inputCurrent, beforeCurrent);
});
