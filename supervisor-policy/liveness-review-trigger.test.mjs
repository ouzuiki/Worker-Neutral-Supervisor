import assert from "node:assert/strict";
import test from "node:test";

import { captureUnclassifiedStall } from "./liveness-telemetry.mjs";
import {
  DEFAULT_REVIEW_CONFIG,
  LIVENESS_PHASE2_REVIEW_RECOMMENDED,
  MAX_HISTORY_RECORDS,
  MAX_OCCURRENCE_UNIVERSE,
  evaluateLivenessReviewTrigger,
} from "./liveness-review-trigger.mjs";

function pattern(worker = "codex") {
  return captureUnclassifiedStall({
    explicit_unclassified: true,
    evidence: {
      worker,
      task_class: "general_engineering",
      liveness_state: "stall_suspected",
      semantic_state: "reasoning_only",
      recovery_action: "soft_steer",
    },
  }).pattern_key;
}

function record(patternKey, field = "stall_pattern", extras = {}) {
  return { [field]: patternKey, ...extras };
}

test("one current occurrence produces no review and is counted exactly once", () => {
  const result = evaluateLivenessReviewTrigger({ current_pattern: pattern() });
  assert.equal(result.review_recommended, false);
  assert.equal(result.advisory_code, null);
  assert.equal(result.reason, null);
  assert.equal(result.matching_count, 1);
  assert.equal(result.recent_matching_count, 1);
  assert.equal(result.recent_window_size, 10);
});

test("three total same-pattern occurrences recommend Phase 2 review", () => {
  const current = pattern();
  const result = evaluateLivenessReviewTrigger({
    current_pattern: current,
    history_records: [record(current), record(current, "pattern_key")],
  });
  assert.equal(result.review_recommended, true);
  assert.equal(result.advisory_code, LIVENESS_PHASE2_REVIEW_RECOMMENDED);
  assert.equal(result.reason, "same_pattern_recurrence");
  assert.equal(result.matching_count, 3);
});

test("two occurrences in the last ten trigger when total threshold is configured higher", () => {
  const current = pattern();
  const result = evaluateLivenessReviewTrigger({
    current_pattern: current,
    history_records: [record(pattern("pi")), record(current)],
    config: { total_recurrence_threshold: 5 },
  });
  assert.equal(result.reason, "recent_window_recurrence");
  assert.equal(result.matching_count, 2);
  assert.equal(result.recent_matching_count, 2);
});

test("operator repeat flag has deterministic first precedence", () => {
  const current = pattern();
  const result = evaluateLivenessReviewTrigger({
    current_pattern: current,
    history_records: [record(current), record(current)],
    operator_repeat_flag: true,
  });
  assert.equal(result.reason, "operator_repeat_flag");
});

test("invalid and forged history patterns are ignored without transporting raw data", () => {
  const current = pattern();
  const result = evaluateLivenessReviewTrigger({
    current_pattern: current,
    history_records: [
      record("u1:codex:PRIVATE_PROJECT_DATA", "stall_pattern", { prompt: "PRIVATE_PROMPT" }),
      { pattern_key: 42, raw_error: "PRIVATE_ERROR", tool_payload: "PRIVATE_TOOL" },
    ],
  });
  assert.equal(result.matching_count, 1);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("PRIVATE"), false);
  assert.equal(Object.hasOwn(result, "history_records"), false);
});

test("invalid current pattern fails closed even with operator flag", () => {
  const result = evaluateLivenessReviewTrigger({
    current_pattern: "u1:codex:FORGED",
    operator_repeat_flag: true,
    history_records: [record(pattern())],
  });
  assert.deepEqual(result, {
    review_recommended: false,
    advisory_code: null,
    reason: null,
    pattern_key: null,
    matching_count: 0,
    recent_matching_count: 0,
    recent_window_size: 10,
  });
});

test("history input hard cap is enforced", () => {
  assert.equal(MAX_HISTORY_RECORDS, 100);
  assert.throws(
    () => evaluateLivenessReviewTrigger({
      current_pattern: pattern(),
      history_records: Array.from({ length: 101 }, () => ({})),
    }),
    /at most 100/,
  );
});

