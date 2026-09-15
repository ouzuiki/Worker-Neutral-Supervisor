import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_WATCHDOG_CONFIG,
  WATCHDOG_DIAGNOSTIC_STATES,
  evaluateReasoningWatchdog,
  normalizeSemanticProgress,
} from "./reasoning-watchdog.mjs";

const progress = (semantic_state, thinking_tokens_since_productive = 0) => ({
  semantic_state,
  last_productive_at: null,
  last_productive_cursor: null,
  thinking_tokens_since_productive,
});

test("semantic progress normalization remains closed and passive", () => {
  assert.deepEqual(normalizeSemanticProgress(progress("productive")), progress("productive"));
  assert.throws(() => normalizeSemanticProgress(progress("invented")), /semantic_state/);
});

test("diagnostics classify productive and blocked observations without a control action", () => {
  for (const [state, expected] of [["productive", "productive"], ["blocked", "blocked"]]) {
    const result = evaluateReasoningWatchdog({ semantic_progress: progress(state), elapsed_since_productive_ms: 999_999 });
    assert.equal(result.diagnostic_state, expected);
    assert.equal(Object.hasOwn(result, "action"), false);
    assert.equal(Object.hasOwn(result, "soft_steer_issued"), false);
  }
});

test("reasoning-only observations report neutral budget bands without intervention semantics", () => {
  const within = evaluateReasoningWatchdog({ semantic_progress: progress("reasoning_only", 10), elapsed_since_productive_ms: 10 });
  const soft = evaluateReasoningWatchdog({ semantic_progress: progress("reasoning_only", DEFAULT_WATCHDOG_CONFIG.soft_after_thinking_tokens), elapsed_since_productive_ms: 10 });
  const hard = evaluateReasoningWatchdog({ semantic_progress: progress("reasoning_only", 10), elapsed_since_productive_ms: DEFAULT_WATCHDOG_CONFIG.hard_after_ms });
  assert.equal(within.diagnostic_state, WATCHDOG_DIAGNOSTIC_STATES.REASONING_WITHIN_BUDGET);
  assert.equal(soft.diagnostic_state, WATCHDOG_DIAGNOSTIC_STATES.REASONING_SOFT_BUDGET_EXCEEDED);
  assert.equal(hard.diagnostic_state, WATCHDOG_DIAGNOSTIC_STATES.REASONING_HARD_BUDGET_EXCEEDED);
  for (const result of [within, soft, hard]) {
    assert.equal(Object.hasOwn(result, "action"), false);
    assert.equal(JSON.stringify(result).includes("steer"), false);
    assert.equal(JSON.stringify(result).includes("interrupt"), false);
  }
});

test("intervention-era input is rejected as an unknown passive diagnostic key", () => {
  assert.throws(
    () => evaluateReasoningWatchdog({ semantic_progress: progress("reasoning_only"), elapsed_since_productive_ms: 1, soft_steer_issued: true }),
    /soft_steer_issued/,
  );
});

test("threshold configuration remains deterministic and fail closed", () => {
  assert.throws(() => evaluateReasoningWatchdog({ semantic_progress: progress("reasoning_only"), elapsed_since_productive_ms: -1 }), /non-negative integer/);
  assert.throws(() => evaluateReasoningWatchdog({ semantic_progress: progress("reasoning_only"), elapsed_since_productive_ms: 1, config: { hard_after_ms: 1, soft_after_ms: 2 } }), /hard_after_ms/);
});
