import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PLAN_ADMISSION_VALID,
  PLAN_ID_MISMATCH,
  STALE_PLAN_REVISION,
  AUTHORIZED_GATE_MISMATCH,
  validatePlanAdmissionIdentity,
  evaluatePlanAdmission,
} from "./plan-admission.mjs";

function identity(overrides = {}) {
  return {
    plan_id: "plan-1",
    plan_revision: 1,
    authorized_gate_id: "gate-1",
    ...overrides,
  };
}

test("reason codes have exact spelling", () => {
  assert.equal(PLAN_ADMISSION_VALID, "PLAN_ADMISSION_VALID");
  assert.equal(PLAN_ID_MISMATCH, "PLAN_ID_MISMATCH");
  assert.equal(STALE_PLAN_REVISION, "STALE_PLAN_REVISION");
  assert.equal(AUTHORIZED_GATE_MISMATCH, "AUTHORIZED_GATE_MISMATCH");
});

test("happy path: identical identities admit", () => {
  const result = evaluatePlanAdmission(identity(), identity());
  assert.deepEqual(result, { admitted: true, reason_code: PLAN_ADMISSION_VALID });
});

test("plan_id mismatch alone", () => {
  const result = evaluatePlanAdmission(identity({ plan_id: "plan-2" }), identity());
  assert.deepEqual(result, { admitted: false, reason_code: PLAN_ID_MISMATCH });
});

test("plan_revision mismatch alone yields exact STALE_PLAN_REVISION", () => {
  const result = evaluatePlanAdmission(identity({ plan_revision: 2 }), identity());
  assert.deepEqual(result, { admitted: false, reason_code: "STALE_PLAN_REVISION" });
});

test("authorized_gate_id mismatch alone", () => {
  const result = evaluatePlanAdmission(identity({ authorized_gate_id: "gate-2" }), identity());
  assert.deepEqual(result, { admitted: false, reason_code: AUTHORIZED_GATE_MISMATCH });
});

test("precedence: plan_id mismatch wins over plan_revision and gate mismatch", () => {
  const requested = identity({ plan_id: "plan-2", plan_revision: 2, authorized_gate_id: "gate-2" });
  const result = evaluatePlanAdmission(requested, identity());
  assert.deepEqual(result, { admitted: false, reason_code: PLAN_ID_MISMATCH });
});

test("precedence: plan_revision mismatch wins over gate mismatch when plan_id matches", () => {
  const requested = identity({ plan_revision: 2, authorized_gate_id: "gate-2" });
  const result = evaluatePlanAdmission(requested, identity());
  assert.deepEqual(result, { admitted: false, reason_code: STALE_PLAN_REVISION });
});

test("validatePlanAdmissionIdentity accepts a well-formed identity", () => {
  const validated = validatePlanAdmissionIdentity(identity());
  assert.deepEqual(validated, identity());
});

test("validatePlanAdmissionIdentity rejects missing keys", () => {
  const { plan_id, ...rest } = identity();
  assert.throws(() => validatePlanAdmissionIdentity(rest), TypeError);
});

test("validatePlanAdmissionIdentity rejects extra keys", () => {
  assert.throws(() => validatePlanAdmissionIdentity(identity({ extra: "nope" })), TypeError);
});

test("validatePlanAdmissionIdentity rejects extra authority_epoch key", () => {
  assert.throws(() => validatePlanAdmissionIdentity(identity({ authority_epoch: 1 })), TypeError);
});

test("validatePlanAdmissionIdentity rejects non-positive or non-integer plan_revision", () => {
  assert.throws(() => validatePlanAdmissionIdentity(identity({ plan_revision: 0 })), TypeError);
  assert.throws(() => validatePlanAdmissionIdentity(identity({ plan_revision: -1 })), TypeError);
  assert.throws(() => validatePlanAdmissionIdentity(identity({ plan_revision: 1.5 })), TypeError);
  assert.throws(() => validatePlanAdmissionIdentity(identity({ plan_revision: "1" })), TypeError);
  assert.throws(() => validatePlanAdmissionIdentity(identity({ plan_revision: Number.MAX_SAFE_INTEGER + 1 })), TypeError);
});

test("validatePlanAdmissionIdentity rejects untrimmed or empty strings", () => {
  assert.throws(() => validatePlanAdmissionIdentity(identity({ plan_id: " plan-1" })), TypeError);
  assert.throws(() => validatePlanAdmissionIdentity(identity({ plan_id: "" })), TypeError);
  assert.throws(() => validatePlanAdmissionIdentity(identity({ authorized_gate_id: "gate-1 " })), TypeError);
});

test("validatePlanAdmissionIdentity returns a deep-frozen, copy-safe identity", () => {
  const input = identity();
  const validated = validatePlanAdmissionIdentity(input);
  assert.ok(Object.isFrozen(validated));
  assert.notEqual(validated, input);

  input.plan_id = "mutated";
  assert.equal(validated.plan_id, "plan-1");

  assert.throws(() => {
    "use strict";
    validated.plan_id = "mutated";
  }, TypeError);
});

test("evaluatePlanAdmission returns a deep-frozen result", () => {
  const result = evaluatePlanAdmission(identity(), identity());
  assert.ok(Object.isFrozen(result));
  assert.throws(() => {
    "use strict";
    result.admitted = false;
  }, TypeError);
});

test("evaluatePlanAdmission fails closed on malformed requested identity", () => {
  assert.throws(() => evaluatePlanAdmission(identity({ plan_revision: 0 }), identity()), TypeError);
});

test("evaluatePlanAdmission fails closed on malformed effective identity", () => {
  assert.throws(() => evaluatePlanAdmission(identity(), identity({ authorized_gate_id: "" })), TypeError);
});

test("evaluatePlanAdmission rejects an extra authority_epoch field on either side", () => {
  assert.throws(() => evaluatePlanAdmission(identity({ authority_epoch: 1 }), identity()), TypeError);
  assert.throws(() => evaluatePlanAdmission(identity(), identity({ authority_epoch: 1 })), TypeError);
});

test("evaluatePlanAdmission takes no dependency graph or worker/provider input", () => {
  // The function signature is (requested, effective) only: two plain identity
  // objects. There is no third argument for a dependency graph, worker
  // registry, or provider list, and passing extra arguments has no effect.
  const result = evaluatePlanAdmission(identity(), identity(), { dependency_graph: ["a", "b"] });
  assert.deepEqual(result, { admitted: true, reason_code: PLAN_ADMISSION_VALID });
  assert.equal(evaluatePlanAdmission.length, 2);
});