test("other valid patterns do not count toward current recurrence", () => {
  const current = pattern("codex");
  const result = evaluateLivenessReviewTrigger({
    current_pattern: current,
    history_records: [record(pattern("pi")), record(pattern("claude"))],
  });
  assert.equal(result.matching_count, 1);
  assert.equal(result.review_recommended, false);
});

test("recent window uses the most recent valid records plus current", () => {
  const current = pattern();
  const other = pattern("pi");
  const result = evaluateLivenessReviewTrigger({
    current_pattern: current,
    history_records: [record(current), ...Array.from({ length: 9 }, () => record(other))],
    config: { total_recurrence_threshold: 5 },
  });
  assert.equal(result.matching_count, 2);
  assert.equal(result.recent_matching_count, 1);
  assert.equal(result.review_recommended, false);
});

test("output is immutable advisory evidence and never selects or enables a detector", () => {
  const result = evaluateLivenessReviewTrigger({
    current_pattern: pattern(),
    operator_repeat_flag: true,
  });
  assert.ok(Object.isFrozen(result));
  assert.equal(result.advisory_code, "LIVENESS_PHASE2_REVIEW_RECOMMENDED");
  for (const forbidden of ["worker", "detector", "enabled", "action", "deployment"]) {
    assert.equal(Object.hasOwn(result, forbidden), false);
  }
});

test("config accepts bounded positive integers and rejects invalid or unknown values", () => {
  const current = pattern();
  const configured = evaluateLivenessReviewTrigger({
    current_pattern: current,
    history_records: [record(current)],
    config: {
      total_recurrence_threshold: 4,
      recent_recurrence_threshold: 3,
      recent_window_size: 5,
    },
  });
  assert.equal(configured.review_recommended, false);
  assert.equal(configured.recent_window_size, 5);
  assert.deepEqual(DEFAULT_REVIEW_CONFIG, {
    total_recurrence_threshold: 3,
    recent_recurrence_threshold: 2,
    recent_window_size: 10,
  });
  for (const config of [
    { total_recurrence_threshold: 0 },
    { recent_recurrence_threshold: -1 },
    { recent_window_size: 1.5 },
    { worker_threshold: 2 },
  ]) {
    assert.throws(
      () => evaluateLivenessReviewTrigger({ current_pattern: current, config }),
      /positive integer|unknown key/,
    );
  }
});

test("config stays genuinely bounded to the history+current occurrence universe", () => {
  const current = pattern();
  assert.equal(MAX_OCCURRENCE_UNIVERSE, MAX_HISTORY_RECORDS + 1);

  for (const key of ["total_recurrence_threshold", "recent_window_size"]) {
    assert.doesNotThrow(() =>
      evaluateLivenessReviewTrigger({
        current_pattern: current,
        config: { [key]: MAX_OCCURRENCE_UNIVERSE },
      }),
    );
    assert.throws(
      () =>
        evaluateLivenessReviewTrigger({
          current_pattern: current,
          config: { [key]: MAX_OCCURRENCE_UNIVERSE + 1 },
        }),
      /no greater than 101/,
      `${key} must be capped at the occurrence universe`,
    );
    assert.throws(
      () =>
        evaluateLivenessReviewTrigger({
          current_pattern: current,
          config: { [key]: Number.MAX_SAFE_INTEGER },
        }),
      /no greater than 101/,
    );
  }
});

test("recent_recurrence_threshold cannot exceed its own window", () => {
  const current = pattern();
  assert.doesNotThrow(() =>
    evaluateLivenessReviewTrigger({
      current_pattern: current,
      config: { recent_window_size: 4, recent_recurrence_threshold: 4 },
    }),
  );
  assert.throws(
    () =>
      evaluateLivenessReviewTrigger({
        current_pattern: current,
        config: { recent_window_size: 4, recent_recurrence_threshold: 5 },
      }),
    /no greater than 4/,
  );
  // default recent threshold (2) must still fit a shrunken window
  assert.throws(
    () =>
      evaluateLivenessReviewTrigger({
        current_pattern: current,
        config: { recent_window_size: 1 },
      }),
    /no greater than 1/,
  );
});
