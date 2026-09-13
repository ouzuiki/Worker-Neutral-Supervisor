import assert from "node:assert/strict";
import test from "node:test";
import {
  validatePlanAmendmentProposal,
  validatePlanAmendmentReview,
  validatePlanAmendmentHistoryRecord,
  PROPOSAL_TYPES,
  EXECUTION_RECOMMENDATIONS,
  REVIEW_DECISIONS,
} from "./plan-amendment.mjs";

function proposal(overrides = {}) {
  return {
    proposal_id: "proposal-1",
    plan_id: "plan-1",
    observed_plan_revision: 3,
    proposed_by: { worker: "worker-a", session_id: "session-1" },
    proposal_type: "INSERT_PREREQUISITE",
    affected_gates: ["gate-a", "gate-b"],
    reason: "gate-b needs an upstream check",
    evidence_refs: ["evidence:1"],
    execution_recommendation: "CONTINUE_CURRENT_GATE",
    ...overrides,
  };
}

function review(overrides = {}) {
  return { decision: "accept", reason: "looks correct", ...overrides };
}

function history(overrides = {}) {
  return {
    proposal_id: "proposal-1",
    observed_plan_revision: 3,
    applied_plan_revision: 4,
    decision: "accept",
    reason: "applied cleanly",
    ...overrides,
  };
}

// --- proposal: happy path & deep freeze/copy safety ---

test("a well-formed proposal validates and is deep-frozen", () => {
  const input = proposal();
  const result = validatePlanAmendmentProposal(input);
  assert.deepEqual(result, proposal());
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.proposed_by));
  assert.ok(Object.isFrozen(result.affected_gates));
  assert.ok(Object.isFrozen(result.evidence_refs));
});

test("mutating the input after validation does not affect the returned proposal", () => {
  const input = proposal();
  const result = validatePlanAmendmentProposal(input);
  input.affected_gates.push("gate-c");
  input.proposed_by.worker = "worker-mutated";
  assert.deepEqual(result.affected_gates, ["gate-a", "gate-b"]);
  assert.equal(result.proposed_by.worker, "worker-a");
});

test("evidence_refs may be empty", () => {
  const result = validatePlanAmendmentProposal(proposal({ evidence_refs: [] }));
  assert.deepEqual(result.evidence_refs, []);
});

// --- proposal: strict keys ---

test("proposal rejects a missing top-level key", () => {
  const { reason, ...missing } = proposal();
  assert.throws(() => validatePlanAmendmentProposal(missing), TypeError);
});

test("proposal rejects an unknown top-level key", () => {
  assert.throws(() => validatePlanAmendmentProposal(proposal({ extra_field: "nope" })), TypeError);
});

test("proposal rejects a missing nested proposed_by key", () => {
  assert.throws(
    () => validatePlanAmendmentProposal(proposal({ proposed_by: { worker: "worker-a" } })),
    TypeError,
  );
});

test("proposal rejects an unknown nested proposed_by key", () => {
  assert.throws(
    () =>
      validatePlanAmendmentProposal(
        proposal({ proposed_by: { worker: "worker-a", session_id: "session-1", extra: "x" } }),
      ),
    TypeError,
  );
});

test("proposal rejects a non-object proposed_by", () => {
  assert.throws(() => validatePlanAmendmentProposal(proposal({ proposed_by: "worker-a" })), TypeError);
});

// --- proposal: enums ---

test("proposal rejects an invalid proposal_type", () => {
  assert.throws(() => validatePlanAmendmentProposal(proposal({ proposal_type: "DELETE_EVERYTHING" })), TypeError);
});

test("every documented proposal_type is accepted", () => {
  for (const proposalType of PROPOSAL_TYPES) {
    const result = validatePlanAmendmentProposal(proposal({ proposal_type: proposalType }));
    assert.equal(result.proposal_type, proposalType);
  }
});

test("proposal rejects an invalid execution_recommendation", () => {
  assert.throws(
    () => validatePlanAmendmentProposal(proposal({ execution_recommendation: "ABORT_EVERYTHING" })),
    TypeError,
  );
});

test("every documented execution_recommendation is accepted", () => {
  for (const recommendation of EXECUTION_RECOMMENDATIONS) {
    const result = validatePlanAmendmentProposal(proposal({ execution_recommendation: recommendation }));
    assert.equal(result.execution_recommendation, recommendation);
  }
});

// --- proposal: strings, integers, arrays ---

test("proposal rejects a non-positive or non-integer observed_plan_revision", () => {
  assert.throws(() => validatePlanAmendmentProposal(proposal({ observed_plan_revision: 0 })), TypeError);
  assert.throws(() => validatePlanAmendmentProposal(proposal({ observed_plan_revision: -1 })), TypeError);
  assert.throws(() => validatePlanAmendmentProposal(proposal({ observed_plan_revision: 1.5 })), TypeError);
  assert.throws(() => validatePlanAmendmentProposal(proposal({ observed_plan_revision: "3" })), TypeError);
});

