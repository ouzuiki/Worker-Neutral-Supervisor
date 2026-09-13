import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  evaluateConvergenceCertificate,
  findingToResidualWorkItem,
  normalizeFinding,
  GAP_TYPES,
  SEVERITIES,
  FINDING_STATUSES,
} from "./convergence.mjs";

function finding(overrides = {}) {
  return {
    finding_id: "F-1",
    source_ref: "spec://task-1/intent#goal",
    gap_type: "missing",
    severity: "high",
    evidence: ["evidence://task-1/e1"],
    remediation: "add the missing capability",
    verifier: { role: "supervisor", id: "supervisor-1" },
    status: "resolved",
    ...overrides,
  };
}

function certificate(overrides = {}) {
  return {
    certificate_version: 1,
    task_id: "task-1",
    intent_refs: ["intent://task-1/goal"],
    verification_scope: {
      coverage: "complete",
      source_refs: ["spec://task-1/intent#goal"],
    },
    finding_refs: ["F-1"],
    open_finding_ids: [],
    evidence_refs: ["evidence://task-1/e1"],
    verifier: { role: "supervisor", id: "supervisor-1" },
    verdict: "converged",
    ...overrides,
  };
}

function passingEvaluation(overrides = {}) {
  return evaluateConvergenceCertificate({
    certificate: certificate(),
    findings: [finding()],
    executor_id: "executor-1",
    ...overrides,
  });
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object") {
    for (const entry of Object.values(value)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}

test("all four gap_type values are accepted", () => {
  assert.deepEqual(GAP_TYPES, ["missing", "partial", "contradicts", "unrequested"]);
  for (const gap_type of GAP_TYPES) {
    assert.equal(normalizeFinding(finding({ gap_type })).gap_type, gap_type);
  }
});

test("invalid gap type is rejected", () => {
  assert.throws(() => normalizeFinding(finding({ gap_type: "regressed" })), /finding\.gap_type/);
});

test("invalid severity is rejected", () => {
  assert.deepEqual(SEVERITIES, ["critical", "high", "medium", "low"]);
  assert.throws(() => normalizeFinding(finding({ severity: "blocker" })), /finding\.severity/);
});

test("invalid finding status is rejected", () => {
  assert.deepEqual(FINDING_STATUSES, ["open", "resolved", "superseded"]);
  assert.throws(() => normalizeFinding(finding({ status: "closed" })), /finding\.status/);
});

test("unknown schema keys are rejected", () => {
  assert.throws(() => normalizeFinding({ ...finding(), extra: 1 }), /unknown key: extra/);
  assert.throws(
    () => normalizeFinding({ ...finding(), verifier: { ...finding().verifier, extra: 1 } }),
    /unknown key: extra/,
  );
  assert.throws(
    () => evaluateConvergenceCertificate({ certificate: { ...certificate(), extra: 1 }, findings: [] }),
    /unknown key: extra/,
  );
  assert.throws(
    () =>
      evaluateConvergenceCertificate({
        certificate: certificate({
          verification_scope: { ...certificate().verification_scope, extra: 1 },
        }),
        findings: [],
      }),
    /unknown key: extra/,
  );
});

test("open finding converts to a candidate residual work item", () => {
  const open = finding({ status: "open" });
  const item = findingToResidualWorkItem(open);
  assert.equal(item.finding_id, "F-1");
  assert.equal(item.source_ref, "spec://task-1/intent#goal");
  assert.equal(item.remediation, "add the missing capability");
  assert.deepEqual(item.evidence_refs, ["evidence://task-1/e1"]);
  assert.equal(item.candidate, true);
  assert.throws(() => findingToResidualWorkItem(finding({ status: "resolved" })), /open finding/);
});

test("conversion leaves the finding open", () => {
  const open = finding({ status: "open" });
  const item = findingToResidualWorkItem(open);
  assert.equal(item.finding_status_after_conversion, "open");
  assert.equal(open.status, "open");
  assert.equal(normalizeFinding(open).status, "open");
});

test("conversion does not authorize execution", () => {
  const item = findingToResidualWorkItem(finding({ status: "open" }));
  assert.equal(item.execution_authorized, false);
});

test("conversion does not authorize promotion", () => {
  const item = findingToResidualWorkItem(finding({ status: "open" }));
  assert.equal(item.promotion_authorized, false);
});

test("valid convergence certificate passes", () => {
  const result = passingEvaluation();
  assert.equal(result.converged, true);
  assert.equal(result.verdict_effective, "converged");
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.open_finding_ids, []);
  assert.equal(result.close_authority, "supervisor-policy/completion-gate.mjs");
});

