import test from "node:test";
import assert from "node:assert/strict";

import {
  validateAuthoritativePlan,
  createAuthoritativePlan,
  applySupervisorPlanAmendment,
  createWorkerPlanContext,
} from "./authoritative-plan.mjs";
import { validatePlanAmendmentProposal, validatePlanAmendmentReview } from "./plan-amendment.mjs";

function basePlan(overrides = {}) {
  return {
    plan_id: "plan-1",
    plan_revision: 1,
    gates: ["gate-a", "gate-b", "gate-c"],
    dependencies: [{ gate_id: "gate-b", requires: ["gate-a"] }],
    authorized_gates: ["gate-a"],
    completed_gates: [],
    blocked_gates: ["gate-b", "gate-c"],
    amendment_history: [],
    ...overrides,
  };
}

function baseProposal(overrides = {}) {
  return {
    proposal_id: "proposal-1",
    plan_id: "plan-1",
    observed_plan_revision: 1,
    proposed_by: { worker: "worker-1", session_id: "session-1" },
    proposal_type: "ADD_GATE",
    affected_gates: ["gate-a"],
    reason: "evidence suggests a missing gate",
    evidence_refs: [],
    execution_recommendation: "HOLD_BEFORE_NEXT_EFFECT",
    ...overrides,
  };
}

function baseReview(overrides = {}) {
  return { decision: "accept", reason: "looks correct", ...overrides };
}

// --- validateAuthoritativePlan: structural validation ---

test("valid plan is accepted and deep-frozen", () => {
  const plan = validateAuthoritativePlan(basePlan());
  assert.equal(plan.plan_id, "plan-1");
  assert.ok(Object.isFrozen(plan));
  assert.ok(Object.isFrozen(plan.gates));
  assert.ok(Object.isFrozen(plan.dependencies[0]));
});

test("missing key is rejected", () => {
  const plan = basePlan();
  delete plan.blocked_gates;
  assert.throws(() => validateAuthoritativePlan(plan), TypeError);
});

test("extra key is rejected", () => {
  const plan = basePlan({ extra_field: true });
  assert.throws(() => validateAuthoritativePlan(plan), TypeError);
});

test("non-positive plan_revision is rejected", () => {
  assert.throws(() => validateAuthoritativePlan(basePlan({ plan_revision: 0 })), TypeError);
});

test("duplicate gates are rejected", () => {
  assert.throws(() => validateAuthoritativePlan(basePlan({ gates: ["gate-a", "gate-a"] })), TypeError);
});

test("duplicate entries in authorized_gates are rejected", () => {
  assert.throws(
    () => validateAuthoritativePlan(basePlan({ authorized_gates: ["gate-a", "gate-a"] })),
    TypeError,
  );
});

test("unknown gate reference in authorized_gates is rejected", () => {
  assert.throws(
    () => validateAuthoritativePlan(basePlan({ authorized_gates: ["gate-z"] })),
    TypeError,
  );
});

test("unknown gate reference in blocked_gates is rejected", () => {
  assert.throws(
    () => validateAuthoritativePlan(basePlan({ blocked_gates: ["gate-z"] })),
    TypeError,
  );
});

// --- gate-state consistency and dependency fencing ---

test("gate overlapping authorized_gates and completed_gates is rejected", () => {
  assert.throws(
    () => validateAuthoritativePlan(basePlan({
      authorized_gates: ["gate-a"],
      completed_gates: ["gate-a"],
      blocked_gates: ["gate-b", "gate-c"],
    })),
    TypeError,
  );
});

test("gate overlapping authorized_gates and blocked_gates is rejected", () => {
  assert.throws(
    () => validateAuthoritativePlan(basePlan({
      authorized_gates: ["gate-b"],
      completed_gates: ["gate-a"],
      blocked_gates: ["gate-b", "gate-c"],
      dependencies: [{ gate_id: "gate-b", requires: ["gate-a"] }],
    })),
    TypeError,
  );
});

