import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateDurableAuthority,
  createAuthorityProjection,
  validateAuthorityRecord,
  validateEvaluationRequest,
  RESUME_TASK_SCOPE,
  AUTHORITY_PROJECTION_VERSION,
} from "./durable-authority.mjs";

function record(overrides = {}) {
  return {
    authority_version: 1,
    authority_id: "authority:1",
    task_id: "task-1",
    durable_attempt_id: "attempt-1",
    authority_epoch: 1,
    scope: ["execute_gate", "spawn_worker"],
    status: "active",
    granted_at: "2026-09-01T00:00:00.000Z",
    expires_at: null,
    revoked_at: null,
    provenance: { receipt_ref: "receipt:chat-1", granted_by: "human" },
    ...overrides,
  };
}

function request(overrides = {}) {
  return {
    task_id: "task-1",
    durable_attempt_id: "attempt-1",
    required_authority_epoch: 1,
    requested_scope: ["execute_gate"],
    evaluated_at: "2026-09-11T00:00:00.000Z",
    ...overrides,
  };
}

test("a still-valid record authorizes a fresh session with no chat text present", () => {
  const outcome = evaluateDurableAuthority(record(), request());
  assert.equal(outcome.decision, "authorized");
  assert.equal(outcome.reason_code, "authority_valid");
});

test("absent record requires human", () => {
  const outcome = evaluateDurableAuthority(null, request());
  assert.equal(outcome.decision, "human_required");
  assert.equal(outcome.reason_code, "authority_absent");
});

test("task, attempt, and epoch binding are each enforced independently", () => {
  assert.equal(evaluateDurableAuthority(record(), request({ task_id: "task-2" })).reason_code, "task_mismatch");
  assert.equal(evaluateDurableAuthority(record(), request({ durable_attempt_id: "attempt-2" })).reason_code, "attempt_mismatch");
  assert.equal(evaluateDurableAuthority(record(), request({ required_authority_epoch: 2 })).reason_code, "epoch_mismatch");
  assert.equal(evaluateDurableAuthority(record({ authority_epoch: 2 }), request({ required_authority_epoch: 2 })).decision, "authorized");
});

test("explicit revocation, by status or timestamp, requires human even before expiry", () => {
  assert.equal(evaluateDurableAuthority(record({ status: "revoked" }), request()).reason_code, "authority_revoked");
  assert.equal(evaluateDurableAuthority(record({ revoked_at: "2026-09-05T00:00:00.000Z" }), request()).reason_code, "authority_revoked");
  assert.equal(evaluateDurableAuthority(record({ revoked_at: "2026-09-20T00:00:00.000Z" }), request()).decision, "authorized");
});

test("expiry is evaluated against evaluated_at, not wall clock", () => {
  const expiring = record({ expires_at: "2026-09-10T00:00:00.000Z" });
  assert.equal(evaluateDurableAuthority(expiring, request({ evaluated_at: "2026-09-11T00:00:00.000Z" })).reason_code, "authority_expired");
  assert.equal(evaluateDurableAuthority(expiring, request({ evaluated_at: "2026-09-09T00:00:00.000Z" })).decision, "authorized");
});

test("status='expired' requires human like an expired timestamp, even with no expires_at set", () => {
  const outcome = evaluateDurableAuthority(record({ status: "expired", expires_at: null }), request());
  assert.equal(outcome.decision, "human_required");
  assert.equal(outcome.reason_code, "authority_expired");
});

test("requested scope beyond the grant requires human even when otherwise valid", () => {
  const outcome = evaluateDurableAuthority(record(), request({ requested_scope: ["execute_gate", "delete_repository"] }));
  assert.equal(outcome.decision, "human_required");
  assert.equal(outcome.reason_code, "scope_exceeded");
});

test("evaluation never requires or inspects any chat/transcript field, and rejects one if smuggled in", () => {
  const outcome = evaluateDurableAuthority(record(), request());
  assert.equal(outcome.decision, "authorized");
  assert.throws(
    () => evaluateDurableAuthority(record(), { ...request(), chat_transcript: "original human message" }),
    /unknown key/,
  );
});

test("evaluation is deterministic, idempotent, and does not mutate inputs", () => {
  const r = record();
  const q = request();
  const before = structuredClone({ r, q });
  const first = evaluateDurableAuthority(r, q);
  assert.deepEqual(evaluateDurableAuthority(r, q), first);
  assert.deepEqual({ r, q }, before);
});

test("record and request reject both missing and extra keys at every object level", () => {
  const { scope, ...recordMissingScope } = record();
  assert.throws(() => evaluateDurableAuthority(recordMissingScope, request()), /missing required key: scope/);
  assert.throws(() => evaluateDurableAuthority({ ...record(), extra: true }, request()), /unknown key: extra/);
  const { receipt_ref, ...provenanceMissing } = record().provenance;
  assert.throws(() => evaluateDurableAuthority(record({ provenance: provenanceMissing }), request()), /missing required key: receipt_ref/);
  assert.throws(() => evaluateDurableAuthority(record({ provenance: { ...record().provenance, extra: true } }), request()), /unknown key: extra/);
  const { task_id, ...requestMissingTask } = request();
  assert.throws(() => evaluateDurableAuthority(record(), requestMissingTask), /missing required key: task_id/);
  assert.throws(() => evaluateDurableAuthority(record(), { ...request(), extra: true }), /unknown key: extra/);
});

