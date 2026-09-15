import assert from "node:assert/strict";
import test from "node:test";
import {
  createAuthorizedHostEffectReceipt,
  createAuthorizedHostEffectResult,
  createAuthorizedHostEffectScope,
  validateAuthorizedHostEffectRequest,
  validateAuthorizedHostEffectResult,
} from "./authorized-host-effect.mjs";

function request(overrides = {}) {
  return {
    effect_request_version: 1,
    effect_id: "write-proof-1",
    task_id: "task-1",
    durable_attempt_id: "attempt-1",
    required_authority_epoch: 3,
    kind: "state.write",
    resource_ref: "state:proof",
    input: { content: "approved", options: { atomic: true } },
    ...overrides,
  };
}

test("HC1-M1 validates and freezes the exact provider-neutral effect request", () => {
  const input = request();
  const value = validateAuthorizedHostEffectRequest(input);
  assert.deepEqual(value, input);
  assert.notEqual(value, input);
  assert.ok(Object.isFrozen(value));
  assert.ok(Object.isFrozen(value.input.options));
  assert.equal(JSON.stringify(value).includes("provider"), false);
  assert.equal(JSON.stringify(value).includes("model"), false);
});

test("HC1-M1 request rejects missing/extra authority and execution fields", () => {
  const missing = request(); delete missing.effect_id;
  assert.throws(() => validateAuthorizedHostEffectRequest(missing), /missing required key/);
  for (const extra of [{ authorization_id: "worker-minted" }, { path: "/tmp/x" }, { executable: "sh" }, { provider: "vendor" }]) {
    assert.throws(() => validateAuthorizedHostEffectRequest({ ...request(), ...extra }), /unknown key/);
  }
});

test("HC1-M1 logical resource references reject paths, traversal, URIs, and whitespace", () => {
  for (const resource_ref of ["/absolute/path", "state:../escape", "state:folder/file", "https://example.test", " state:proof", "state:"]) {
    assert.throws(() => validateAuthorizedHostEffectRequest(request({ resource_ref })), /logical namespace:name reference|trimmed/);
  }
  assert.equal(validateAuthorizedHostEffectRequest(request({ resource_ref: "service:pi-worker_1" })).resource_ref, "service:pi-worker_1");
});

test("HC1-M1 input is bounded JSON and cannot smuggle runtime values", () => {
  assert.throws(() => validateAuthorizedHostEffectRequest(request({ input: [] })), /plain object/);
  assert.throws(() => validateAuthorizedHostEffectRequest(request({ input: { callback() {} } })), /JSON values only/);
  assert.throws(() => validateAuthorizedHostEffectRequest(request({ input: { unsafe: Number.MAX_SAFE_INTEGER + 1 } })), /safe integers/);
  let deep = true;
  for (let index = 0; index < 10; index += 1) deep = { child: deep };
  assert.throws(() => validateAuthorizedHostEffectRequest(request({ input: { deep } })), /nesting depth/);
});

test("HC1-M1 one existing authority scope binds the exact effect, identity, and input", () => {
  const first = createAuthorizedHostEffectScope(request());
  assert.match(first, /^host_effect:sha256:[0-9a-f]{64}$/);
  assert.equal(createAuthorizedHostEffectScope(request()), first);
  for (const changed of [
    request({ effect_id: "write-proof-2" }),
    request({ durable_attempt_id: "attempt-2" }),
    request({ required_authority_epoch: 4 }),
    request({ kind: "state.read" }),
    request({ resource_ref: "state:other" }),
    request({ input: { content: "different" } }),
  ]) assert.notEqual(createAuthorizedHostEffectScope(changed), first);
});

test("HC1-M1 receipt identity is deterministic and its digest binds the full request", () => {
  const first = createAuthorizedHostEffectReceipt(request());
  assert.match(first.ref, /^host-effect:[0-9a-f]{64}$/);
  assert.match(first.digest, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(createAuthorizedHostEffectReceipt(request()), first);
  assert.equal(createAuthorizedHostEffectReceipt(request({ input: { content: "different" } })).ref, first.ref);
  assert.notEqual(createAuthorizedHostEffectReceipt(request({ input: { content: "different" } })).digest, first.digest);
});

test("HC1-M1 result makes FAILED versus OUTCOME_UNKNOWN explicit", () => {
  const failed = createAuthorizedHostEffectResult({ effect_id: "e1", status: "FAILED", reason_code: "authority_absent", receipt: null, evidence_ref: null, reconciled: false });
  const unknown = createAuthorizedHostEffectResult({ effect_id: "e1", status: "OUTCOME_UNKNOWN", reason_code: "effect_outcome_unknown", receipt: null, evidence_ref: null, reconciled: false });
  assert.equal(failed.status, "FAILED");
  assert.equal(unknown.status, "OUTCOME_UNKNOWN");
  assert.notDeepEqual(failed, unknown);
});

test("HC1-M1 successful and reconciled results require exact durable receipt/result shapes", () => {
  const receipt = createAuthorizedHostEffectReceipt(request());
  const result = createAuthorizedHostEffectResult({ effect_id: "write-proof-1", status: "SUCCEEDED", reason_code: "effect_succeeded", receipt, evidence_ref: "evidence:proof", reconciled: true });
  assert.equal(validateAuthorizedHostEffectResult(result).reconciled, true);
  assert.ok(Object.isFrozen(result.receipt));
  assert.throws(() => createAuthorizedHostEffectResult({ ...result, receipt: null }), /requires a durable receipt/);
  assert.throws(() => validateAuthorizedHostEffectResult({ ...result, extra: true }), /unknown key/);
});