test("gate overlapping completed_gates and blocked_gates is rejected", () => {
  assert.throws(
    () => validateAuthoritativePlan(basePlan({
      authorized_gates: [],
      completed_gates: ["gate-b"],
      blocked_gates: ["gate-b", "gate-c"],
    })),
    TypeError,
  );
});

test("authorized gate with all dependencies completed is accepted", () => {
  const plan = validateAuthoritativePlan(basePlan({
    authorized_gates: ["gate-b"],
    completed_gates: ["gate-a"],
    blocked_gates: ["gate-c"],
    dependencies: [{ gate_id: "gate-b", requires: ["gate-a"] }],
  }));
  assert.deepEqual(plan.authorized_gates, ["gate-b"]);
});

test("authorized gate with an unmet dependency is rejected", () => {
  assert.throws(
    () => validateAuthoritativePlan(basePlan({
      authorized_gates: ["gate-b"],
      completed_gates: [],
      blocked_gates: ["gate-c"],
      dependencies: [{ gate_id: "gate-b", requires: ["gate-a"] }],
    })),
    TypeError,
  );
});

test("authorized gate with a partially met multi-dependency set is rejected", () => {
  assert.throws(
    () => validateAuthoritativePlan(basePlan({
      gates: ["gate-a", "gate-b", "gate-c"],
      authorized_gates: ["gate-c"],
      completed_gates: ["gate-a"],
      blocked_gates: [],
      dependencies: [{ gate_id: "gate-c", requires: ["gate-a", "gate-b"] }],
    })),
    TypeError,
  );
});

test("zero-dependency authorized gate is accepted", () => {
  const plan = validateAuthoritativePlan(basePlan({
    authorized_gates: ["gate-a"],
    completed_gates: [],
    blocked_gates: ["gate-b", "gate-c"],
    dependencies: [{ gate_id: "gate-b", requires: ["gate-a"] }],
  }));
  assert.deepEqual(plan.authorized_gates, ["gate-a"]);
});

test("dependency fencing and state-overlap checks do not mutate the input plan", () => {
  const input = basePlan({
    authorized_gates: ["gate-b"],
    completed_gates: [],
    blocked_gates: ["gate-c"],
    dependencies: [{ gate_id: "gate-b", requires: ["gate-a"] }],
  });
  const snapshot = JSON.parse(JSON.stringify(input));
  assert.throws(() => validateAuthoritativePlan(input), TypeError);
  assert.deepEqual(input, snapshot);
});

// --- dependencies ---

test("duplicate dependency entry for same gate_id is rejected", () => {
  const plan = basePlan({
    dependencies: [
      { gate_id: "gate-b", requires: ["gate-a"] },
      { gate_id: "gate-b", requires: ["gate-a"] },
    ],
  });
  assert.throws(() => validateAuthoritativePlan(plan), TypeError);
});

test("empty requires array is rejected", () => {
  const plan = basePlan({ dependencies: [{ gate_id: "gate-b", requires: [] }] });
  assert.throws(() => validateAuthoritativePlan(plan), TypeError);
});

test("unknown requires reference is rejected", () => {
  const plan = basePlan({ dependencies: [{ gate_id: "gate-b", requires: ["gate-z"] }] });
  assert.throws(() => validateAuthoritativePlan(plan), TypeError);
});

test("unknown dependency gate_id is rejected", () => {
  const plan = basePlan({ dependencies: [{ gate_id: "gate-z", requires: ["gate-a"] }] });
  assert.throws(() => validateAuthoritativePlan(plan), TypeError);
});

test("self dependency is rejected", () => {
  const plan = basePlan({ dependencies: [{ gate_id: "gate-a", requires: ["gate-a"] }] });
  assert.throws(() => validateAuthoritativePlan(plan), TypeError);
});

test("two-node cycle is rejected", () => {
  const plan = basePlan({
    dependencies: [
      { gate_id: "gate-a", requires: ["gate-b"] },
      { gate_id: "gate-b", requires: ["gate-a"] },
    ],
  });
  assert.throws(() => validateAuthoritativePlan(plan), TypeError);
});