test("proposal rejects untrimmed or empty string fields", () => {
  assert.throws(() => validatePlanAmendmentProposal(proposal({ proposal_id: "" })), TypeError);
  assert.throws(() => validatePlanAmendmentProposal(proposal({ proposal_id: "  proposal-1  " })), TypeError);
  assert.throws(() => validatePlanAmendmentProposal(proposal({ plan_id: "   " })), TypeError);
  assert.throws(() => validatePlanAmendmentProposal(proposal({ reason: "" })), TypeError);
});

test("proposal rejects duplicate affected_gates", () => {
  assert.throws(
    () => validatePlanAmendmentProposal(proposal({ affected_gates: ["gate-a", "gate-a"] })),
    TypeError,
  );
});

test("proposal rejects an empty affected_gates array", () => {
  assert.throws(() => validatePlanAmendmentProposal(proposal({ affected_gates: [] })), TypeError);
});

test("proposal rejects duplicate evidence_refs", () => {
  assert.throws(
    () => validatePlanAmendmentProposal(proposal({ evidence_refs: ["evidence:1", "evidence:1"] })),
    TypeError,
  );
});

// --- review ---

test("a well-formed review validates and is deep-frozen", () => {
  const result = validatePlanAmendmentReview(review());
  assert.deepEqual(result, review());
  assert.ok(Object.isFrozen(result));
});

test("review reason may be null", () => {
  const result = validatePlanAmendmentReview(review({ reason: null }));
  assert.equal(result.reason, null);
});

test("review rejects a missing key", () => {
  assert.throws(() => validatePlanAmendmentReview({ decision: "accept" }), TypeError);
});

test("review rejects an unknown key", () => {
  assert.throws(() => validatePlanAmendmentReview(review({ extra: "x" })), TypeError);
});

test("review rejects an invalid decision", () => {
  assert.throws(() => validatePlanAmendmentReview(review({ decision: "defer" })), TypeError);
});

test("every documented review decision is accepted", () => {
  for (const decision of REVIEW_DECISIONS) {
    const result = validatePlanAmendmentReview(review({ decision }));
    assert.equal(result.decision, decision);
  }
});

test("review rejects an untrimmed or empty non-null reason", () => {
  assert.throws(() => validatePlanAmendmentReview(review({ reason: "" })), TypeError);
  assert.throws(() => validatePlanAmendmentReview(review({ reason: "  padded  " })), TypeError);
});

// --- history record ---

test("a well-formed accept history record validates and is deep-frozen", () => {
  const result = validatePlanAmendmentHistoryRecord(history());
  assert.deepEqual(result, history());
  assert.ok(Object.isFrozen(result));
});

test("a well-formed modify history record validates", () => {
  const result = validatePlanAmendmentHistoryRecord(history({ decision: "modify", applied_plan_revision: 5 }));
  assert.equal(result.applied_plan_revision, 5);
});

test("a reject history record requires applied_plan_revision to be null", () => {
  const result = validatePlanAmendmentHistoryRecord(
    history({ decision: "reject", applied_plan_revision: null, reason: "not applicable" }),
  );
  assert.equal(result.applied_plan_revision, null);
});

test("a reject history record with a non-null applied_plan_revision is rejected", () => {
  assert.throws(
    () => validatePlanAmendmentHistoryRecord(history({ decision: "reject", applied_plan_revision: 4 })),
    TypeError,
  );
});

test("an accept history record requires a positive integer applied_plan_revision", () => {
  assert.throws(
    () => validatePlanAmendmentHistoryRecord(history({ applied_plan_revision: null })),
    TypeError,
  );
  assert.throws(
    () => validatePlanAmendmentHistoryRecord(history({ applied_plan_revision: 0 })),
    TypeError,
  );
  assert.throws(
    () => validatePlanAmendmentHistoryRecord(history({ applied_plan_revision: 3.2 })),
    TypeError,
  );
});

test("history record rejects a missing key", () => {
  const { reason, ...missing } = history();
  assert.throws(() => validatePlanAmendmentHistoryRecord(missing), TypeError);
});

test("history record rejects an unknown key", () => {
  assert.throws(() => validatePlanAmendmentHistoryRecord(history({ extra: "x" })), TypeError);
});

test("history record rejects an invalid decision", () => {
  assert.throws(() => validatePlanAmendmentHistoryRecord(history({ decision: "defer" })), TypeError);
});

test("history record rejects a non-positive observed_plan_revision", () => {
  assert.throws(() => validatePlanAmendmentHistoryRecord(history({ observed_plan_revision: 0 })), TypeError);
});

test("history record rejects an untrimmed or empty non-null reason", () => {
  assert.throws(() => validatePlanAmendmentHistoryRecord(history({ reason: "" })), TypeError);
  assert.throws(() => validatePlanAmendmentHistoryRecord(history({ reason: "  padded  " })), TypeError);
});

test("history record reason may be null", () => {
  const result = validatePlanAmendmentHistoryRecord(history({ reason: null }));
  assert.equal(result.reason, null);
});
