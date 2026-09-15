import { createHash } from "node:crypto";

export const AUTHORIZED_HOST_EFFECT_REQUEST_VERSION = 1;
export const AUTHORIZED_HOST_EFFECT_RESULT_VERSION = 1;
export const AUTHORIZED_HOST_EFFECT_STATUSES = Object.freeze(["SUCCEEDED", "FAILED", "OUTCOME_UNKNOWN"]);

const REQUEST_KEYS = Object.freeze([
  "effect_request_version", "effect_id", "task_id", "durable_attempt_id",
  "required_authority_epoch", "kind", "resource_ref", "input",
]);
const RESULT_KEYS = Object.freeze([
  "effect_result_version", "effect_id", "status", "reason_code",
  "receipt", "evidence_ref", "reconciled",
]);
const RECEIPT_KEYS = Object.freeze(["ref", "digest"]);
const MAX_INPUT_BYTES = 16 * 1024;
const MAX_INPUT_DEPTH = 8;
const MAX_COLLECTION_ITEMS = 128;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function assertExactKeys(value, keys, label) {
  if (!isPlainObject(value)) throw new TypeError(`${label} must be a plain object`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new TypeError(`${label} has an unknown key: ${key}`);
  for (const key of keys) if (!Object.hasOwn(value, key)) throw new TypeError(`${label} is missing required key: ${key}`);
}

function requireTrimmedString(value, label, maxLength = 200) {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength || value.trim() !== value || value.includes("\0")) {
    throw new TypeError(`${label} must be a trimmed, non-empty, bounded NUL-free string`);
  }
  return value;
}

function requirePositiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} must be a positive safe integer`);
  return value;
}

export function validateHostEffectKind(value, label = "kind") {
  requireTrimmedString(value, label, 80);
  if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(value)) {
    throw new TypeError(`${label} must be a lowercase capability token`);
  }
  return value;
}

export function validateLogicalResourceRef(value, label = "resource_ref") {
  requireTrimmedString(value, label, 160);
  if (!/^[a-z][a-z0-9_-]{0,31}:[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new TypeError(`${label} must be a logical namespace:name reference`);
  }
  return value;
}

function normalizeJson(value, label, depth = 0) {
  if (depth > MAX_INPUT_DEPTH) throw new TypeError(`${label} exceeds the maximum nesting depth`);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.length > 4096 || value.includes("\0")) throw new TypeError(`${label} contains an invalid string`);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new TypeError(`${label} numbers must be safe integers`);
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_COLLECTION_ITEMS) throw new TypeError(`${label} contains too many items`);
    return value.map((item, index) => normalizeJson(item, `${label}[${index}]`, depth + 1));
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length > MAX_COLLECTION_ITEMS) throw new TypeError(`${label} contains too many properties`);
    const normalized = {};
    for (const key of keys.sort()) {
      if (key.length === 0 || key.length > 120 || key.includes("\0") || key === "__proto__") throw new TypeError(`${label} contains an invalid property name`);
      normalized[key] = normalizeJson(value[key], `${label}.${key}`, depth + 1);
    }
    return normalized;
  }
  throw new TypeError(`${label} must contain JSON values only`);
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

export function validateAuthorizedHostEffectRequest(value) {
  assertExactKeys(value, REQUEST_KEYS, "effect request");
  if (value.effect_request_version !== AUTHORIZED_HOST_EFFECT_REQUEST_VERSION) throw new TypeError("effect_request_version is unsupported");
  const request = {
    effect_request_version: AUTHORIZED_HOST_EFFECT_REQUEST_VERSION,
    effect_id: requireTrimmedString(value.effect_id, "effect_id"),
    task_id: requireTrimmedString(value.task_id, "task_id"),
    durable_attempt_id: requireTrimmedString(value.durable_attempt_id, "durable_attempt_id"),
    required_authority_epoch: requirePositiveSafeInteger(value.required_authority_epoch, "required_authority_epoch"),
    kind: validateHostEffectKind(value.kind),
    resource_ref: validateLogicalResourceRef(value.resource_ref),
    input: normalizeJson(value.input, "input"),
  };
  if (!isPlainObject(request.input)) throw new TypeError("input must be a plain object");
  if (Buffer.byteLength(JSON.stringify(request.input), "utf8") > MAX_INPUT_BYTES) throw new TypeError("input exceeds the maximum serialized size");
  return deepFreeze(structuredClone(request));
}

export function createAuthorizedHostEffectScope(value) {
  const request = validateAuthorizedHostEffectRequest(value);
  return `host_effect:sha256:${sha256(request)}`;
}

export function createAuthorizedHostEffectReceipt(value) {
  const request = validateAuthorizedHostEffectRequest(value);
  const identity = { task_id: request.task_id, durable_attempt_id: request.durable_attempt_id, effect_id: request.effect_id };
  return deepFreeze({ ref: `host-effect:${sha256(identity)}`, digest: `sha256:${sha256(request)}` });
}

function normalizeReceipt(value) {
  if (value === null) return null;
  assertExactKeys(value, RECEIPT_KEYS, "effect result receipt");
  const ref = validateLogicalResourceRef(value.ref, "effect result receipt.ref");
  if (typeof value.digest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value.digest)) {
    throw new TypeError("effect result receipt.digest must be a sha256 digest");
  }
  return { ref, digest: value.digest };
}

export function validateAuthorizedHostEffectResult(value) {
  assertExactKeys(value, RESULT_KEYS, "effect result");
  if (value.effect_result_version !== AUTHORIZED_HOST_EFFECT_RESULT_VERSION) throw new TypeError("effect_result_version is unsupported");
  const status = value.status;
  if (!AUTHORIZED_HOST_EFFECT_STATUSES.includes(status)) throw new TypeError("effect result status is unsupported");
  const receipt = normalizeReceipt(value.receipt);
  if (status === "SUCCEEDED" && receipt === null) throw new TypeError("a SUCCEEDED effect result requires a durable receipt");
  const reasonCode = requireTrimmedString(value.reason_code, "effect result reason_code", 120);
  if (!/^[a-z][a-z0-9_]*$/.test(reasonCode)) throw new TypeError("effect result reason_code must be a lowercase reason token");
  if (value.evidence_ref !== null) validateLogicalResourceRef(value.evidence_ref, "effect result evidence_ref");
  if (typeof value.reconciled !== "boolean") throw new TypeError("effect result reconciled must be boolean");
  return deepFreeze({
    effect_result_version: AUTHORIZED_HOST_EFFECT_RESULT_VERSION,
    effect_id: requireTrimmedString(value.effect_id, "effect result effect_id"),
    status,
    reason_code: reasonCode,
    receipt,
    evidence_ref: value.evidence_ref,
    reconciled: value.reconciled,
  });
}

export function createAuthorizedHostEffectResult(value) {
  return validateAuthorizedHostEffectResult({ effect_result_version: AUTHORIZED_HOST_EFFECT_RESULT_VERSION, ...value });
}