test("longer cycle is rejected", () => {
  const plan = basePlan({
    gates: ["gate-a", "gate-b", "gate-c"],
    dependencies: [
      { gate_id: "gate-a", requires: ["gate-b"] },
      { gate_id: "gate-b", requires: ["gate-c"] },
      { gate_id: "gate-c", requires: ["gate-a"] },
    ],
  });
  assert.throws(() => validateAuthoritativePlan(plan), TypeError);
});

test("valid DAG is accepted", () => {
  const plan = basePlan({
    gates: ["gate-a", "gate-b", "gate-c"],
    dependencies: [
      { gate_id: "gate-b", requires: ["gate-a"] },
      { gate_id: "gate-c", requires: ["gate-a", "gate-b"] },
    ],
  });
  assert.doesNotThrow(() => validateAuthoritativePlan(plan));
});

// --- deep freeze / copy safety ---

test("mutating the input after validation does not affect the returned plan", () => {
  const input = basePlan();
  const validated = validateAuthoritativePlan(input);
  input.gates.push("gate-z");
  input.plan_id = "tampered";
  assert.deepEqual(validated.gates, ["gate-a", "gate-b", "gate-c"]);
  assert.equal(validated.plan_id, "plan-1");
});

test("returned plan is fully immutable", () => {
  const plan = validateAuthoritativePlan(basePlan());
  assert.throws(() => {
    plan.gates.push("gate-z");
  }, TypeError);
  assert.throws(() => {
    plan.plan_id = "tampered";
  }, TypeError);
});

// --- amendment_history validation ---

test("arbitrary amendment_history object is rejected", () => {
  const plan = basePlan({ amendment_history: [{ some: "junk" }] });
  assert.throws(() => validateAuthoritativePlan(plan), TypeError);
});

test("valid exact amendment_history record is accepted", () => {
  const plan = basePlan({
    amendment_history: [
      {
        proposal_id: "proposal-1",
        observed_plan_revision: 1,
        applied_plan_revision: 2,
        decision: "accept",
        reason: "ok",
      },
    ],
  });
  const validated = validateAuthoritativePlan(plan);
  assert.equal(validated.amendment_history.length, 1);
  assert.equal(validated.amendment_history[0].proposal_id, "proposal-1");
});

// --- proposal validation alone does not mutate any plan ---

test("validating a proposal does not apply or mutate the plan", () => {
  const plan = validateAuthoritativePlan(basePlan());
  const proposal = validatePlanAmendmentProposal(baseProposal());
  assert.equal(plan.plan_revision, 1);
  assert.equal(proposal.plan_id, "plan-1");
  // plan is untouched; nothing about validating the proposal changed it
  assert.deepEqual(validateAuthoritativePlan(basePlan()), plan);
});

// --- applySupervisorPlanAmendment ---

test("accept increments plan_revision exactly once and appends exactly one history record", () => {
  const plan = basePlan();
  const proposal = baseProposal();
  const review = baseReview({ decision: "accept" });
  const nextPlan = basePlan({
    plan_revision: 2,
    amendment_history: [
      {
        proposal_id: "proposal-1",
        observed_plan_revision: 1,
        applied_plan_revision: 2,
        decision: "accept",
        reason: "looks correct",
      },
    ],
  });

  const result = applySupervisorPlanAmendment(plan, proposal, review, nextPlan);
  assert.equal(result.plan_revision, 2);
  assert.equal(result.amendment_history.length, 1);
  assert.equal(result.amendment_history[0].applied_plan_revision, 2);
  assert.ok(Object.isFrozen(result));
});