test("open finding blocks convergence", () => {
  const result = passingEvaluation({
    findings: [finding({ status: "open" })],
    certificate: certificate({ open_finding_ids: ["F-1"] }),
  });
  assert.equal(result.converged, false);
  assert.equal(result.verdict_effective, "not_converged");
  assert.deepEqual(result.open_finding_ids, ["F-1"]);
  assert.ok(result.blockers.some((b) => b.code === "open_findings_present"));
});

test("incomplete verification coverage blocks", () => {
  const result = passingEvaluation({
    certificate: certificate({
      verification_scope: { coverage: "partial", source_refs: ["spec://task-1/intent#goal"] },
    }),
  });
  assert.equal(result.converged, false);
  assert.ok(result.blockers.some((b) => b.code === "coverage_not_complete"));
});

test("empty certificate evidence blocks", () => {
  const result = passingEvaluation({ certificate: certificate({ evidence_refs: [] }) });
  assert.equal(result.converged, false);
  assert.ok(result.blockers.some((b) => b.code === "certificate_evidence_refs_empty"));
});

test("mismatched finding coverage blocks", () => {
  for (const finding_refs of [[], ["F-2"], ["F-1", "F-2"]]) {
    const result = passingEvaluation({ certificate: certificate({ finding_refs }) });
    assert.equal(result.converged, false);
    assert.ok(result.blockers.some((b) => b.code === "finding_refs_mismatch"));
  }
});

test("duplicate finding refs are rejected", () => {
  assert.throws(
    () => passingEvaluation({ certificate: certificate({ finding_refs: ["F-1", "F-1"] }) }),
    /duplicate/,
  );
  assert.throws(() => passingEvaluation({ findings: [finding(), finding()] }), /duplicate/);
});

test("duplicate open-finding IDs are rejected", () => {
  assert.throws(
    () => passingEvaluation({ certificate: certificate({ open_finding_ids: ["F-1", "F-1"] }) }),
    /duplicate/,
  );
});

test("executor self-certification blocks for supervisor and independent_verifier roles", () => {
  for (const role of ["supervisor", "independent_verifier"]) {
    const result = passingEvaluation({
      certificate: certificate({ verifier: { role, id: "executor-1" } }),
    });
    assert.equal(result.converged, false);
    assert.equal(result.verdict_effective, "not_converged");
    assert.ok(result.blockers.some((b) => b.code === "executor_self_certification"));
  }
});

test("independent verifier with a different identity passes", () => {
  const result = passingEvaluation({
    certificate: certificate({ verifier: { role: "independent_verifier", id: "verifier-1" } }),
  });
  assert.equal(result.converged, true);
  assert.deepEqual(result.blockers, []);
});

test("evaluation is deterministic", () => {
  const input = { certificate: certificate(), findings: [finding()], executor_id: "executor-1" };
  const first = evaluateConvergenceCertificate(input);
  const second = evaluateConvergenceCertificate(input);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test("inputs are not mutated", () => {
  const cert = deepFreeze(certificate());
  const open = deepFreeze(finding({ status: "open" }));
  const resolved = deepFreeze(finding());
  const certBefore = JSON.stringify(cert);
  const openBefore = JSON.stringify(open);
  const resolvedBefore = JSON.stringify(resolved);
  evaluateConvergenceCertificate({
    certificate: cert,
    findings: [resolved],
    executor_id: "executor-1",
  });
  findingToResidualWorkItem(open);
  normalizeFinding(resolved);
  assert.equal(JSON.stringify(cert), certBefore);
  assert.equal(JSON.stringify(open), openBefore);
  assert.equal(JSON.stringify(resolved), resolvedBefore);
});

test("contract v0 stays aligned with the policy module", () => {
  const contract = JSON.parse(
    readFileSync(new URL("../worker-neutral/convergence/contract.v0.json", import.meta.url), "utf8"),
  );
  assert.equal(contract.contractId, "worker-neutral-convergence");
  assert.deepEqual(contract.finding.closed_enums.gap_type, [...GAP_TYPES]);
  assert.deepEqual(contract.finding.closed_enums.severity, [...SEVERITIES]);
  assert.deepEqual(contract.finding.closed_enums.status, [...FINDING_STATUSES]);
  const rule = contract.evaluator_executor_separation.final_verifier_rule;
  assert.match(rule, /may only be 'supervisor' or 'independent_verifier'/);
  assert.match(
    rule,
    /regardless of whether the verifier role is 'supervisor' or 'independent_verifier'/,
  );
  assert.match(contract.certificate.set_coverage_rule, /MUST NOT contain duplicates/);
  assert.equal(contract.certificate.scope.includes("does not close task"), true);
});
