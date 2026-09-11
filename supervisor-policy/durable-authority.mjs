export const AUTHORITY_PROJECTION_VERSION = 1;

// Minimal, worker-neutral scope token for this gate. Deliberately not a
// broader permission taxonomy: recovery-driven continuation only ever needs
// to know that resuming the bound task/attempt is authorized.
export const RESUME_TASK_SCOPE = "resume_task";

export const AUTHORITY_STATUSES = Object.freeze(["active", "revoked", "expired"]);

export const AUTHORITY_DECISIONS = Object.freeze({
  AUTHORIZED: "authorized",
  HUMAN_REQUIRED: "human_required",
});

export const AUTHORITY_REASON_CODES = Object.freeze({
  ABSENT: "authority_absent",
  TASK_MISMATCH: "task_mismatch",
  ATTEMPT_MISMATCH: "attempt_mismatch",
  EPOCH_MISMATCH: "epoch_mismatch",
  REVOKED: "authority_revoked",
  EXPIRED: "authority_expired",
  SCOPE_EXCEEDED: "scope_exceeded",
  VALID: "authority_valid",
});

const RECORD_KEYS = Object.freeze([
  "authority_version", "authority_id", "task_id", "durable_attempt_id", "authority_epoch",
  "scope", "status", "granted_at", "expires_at", "revoked_at", "provenance",
]);
const PROVENANCE_KEYS = Object.freeze(["receipt_ref", "granted_by"]);
const REQUEST_KEYS = Object.freeze([
  "task_id", "durable_attempt_id", "required_authority_epoch", "requested_scope", "evaluated_at",
]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function assertExactKeys(value, requiredKeys, name) {
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

function isCanonicalIso(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}

function requireCanonicalIso(value, name) {
  if (!isCanonicalIso(value)) throw new TypeError(`${name} must be a canonical ISO-8601 timestamp string`);
  return value;
}

function requireCanonicalIsoOrNull(value, name) {
  if (value === null) return null;
  return requireCanonicalIso(value, name);
}

function requirePositiveSafeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be a positive safe integer`);
  return value;
}

function requireUniqueScope(value, name) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${name} must be a non-empty array`);
  const tokens = value.map((token, index) => requireTrimmedString(token, `${name}[${index}]`));
  if (new Set(tokens).size !== tokens.length) throw new TypeError(`${name} must not contain duplicate tokens`);
  return tokens;
}

function normalizeRecord(record) {
  if (record === null || record === undefined) return null;
  if (!isPlainObject(record)) throw new TypeError("record must be a plain object or null");
  assertExactKeys(record, RECORD_KEYS, "record");
  if (record.authority_version !== 1) throw new TypeError("record.authority_version must be 1");
  requireTrimmedString(record.authority_id, "record.authority_id");
  requireTrimmedString(record.task_id, "record.task_id");
  requireTrimmedString(record.durable_attempt_id, "record.durable_attempt_id");
  requirePositiveSafeInteger(record.authority_epoch, "record.authority_epoch");
  requireUniqueScope(record.scope, "record.scope");
  if (!AUTHORITY_STATUSES.includes(record.status)) throw new TypeError(`record.status must be one of: ${AUTHORITY_STATUSES.join(", ")}`);
  requireCanonicalIso(record.granted_at, "record.granted_at");
  requireCanonicalIsoOrNull(record.expires_at, "record.expires_at");
  requireCanonicalIsoOrNull(record.revoked_at, "record.revoked_at");
  if (!isPlainObject(record.provenance)) throw new TypeError("record.provenance must be a plain object");
  assertExactKeys(record.provenance, PROVENANCE_KEYS, "record.provenance");
  requireTrimmedString(record.provenance.receipt_ref, "record.provenance.receipt_ref");
  if (!["human", "policy"].includes(record.provenance.granted_by)) {
    throw new TypeError("record.provenance.granted_by must be 'human' or 'policy'");
  }
  return record;
}

function normalizeRequest(request) {
  if (!isPlainObject(request)) throw new TypeError("request must be a plain object");
  assertExactKeys(request, REQUEST_KEYS, "request");
  requireTrimmedString(request.task_id, "request.task_id");
  requireTrimmedString(request.durable_attempt_id, "request.durable_attempt_id");
  requirePositiveSafeInteger(request.required_authority_epoch, "request.required_authority_epoch");
  requireUniqueScope(request.requested_scope, "request.requested_scope");
  requireCanonicalIso(request.evaluated_at, "request.evaluated_at");
  return request;
}