test("modify increments plan_revision exactly once and appends exactly one history record", () => {
  const plan = basePlan();
  const proposal = baseProposal();
  const review = baseReview({ decision: "modify", reason: "adjusted" });
  const nextPlan = basePlan({
    plan_revision: 2,
    gates: ["gate-a", "gate-b", "gate-c", "gate-d"],
    blocked_gates: ["gate-b", "gate-c", "gate-d"],
    amendment_history: [
      {
        proposal_id: "proposal-1",
        observed_plan_revision: 1,
        applied_plan_revision: 2,
        decision: "modify",
        reason: "adjusted",
      },
    ],
  });

  const result = applySupervisorPlanAmendment(plan, proposal, review, nextPlan);
  assert.equal(result.plan_revision, 2);
  assert.deepEqual(result.gates, ["gate-a", "gate-b", "gate-c", "gate-d"]);
});

test("reject returns the current plan unchanged with no history append and no increment", () => {
  const plan = basePlan();
  const proposal = baseProposal();
  const review = baseReview({ decision: "reject", reason: "not needed" });

  const result = applySupervisorPlanAmendment(plan, proposal, review, undefined);
  const expected = validateAuthoritativePlan(plan);
  assert.deepEqual(result, expected);
  assert.equal(result.plan_revision, 1);
  assert.equal(result.amendment_history.length, 0);
});

test("stale proposal observed_plan_revision is rejected", () => {
  const plan = basePlan({ plan_revision: 2 });
  const proposal = baseProposal({ observed_plan_revision: 1 });
  const review = baseReview({ decision: "accept" });
  const nextPlan = basePlan({ plan_revision: 3 });
  assert.throws(() => applySupervisorPlanAmendment(plan, proposal, review, nextPlan), TypeError);
});

test("proposal plan_id mismatch is rejected", () => {
  const plan = basePlan({ plan_id: "plan-1" });
  const proposal = baseProposal({ plan_id: "plan-other" });
  const review = baseReview({ decision: "accept" });
  const nextPlan = basePlan({ plan_revision: 2 });
  assert.throws(() => applySupervisorPlanAmendment(plan, proposal, review, nextPlan), TypeError);
});

test("next_plan with mismatched plan_id is rejected", () => {
  const plan = basePlan();
  const proposal = baseProposal();
  const review = baseReview({ decision: "accept" });
  const nextPlan = basePlan({
    plan_id: "plan-other",
    plan_revision: 2,
    amendment_history: [
      {
        proposal_id: "proposal-1",
        observed_plan_revision: 1,
        applied_plan_revision: 2,
        decision: "accept",
        reason: "looks correct",
      },
    ],
  });
  assert.throws(() => applySupervisorPlanAmendment(plan, proposal, review, nextPlan), TypeError);
});

test("next_plan with plan_revision not exactly current + 1 is rejected", () => {
  const plan = basePlan();
  const proposal = baseProposal();
  const review = baseReview({ decision: "accept" });
  const nextPlan = basePlan({
    plan_revision: 3,
    amendment_history: [
      {
        proposal_id: "proposal-1",
        observed_plan_revision: 1,
        applied_plan_revision: 3,
        decision: "accept",
        reason: "looks correct",
      },
    ],
  });
  assert.throws(() => applySupervisorPlanAmendment(plan, proposal, review, nextPlan), TypeError);
});

test("tampered prior history entry is rejected", () => {
  const plan = basePlan({
    plan_revision: 2,
    amendment_history: [
      {
        proposal_id: "proposal-0",
        observed_plan_revision: 1,
        applied_plan_revision: 2,
        decision: "accept",
        reason: "first",
      },
    ],
  });
  const proposal = baseProposal({ proposal_id: "proposal-1", observed_plan_revision: 2 });
  const review = baseReview({ decision: "accept" });
  const nextPlan = basePlan({
    plan_revision: 3,
    amendment_history: [
      {
        proposal_id: "proposal-0-tampered",
        observed_plan_revision: 1,
        applied_plan_revision: 2,
        decision: "accept",
        reason: "first",
      },
      {
        proposal_id: "proposal-1",
        observed_plan_revision: 2,
        applied_plan_revision: 3,
        decision: "accept",
        reason: "looks correct",
      },
    ],
  });
  assert.throws(() => applySupervisorPlanAmendment(plan, proposal, review, nextPlan), TypeError);
});

