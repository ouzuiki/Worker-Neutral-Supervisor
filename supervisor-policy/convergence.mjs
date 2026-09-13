// Worker-neutral semantic-convergence structural helper.
//
// Pure and deterministic: no I/O, no clocks, no randomness, no input mutation.
// It models current-state semantic convergence (authoritative intent vs observed
// reality), Finding normalization, Finding -> candidate residual work item
// conversion, and evaluation of a derived convergence certificate.
//
// This module is NOT a workflow engine, datastore, Host/Bridge component, or a
// task-close authority. `supervisor-policy/completion-gate.mjs` remains the final
// close authority. See `worker-neutral/convergence/contract.v0.json`.

export const GAP_TYPES = Object.freeze(["missing", "partial", "contradicts", "unrequested"]);
export const SEVERITIES = Object.freeze(["critical", "high", "medium", "low"]);
export const FINDING_STATUSES = Object.freeze(["open", "resolved", "superseded"]);
export const FINDING_VERIFIER_ROLES = Object.freeze([
  "supervisor",
  "independent_verifier",
  "executor",
]);
export const CERTIFICATE_VERIFIER_ROLES = Object.freeze(["supervisor", "independent_verifier"]);
export const COVERAGE_STATES = Object.freeze(["complete", "partial", "unknown"]);
export const VERDICTS = Object.freeze(["converged", "not_converged"]);

const GAP_TYPE_SET = new Set(GAP_TYPES);
const SEVERITY_SET = new Set(SEVERITIES);
const FINDING_STATUS_SET = new Set(FINDING_STATUSES);
const FINDING_VERIFIER_ROLE_SET = new Set(FINDING_VERIFIER_ROLES);
const CERTIFICATE_VERIFIER_ROLE_SET = new Set(CERTIFICATE_VERIFIER_ROLES);
const COVERAGE_SET = new Set(COVERAGE_STATES);
const VERDICT_SET = new Set(VERDICTS);

const FINDING_FIELDS = Object.freeze([
  "finding_id",
  "source_ref",
  "gap_type",
  "severity",
  "evidence",
  "remediation",
  "verifier",
  "status",
]);
const VERIFIER_FIELDS = Object.freeze(["role", "id"]);
const CERTIFICATE_FIELDS = Object.freeze([
  "certificate_version",
  "task_id",
  "intent_refs",
  "verification_scope",
  "finding_refs",
  "open_finding_ids",
  "evidence_refs",
  "verifier",
  "verdict",
]);
const SCOPE_FIELDS = Object.freeze(["coverage", "source_refs"]);

function requirePlainObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function requireExactKeys(value, allowed, label) {
  const keys = Object.keys(value);
  for (const key of keys) {
    if (!allowed.includes(key)) {
      throw new TypeError(`${label} has unknown key: ${key}`);
    }
  }
  for (const key of allowed) {
    if (!Object.hasOwn(value, key)) {
      throw new TypeError(`${label} is missing required key: ${key}`);
    }
  }
  return value;
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function requireStringArray(value, label, { nonEmpty = false } = {}) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array`);
  }
  if (nonEmpty && value.length === 0) {
    throw new TypeError(`${label} must not be empty`);
  }
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0) {
      throw new TypeError(`${label} entries must be non-empty strings`);
    }
  }
  return value.slice();
}

function requireUniqueStringArray(value, label, { nonEmpty = false } = {}) {
  const entries = requireStringArray(value, label, { nonEmpty });
  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry)) {
      throw new TypeError(`${label} has duplicate entry: ${entry}`);
    }
    seen.add(entry);
  }
  return entries;
}

function requireEnum(value, set, label) {
  if (typeof value !== "string" || !set.has(value)) {
    throw new TypeError(`${label} has an invalid value: ${String(value)}`);
  }
  return value;
}

function normalizeVerifier(verifier, roleSet, label) {
  const value = requirePlainObject(verifier, label);
  requireExactKeys(value, VERIFIER_FIELDS, label);
  return Object.freeze({
    role: requireEnum(value.role, roleSet, `${label}.role`),
    id: requireNonEmptyString(value.id, `${label}.id`),
  });
}

function sameStringSet(a, b) {
  if (a.length !== b.length) return false;
  const seen = new Set(a);
  if (seen.size !== a.length) return false;
  for (const entry of b) {
    if (!seen.has(entry)) return false;
  }
  return seen.size === new Set([...a, ...b]).size;
}

export function normalizeFinding(finding) {
  const value = requirePlainObject(finding, "finding");
  requireExactKeys(value, FINDING_FIELDS, "finding");

  const evidence = requireStringArray(value.evidence, "finding.evidence", { nonEmpty: true });

  return Object.freeze({
    finding_id: requireNonEmptyString(value.finding_id, "finding.finding_id"),
    source_ref: requireNonEmptyString(value.source_ref, "finding.source_ref"),
    gap_type: requireEnum(value.gap_type, GAP_TYPE_SET, "finding.gap_type"),
    severity: requireEnum(value.severity, SEVERITY_SET, "finding.severity"),
    evidence: Object.freeze(evidence),
    remediation: requireNonEmptyString(value.remediation, "finding.remediation"),
    verifier: normalizeVerifier(value.verifier, FINDING_VERIFIER_ROLE_SET, "finding.verifier"),
    status: requireEnum(value.status, FINDING_STATUS_SET, "finding.status"),
  });
}

export function findingToResidualWorkItem(finding) {
  const normalized = normalizeFinding(finding);
  if (normalized.status !== "open") {
    throw new TypeError("residual work item conversion is only allowed for an open finding");
  }
  return Object.freeze({
    finding_id: normalized.finding_id,
    source_ref: normalized.source_ref,
    remediation: normalized.remediation,
    evidence_refs: Object.freeze([...normalized.evidence]),
    candidate: true,
    execution_authorized: false,
    promotion_authorized: false,
    finding_status_after_conversion: "open",
  });
}

function normalizeCertificate(certificate) {
  const value = requirePlainObject(certificate, "certificate");
  requireExactKeys(value, CERTIFICATE_FIELDS, "certificate");

  if (value.certificate_version !== 1) {
    throw new TypeError("certificate.certificate_version must equal 1");
  }

  const scope = requirePlainObject(value.verification_scope, "certificate.verification_scope");
  requireExactKeys(scope, SCOPE_FIELDS, "certificate.verification_scope");

  return Object.freeze({
    certificate_version: 1,
    task_id: requireNonEmptyString(value.task_id, "certificate.task_id"),
    intent_refs: Object.freeze(requireStringArray(value.intent_refs, "certificate.intent_refs")),
    verification_scope: Object.freeze({
      coverage: requireEnum(scope.coverage, COVERAGE_SET, "certificate.verification_scope.coverage"),
      source_refs: Object.freeze(
        requireUniqueStringArray(scope.source_refs, "certificate.verification_scope.source_refs"),
      ),
    }),
    finding_refs: Object.freeze(
      requireUniqueStringArray(value.finding_refs, "certificate.finding_refs"),
    ),
    open_finding_ids: Object.freeze(
      requireUniqueStringArray(value.open_finding_ids, "certificate.open_finding_ids"),
    ),
    evidence_refs: Object.freeze(
      requireStringArray(value.evidence_refs, "certificate.evidence_refs"),
    ),
    verifier: normalizeVerifier(value.verifier, CERTIFICATE_VERIFIER_ROLE_SET, "certificate.verifier"),
    verdict: requireEnum(value.verdict, VERDICT_SET, "certificate.verdict"),
  });
}

export function evaluateConvergenceCertificate({ certificate, findings, executor_id } = {}) {
  const cert = normalizeCertificate(certificate);

  if (!Array.isArray(findings)) {
    throw new TypeError("findings must be an array");
  }
  const normalizedFindings = findings.map((entry) => normalizeFinding(entry));

  let normalizedExecutorId;
  if (executor_id !== undefined && executor_id !== null) {
    normalizedExecutorId = requireNonEmptyString(executor_id, "executor_id");
  }

  const suppliedFindingIds = normalizedFindings.map((f) => f.finding_id);
  if (new Set(suppliedFindingIds).size !== suppliedFindingIds.length) {
    throw new TypeError("findings contain duplicate finding_id values");
  }
  const actualOpenIds = normalizedFindings.filter((f) => f.status === "open").map((f) => f.finding_id);
  const scopeRefs = new Set(cert.verification_scope.source_refs);

  const blockers = [];

  if (cert.verdict !== "converged") {
    blockers.push({ code: "verdict_not_converged", detail: cert.verdict });
  }
  if (cert.intent_refs.length === 0) {
    blockers.push({ code: "intent_refs_empty", detail: "certificate.intent_refs is empty" });
  }
  if (cert.verification_scope.coverage !== "complete") {
    blockers.push({
      code: "coverage_not_complete",
      detail: cert.verification_scope.coverage,
    });
  }
  if (cert.verification_scope.source_refs.length === 0) {
    blockers.push({
      code: "scope_source_refs_empty",
      detail: "certificate.verification_scope.source_refs is empty",
    });
  }
  if (cert.evidence_refs.length === 0) {
    blockers.push({
      code: "certificate_evidence_refs_empty",
      detail: "certificate.evidence_refs is empty",
    });
  }
  if (!sameStringSet(cert.finding_refs, suppliedFindingIds)) {
    blockers.push({
      code: "finding_refs_mismatch",
      detail: "certificate.finding_refs does not exactly cover the supplied findings",
    });
  }
  const outOfScope = normalizedFindings
    .filter((f) => !scopeRefs.has(f.source_ref))
    .map((f) => f.finding_id);
  if (outOfScope.length > 0) {
    blockers.push({
      code: "finding_source_ref_out_of_scope",
      detail: outOfScope,
    });
  }
  if (!sameStringSet(cert.open_finding_ids, actualOpenIds)) {
    blockers.push({
      code: "open_finding_ids_mismatch",
      detail: "certificate.open_finding_ids does not match the actual open findings",
    });
  }
  if (actualOpenIds.length > 0) {
    blockers.push({ code: "open_findings_present", detail: actualOpenIds });
  }
  if (!CERTIFICATE_VERIFIER_ROLE_SET.has(cert.verifier.role)) {
    blockers.push({ code: "verifier_not_authorized", detail: cert.verifier.role });
  }
  if (normalizedExecutorId !== undefined && cert.verifier.id === normalizedExecutorId) {
    blockers.push({
      code: "executor_self_certification",
      detail: "certificate.verifier.id equals executor_id",
    });
  }

  const converged = blockers.length === 0;

  return {
    task_id: cert.task_id,
    verdict: cert.verdict,
    converged,
    verdict_effective: converged ? "converged" : "not_converged",
    open_finding_ids: actualOpenIds,
    blockers,
    close_authority: "supervisor-policy/completion-gate.mjs",
  };
}