test("string fields must be trimmed and non-empty", () => {
  for (const bad of ["", " ", "task-1 ", " task-1"]) {
    assert.throws(() => evaluateDurableAuthority(record({ task_id: bad }), request()), TypeError);
  }
});

test("scope tokens must be unique and non-empty", () => {
  assert.throws(() => evaluateDurableAuthority(record({ scope: [] }), request()), /non-empty array/);
  assert.throws(() => evaluateDurableAuthority(record({ scope: ["execute_gate", "execute_gate"] }), request()), /duplicate/);
  assert.throws(() => evaluateDurableAuthority(record(), request({ requested_scope: ["execute_gate", "execute_gate"] })), /duplicate/);
});

test("authority_epoch and required_authority_epoch must be positive safe integers", () => {
  for (const bad of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1"]) {
    assert.throws(() => evaluateDurableAuthority(record({ authority_epoch: bad }), request()), TypeError);
    assert.throws(() => evaluateDurableAuthority(record(), request({ required_authority_epoch: bad })), TypeError);
  }
});

test("granted_at must be a non-null canonical ISO timestamp; expires_at/revoked_at/evaluated_at reject non-canonical forms when present", () => {
  assert.throws(() => evaluateDurableAuthority(record({ granted_at: null }), request()), TypeError);
  assert.throws(() => evaluateDurableAuthority(record({ granted_at: "2026-09-01T00:00:00Z" }), request()), TypeError);
  assert.throws(() => evaluateDurableAuthority(record({ expires_at: "2026-09-10T00:00:00+00:00" }), request()), TypeError);
  assert.throws(() => evaluateDurableAuthority(record({ revoked_at: "not-a-date" }), request()), TypeError);
  assert.throws(() => evaluateDurableAuthority(record(), request({ evaluated_at: "2026-09-11" })), TypeError);
  assert.equal(evaluateDurableAuthority(record({ expires_at: null, revoked_at: null }), request()).decision, "authorized");
});

test("malformed records and requests are rejected", () => {
  assert.throws(() => evaluateDurableAuthority(record({ authority_epoch: 0 }), request()), TypeError);
  assert.throws(() => evaluateDurableAuthority(record({ scope: [] }), request()), TypeError);
  assert.throws(() => evaluateDurableAuthority(record({ status: "bogus" }), request()), TypeError);
  assert.throws(() => evaluateDurableAuthority(record(), request({ required_authority_epoch: 0 })), TypeError);
  assert.throws(() => evaluateDurableAuthority(record(), {}), TypeError);
});

test("RESUME_TASK_SCOPE is the minimal generic resume scope token", () => {
  assert.equal(RESUME_TASK_SCOPE, "resume_task");
});

test("validateAuthorityRecord returns a deep-frozen copy-safe record, and null passes through", () => {
  const input = record();
  const validated = validateAuthorityRecord(input);
  assert.deepEqual(validated, input);
  assert.notEqual(validated, input);
  assert.ok(Object.isFrozen(validated));
  assert.ok(Object.isFrozen(validated.provenance));
  input.task_id = "mutated";
  assert.equal(validated.task_id, "task-1");
  assert.equal(validateAuthorityRecord(null), null);
});

test("validateEvaluationRequest returns a deep-frozen copy-safe request", () => {
  const input = request();
  const validated = validateEvaluationRequest(input);
  assert.deepEqual(validated, input);
  assert.notEqual(validated, input);
  assert.ok(Object.isFrozen(validated));
  input.task_id = "mutated";
  assert.equal(validated.task_id, "task-1");
});

test("createAuthorityProjection produces the exact versioned shape with no transcript field", () => {
  const projection = createAuthorityProjection(record(), request());
  assert.deepEqual(Object.keys(projection).sort(), ["evaluation", "projection_version", "record", "request"]);
  assert.equal(projection.projection_version, AUTHORITY_PROJECTION_VERSION);
  assert.deepEqual(projection.record, record());
  assert.deepEqual(projection.request, request());
  assert.deepEqual(projection.evaluation, { decision: "authorized", reason_code: "authority_valid" });
  assert.ok(Object.isFrozen(projection));
  assert.ok(Object.isFrozen(projection.record));
  assert.ok(Object.isFrozen(projection.evaluation));
});

test("createAuthorityProjection carries human_required decisions through unchanged", () => {
  const projection = createAuthorityProjection(null, request());
  assert.equal(projection.record, null);
  assert.deepEqual(projection.evaluation, { decision: "human_required", reason_code: "authority_absent" });
});

test("createAuthorityProjection validates inputs and throws on malformed record/request, same as the evaluator", () => {
  assert.throws(() => createAuthorityProjection(record({ authority_epoch: 0 }), request()), TypeError);
  assert.throws(() => createAuthorityProjection(record(), { ...request(), chat_transcript: "x" }), /unknown key/);
});

test("createAuthorityProjection is deterministic and does not mutate inputs", () => {
  const r = record();
  const q = request();
  const before = structuredClone({ r, q });
  const first = createAuthorityProjection(r, q);
  assert.deepEqual(createAuthorityProjection(r, q), first);
  assert.deepEqual({ r, q }, before);
});