test("tampered final history record is rejected", () => {
  const plan = basePlan();
  const proposal = baseProposal();
  const review = baseReview({ decision: "accept" });
  const nextPlan = basePlan({
    plan_revision: 2,
    amendment_history: [
      {
        proposal_id: "proposal-1",
        observed_plan_revision: 1,
        applied_plan_revision: 2,
        decision: "accept",
        reason: "a different reason",
      },
    ],
  });
  assert.throws(() => applySupervisorPlanAmendment(plan, proposal, review, nextPlan), TypeError);
});

test("missing extra history record beyond the expected final one is rejected", () => {
  const plan = basePlan();
  const proposal = baseProposal();
  const review = baseReview({ decision: "accept" });
  const nextPlan = basePlan({
    plan_revision: 2,
    amendment_history: [
      {
        proposal_id: "proposal-1",
        observed_plan_revision: 1,
        applied_plan_revision: 2,
        decision: "accept",
        reason: "looks correct",
      },
      {
        proposal_id: "proposal-extra",
        observed_plan_revision: 2,
        applied_plan_revision: 3,
        decision: "accept",
        reason: "extra",
      },
    ],
  });
  assert.throws(() => applySupervisorPlanAmendment(plan, proposal, review, nextPlan), TypeError);
});

// --- createWorkerPlanContext (progressive disclosure) ---

test("progressive disclosure returns exactly the specified keys", () => {
  const plan = basePlan();
  const context = createWorkerPlanContext(plan, "gate-a");
  assert.deepEqual(
    Object.keys(context).sort(),
    ["amendment_instruction", "blocked_downstream", "current_authorized_gate", "plan_revision"].sort(),
  );
});

test("progressive disclosure never leaks plan_id, gates, dependencies, or amendment_history", () => {
  const plan = basePlan();
  const context = createWorkerPlanContext(plan, "gate-a");
  assert.equal(context.plan_id, undefined);
  assert.equal(context.gates, undefined);
  assert.equal(context.dependencies, undefined);
  assert.equal(context.amendment_history, undefined);
});

test("progressive disclosure requires the gate to be authorized", () => {
  const plan = basePlan({ authorized_gates: [] });
  assert.throws(() => createWorkerPlanContext(plan, "gate-a"), TypeError);
});

test("progressive disclosure rejects a gate not present in the plan at all", () => {
  const plan = basePlan();
  assert.throws(() => createWorkerPlanContext(plan, "gate-z"), TypeError);
});

test("progressive disclosure exposes blocked_downstream in plan order", () => {
  const plan = basePlan({
    gates: ["gate-a", "gate-b", "gate-c", "gate-d"],
    dependencies: [],
    authorized_gates: ["gate-b"],
    blocked_gates: ["gate-c", "gate-d"],
  });
  const context = createWorkerPlanContext(plan, "gate-b");
  assert.deepEqual(context.blocked_downstream, ["gate-c", "gate-d"]);
  assert.equal(context.amendment_instruction, "If execution evidence reveals a missing dependency, submit PROPOSE_PLAN_AMENDMENT. Do not silently change the plan.");
});

test("progressive disclosure result is deep-frozen", () => {
  const plan = basePlan();
  const context = createWorkerPlanContext(plan, "gate-a");
  assert.ok(Object.isFrozen(context));
  assert.ok(Object.isFrozen(context.blocked_downstream));
  assert.throws(() => {
    context.blocked_downstream.push("gate-x");
  }, TypeError);
});

// --- createAuthoritativePlan convenience wrapper still works ---

test("createAuthoritativePlan builds a valid frozen plan with defaults", () => {
  const plan = createAuthoritativePlan({ plan_id: "plan-2", gates: ["gate-a"] });
  assert.equal(plan.plan_revision, 1);
  assert.deepEqual(plan.amendment_history, []);
  assert.ok(Object.isFrozen(plan));
});
