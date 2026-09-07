import assert from "node:assert/strict";
import test from "node:test";

import {
  captureUnclassifiedStall,
  isUnclassifiedPatternKey,
  mapLivenessTelemetry,
} from "./liveness-telemetry.mjs";
import { normalizeTelemetryEvent } from "./telemetry.mjs";

const VALID_EVIDENCE = {
  worker: "codex",
  task_class: "general_engineering",
  liveness_state: "stall_suspected",
  semantic_state: "reasoning_only",
  recovery_action: "soft_steer",
};

test("absent or false explicit marker produces no capture or fabricated evidence", () => {
  for (const input of [{}, { explicit_unclassified: false, evidence: VALID_EVIDENCE }]) {
    assert.deepEqual(captureUnclassifiedStall(input), {
      captured: false,
      stall_reason: null,
      pattern_key: null,
      evidence: null,
    });
  }
});

test("valid categorical evidence produces a stable bounded pattern key", () => {
  const first = captureUnclassifiedStall({ explicit_unclassified: true, evidence: VALID_EVIDENCE });
  const second = captureUnclassifiedStall({ explicit_unclassified: true, evidence: { ...VALID_EVIDENCE } });
  assert.equal(first.captured, true);
  assert.equal(first.stall_reason, "unclassified");
  assert.equal(first.pattern_key, second.pattern_key);
  assert.equal(first.pattern_key, "u1:codex:general_engineering:stall_suspected:reasoning_only:soft_steer");
  assert.ok(first.pattern_key.length <= 160);
  assert.equal(isUnclassifiedPatternKey(first.pattern_key), true);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.evidence));
});

test("arbitrary and sensitive values normalize to fixed unknown tokens and never survive", () => {
  const captured = captureUnclassifiedStall({
    explicit_unclassified: true,
    evidence: {
      worker: "MALICIOUS_WORKER_TEXT",
      task_class: "MALICIOUS_TASK_TEXT",
      liveness_state: "MALICIOUS_LIVENESS_TEXT",
      semantic_state: "MALICIOUS_REASONING_TEXT",
      recovery_action: "MALICIOUS_ACTION_TEXT",
      prompt: "PRIVATE_PROMPT_TEXT",
      raw_error: "PRIVATE_ERROR_TEXT",
      tool_payload: { secret: "PRIVATE_TOOL_DATA" },
      execution_id: "PRIVATE_RUN_ID",
      path: "/PRIVATE/PATH",
    },
  });
  assert.deepEqual(captured.evidence, {
    worker: "unknown",
    task_class: "unknown",
    liveness_state: "unknown",
    semantic_state: "unknown",
    recovery_action: "unknown",
  });
  assert.equal(captured.pattern_key, "u1:unknown:unknown:unknown:unknown:unknown");
  const serialized = JSON.stringify(captured);
  for (const forbidden of ["MALICIOUS", "PRIVATE", "/PRIVATE/PATH"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("equivalent invalid inputs normalize to the same pattern", () => {
  const one = captureUnclassifiedStall({
    explicit_unclassified: true,
    evidence: { ...VALID_EVIDENCE, worker: "INVALID_ONE" },
  });
  const two = captureUnclassifiedStall({
    explicit_unclassified: true,
    evidence: { ...VALID_EVIDENCE, worker: "INVALID_TWO" },
  });
  assert.equal(one.pattern_key, two.pattern_key);
});

test("different allowed categories produce different patterns", () => {
  const codex = captureUnclassifiedStall({ explicit_unclassified: true, evidence: VALID_EVIDENCE });
  const pi = captureUnclassifiedStall({
    explicit_unclassified: true,
    evidence: { ...VALID_EVIDENCE, worker: "pi" },
  });
  assert.notEqual(codex.pattern_key, pi.pattern_key);
});

test("ordinary Phase 1 mapping remains reasoning_only_no_progress", () => {
  const mapped = mapLivenessTelemetry({
    liveness_verdict: { liveness: "stall_suspected" },
    recovery_recommendation: { recommended_action: "soft_steer" },
  });
  assert.equal(mapped.stall_reason, "reasoning_only_no_progress");
  assert.notEqual(mapped.stall_reason, "unclassified");
});

test("telemetry admits a valid explicit pattern and rejects forged arbitrary patterns", () => {
  const captured = captureUnclassifiedStall({ explicit_unclassified: true, evidence: VALID_EVIDENCE });
  const valid = normalizeTelemetryEvent({
    stall_detected: true,
    stall_reason: captured.stall_reason,
    stall_pattern: captured.pattern_key,
  });
  assert.equal(valid.stall_reason, "unclassified");
  assert.equal(valid.stall_pattern, captured.pattern_key);

  const forged = normalizeTelemetryEvent({
    stall_detected: true,
    stall_reason: "unclassified",
    stall_pattern: "u1:codex:PRIVATE_PROJECT_DATA",
    prompt: "PRIVATE_PROMPT_TEXT",
    raw_error: "PRIVATE_ERROR_TEXT",
    tool_payload: "PRIVATE_TOOL_DATA",
  });
  assert.equal(forged.stall_reason, null);
  assert.equal(forged.stall_pattern, null);
  assert.equal(JSON.stringify(forged).includes("PRIVATE"), false);
});

test("known automatic stall telemetry cannot carry an unclassified pattern", () => {
  const captured = captureUnclassifiedStall({ explicit_unclassified: true, evidence: VALID_EVIDENCE });
  const normalized = normalizeTelemetryEvent({
    stall_detected: true,
    stall_reason: "reasoning_only_no_progress",
    stall_pattern: captured.pattern_key,
  });
  assert.equal(normalized.stall_reason, "reasoning_only_no_progress");
  assert.equal(normalized.stall_pattern, null);
});