function decision(outcome, reasonCode) {
  return Object.freeze({ decision: outcome, reason_code: reasonCode });
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/**
 * Validate and return a deep-frozen, copy-safe AuthorityRecord (or null).
 * Throws on any structural violation. Never mutates the input.
 */
export function validateAuthorityRecord(record) {
  const normalized = normalizeRecord(record);
  return normalized === null ? null : deepFreeze(structuredClone(normalized));
}

/**
 * Validate and return a deep-frozen, copy-safe EvaluationRequest.
 * Throws on any structural violation. Never mutates the input.
 */
export function validateEvaluationRequest(request) {
  return deepFreeze(structuredClone(normalizeRequest(request)));
}

/**
 * Pure, deterministic evaluation of durable authority for a fresh-session
 * request. Never inspects chat transcript content; absence of original
 * authorization text is not itself a factor.
 */
export function evaluateDurableAuthority(record, request) {
  const normalizedRecord = normalizeRecord(record);
  const normalizedRequest = normalizeRequest(request);

  if (normalizedRecord === null) return decision(AUTHORITY_DECISIONS.HUMAN_REQUIRED, AUTHORITY_REASON_CODES.ABSENT);
  if (normalizedRecord.task_id !== normalizedRequest.task_id) {
    return decision(AUTHORITY_DECISIONS.HUMAN_REQUIRED, AUTHORITY_REASON_CODES.TASK_MISMATCH);
  }
  if (normalizedRecord.durable_attempt_id !== normalizedRequest.durable_attempt_id) {
    return decision(AUTHORITY_DECISIONS.HUMAN_REQUIRED, AUTHORITY_REASON_CODES.ATTEMPT_MISMATCH);
  }
  if (normalizedRecord.authority_epoch !== normalizedRequest.required_authority_epoch) {
    return decision(AUTHORITY_DECISIONS.HUMAN_REQUIRED, AUTHORITY_REASON_CODES.EPOCH_MISMATCH);
  }

  const evaluatedAt = Date.parse(normalizedRequest.evaluated_at);
  if (normalizedRecord.status === "revoked" || (normalizedRecord.revoked_at !== null && Date.parse(normalizedRecord.revoked_at) <= evaluatedAt)) {
    return decision(AUTHORITY_DECISIONS.HUMAN_REQUIRED, AUTHORITY_REASON_CODES.REVOKED);
  }
  if (normalizedRecord.status === "expired" || (normalizedRecord.expires_at !== null && Date.parse(normalizedRecord.expires_at) <= evaluatedAt)) {
    return decision(AUTHORITY_DECISIONS.HUMAN_REQUIRED, AUTHORITY_REASON_CODES.EXPIRED);
  }
  if (!normalizedRequest.requested_scope.every((token) => normalizedRecord.scope.includes(token))) {
    return decision(AUTHORITY_DECISIONS.HUMAN_REQUIRED, AUTHORITY_REASON_CODES.SCOPE_EXCEEDED);
  }

  return decision(AUTHORITY_DECISIONS.AUTHORIZED, AUTHORITY_REASON_CODES.VALID);
}

/**
 * WNS-owned helper: validates + evaluates a record/request pair and returns
 * a deep-frozen, copy-safe, strictly versioned projection of exactly
 * `{ projection_version, record, request, evaluation }`. No transcript
 * field exists anywhere in this shape. This is the only artifact a
 * mechanical Host may forward to a fresh worker/session as the authoritative
 * policy result; the Host must not synthesize this object itself.
 */
export function createAuthorityProjection(record, request) {
  const normalizedRecord = validateAuthorityRecord(record);
  const normalizedRequest = validateEvaluationRequest(request);
  const evaluation = evaluateDurableAuthority(normalizedRecord, normalizedRequest);
  return deepFreeze({
    projection_version: AUTHORITY_PROJECTION_VERSION,
    record: normalizedRecord,
    request: normalizedRequest,
    evaluation,
  });
}
