import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const registryUrl = new URL(
  "../worker-neutral/liveness/deferred-detectors.v0.json",
  import.meta.url,
);
const contractUrl = new URL("../worker-neutral/liveness/contract.v0.json", import.meta.url);
const registry = JSON.parse(readFileSync(registryUrl, "utf8"));
const contract = JSON.parse(readFileSync(contractUrl, "utf8"));

test("registry contains exactly the ordered D1-D5 detector backlog", () => {
  assert.deepEqual(
    registry.detectors.map(({ id, detector }) => ({ id, detector })),
    [
      { id: "D1", detector: "reasoning_only_no_progress" },
      { id: "D2", detector: "repeated_action" },
      { id: "D3", detector: "repeated_error" },
      { id: "D4", detector: "ping_pong" },
      { id: "D5", detector: "runtime_silence" },
    ],
  );
});

test("every detector is deferred, Phase 2-owned, and operationally specified", () => {
  for (const detector of registry.detectors) {
    assert.equal(detector.status, "deferred");
    assert.equal(detector.owner, "Worker Liveness Phase 2");
    assert.equal(typeof detector.activation_condition, "string");
    assert.ok(detector.activation_condition.length > 0);
    assert.equal(typeof detector.evidence_required, "string");
    assert.ok(detector.evidence_required.length > 0);
    assert.equal(Object.hasOwn(detector, "active"), false);
    assert.equal(Object.hasOwn(detector, "enabled"), false);
  }
});

test("D1 preserves the active label while deferring the richer detector", () => {
  const d1 = registry.detectors[0];
  assert.match(d1.phase_1_state, /telemetry label reasoning_only_no_progress is active/i);
  assert.match(d1.phase_1_state, /richer D1 detector is not implemented/i);
  assert.match(d1.activation_condition, /beyond the Phase 1 threshold watchdog/i);
});

test("D2-D5 explicitly have no active Phase 1 detector", () => {
  for (const detector of registry.detectors.slice(1)) {
    assert.equal(detector.phase_1_state, "No active detector exists in Phase 1.");
  }
});

test("registry governance prevents registration from implying implementation or activation", () => {
  assert.equal(registry.governance.registration_effect, "backlog_metadata_only_not_implementation");
  assert.deepEqual(registry.governance.activation_requires, [
    "bounded_evidence",
    "supervisor_review",
    "explicit_execution",
  ]);
  assert.equal(registry.governance.automatic_development, false);
  assert.equal(registry.governance.automatic_deployment, false);
  assert.equal(registry.governance.phase_2_review, "advisory_until_explicitly_executed");
});

test("liveness contract references the registry SSOT without duplicating deferred names", () => {
  assert.equal(
    contract.wl5_deferred_detector_registry,
    "worker-neutral/liveness/deferred-detectors.v0.json",
  );
  assert.equal(Object.hasOwn(contract.wl4_telemetry, "deferred_detectors"), false);
  assert.deepEqual(contract.wl4_telemetry.stall_reasons, [
    "reasoning_only_no_progress",
    "unclassified",
  ]);
  assert.deepEqual(contract.wl4_telemetry.automatic_stall_reasons, [
    "reasoning_only_no_progress",
  ]);
});
