export const PLAN_ADMISSION_VALID = "PLAN_ADMISSION_VALID";
export const PLAN_ID_MISMATCH = "PLAN_ID_MISMATCH";
export const STALE_PLAN_REVISION = "STALE_PLAN_REVISION";
export const AUTHORIZED_GATE_MISMATCH = "AUTHORIZED_GATE_MISMATCH";

const IDENTITY_KEYS = Object.freeze(["plan_id", "plan_revision", "authorized_gate_id"]);

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

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function normalizeIdentity(identity, name) {
  assertExactKeys(identity, IDENTITY_KEYS, name);
  return {
    plan_id: requireTrimmedString(identity.plan_id, `${name}.plan_id`),
    plan_revision: requirePositiveSafeInteger(identity.plan_revision, `${name}.plan_revision`),
    authorized_gate_id: requireTrimmedString(identity.authorized_gate_id, `${name}.authorized_gate_id`),
  };
}

/**
 * Validate a candidate PlanAdmissionIdentity against the exact WNS schema:
 * strict {plan_id, plan_revision, authorized_gate_id} key set, trimmed
 * non-empty strings, positive safe integer revision. Returns a deep-frozen,
 * copy-safe identity. Throws on any structural violation.
 */
export function validatePlanAdmissionIdentity(identity) {
  const normalized = normalizeIdentity(identity, "identity");
  return deepFreeze(structuredClone(normalized));
}

/**
 * Compare a requested PlanAdmissionIdentity against the effective identity.
 * Purely mechanical field comparison: no dependency reasoning, no plan
 * graph, no worker/provider concepts. Both inputs are structurally
 * validated first (fail closed on malformed input), then compared in a
 * fixed precedence: plan_id, then plan_revision, then authorized_gate_id.
 * Returns a deep-frozen {admitted, reason_code} result.
 */
export function evaluatePlanAdmission(requested, effective) {
  const normalizedRequested = normalizeIdentity(requested, "requested");
  const normalizedEffective = normalizeIdentity(effective, "effective");

  let result;
  if (normalizedRequested.plan_id !== normalizedEffective.plan_id) {
    result = { admitted: false, reason_code: PLAN_ID_MISMATCH };
  } else if (normalizedRequested.plan_revision !== normalizedEffective.plan_revision) {
    result = { admitted: false, reason_code: STALE_PLAN_REVISION };
  } else if (normalizedRequested.authorized_gate_id !== normalizedEffective.authorized_gate_id) {
    result = { admitted: false, reason_code: AUTHORIZED_GATE_MISMATCH };
  } else {
    result = { admitted: true, reason_code: PLAN_ADMISSION_VALID };
  }

  return deepFreeze(result);
}
