import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_WATCHDOG_CONFIG,
  WATCHDOG_ACTIONS,
  WATCHDOG_REASONS,
  WATCHDOG_SEMANTIC_STATES,
  evaluateReasoningWatchdog,
} from "./reasoning-watchdog.mjs";

function progress(overrides = {}) {
  return {
    semantic_state: WATCHDOG_SEMANTIC_STATES.REASONING_ONLY,
    last_productive_at: "2026-09-05T00:00:00.000Z",
    last_productive_cursor: 3,
    thinking_tokens_since_productive: 0,
    ...overrides,
  };
}

function evaluate(input = {}) {
  return evaluateReasoningWatchdog({
    semantic_progress: progress(input.semantic_progress),
    elapsed_since_productive_ms: input.elapsed_since_productive_ms ?? 0,
    soft_steer_issued: input.soft_steer_issued ?? false,
    ...(input.config ? { config: input.config } : {}),
  });
}

test("default config matches the v0 budget contract and is frozen", () => {
  assert.deepEqual({ ...DEFAULT_WATCHDOG_CONFIG }, {
    soft_after_ms: 45_000,
    soft_after_thinking_tokens: 4_000,
    hard_after_ms: 90_000,
    hard_after_thinking_tokens: 7_000,
  });
  assert.ok(Object.isFrozen(DEFAULT_WATCHDOG_CONFIG));
  assert.ok(Object.isFrozen(WATCHDOG_ACTIONS));
  assert.ok(Object.isFrozen(WATCHDOG_REASONS));
  assert.ok(Object.isFrozen(WATCHDOG_SEMANTIC_STATES));
});

test("blocked always returns none even with enormous elapsed and tokens", () => {
  const result = evaluate({
    semantic_progress: {
      semantic_state: WATCHDOG_SEMANTIC_STATES.BLOCKED,
      thinking_tokens_since_productive: 10_000_000,
    },
    elapsed_since_productive_ms: 999_999_999,
    soft_steer_issued: true,
  });
  assert.equal(result.action, WATCHDOG_ACTIONS.NONE);
  assert.equal(result.reason, WATCHDOG_REASONS.BLOCKED_PENDING_APPROVAL);
});

test("blocked returns none with soft_steer_issued false too", () => {
  const result = evaluate({
    semantic_progress: {
      semantic_state: WATCHDOG_SEMANTIC_STATES.BLOCKED,
      thinking_tokens_since_productive: 50_000,
    },
    elapsed_since_productive_ms: 5_000_000,
    soft_steer_issued: false,
  });
  assert.equal(result.action, WATCHDOG_ACTIONS.NONE);
});

test("productive returns none regardless of elapsed/tokens", () => {
  const result = evaluate({
    semantic_progress: {
      semantic_state: WATCHDOG_SEMANTIC_STATES.PRODUCTIVE,
      thinking_tokens_since_productive: 999_999,
    },
    elapsed_since_productive_ms: 999_999,
  });
  assert.equal(result.action, WATCHDOG_ACTIONS.NONE);
  assert.equal(result.reason, WATCHDOG_REASONS.PRODUCTIVE_PROGRESS);
});

test("reasoning_only below both soft thresholds returns none", () => {
  const result = evaluate({
    semantic_progress: { thinking_tokens_since_productive: 3_999 },
    elapsed_since_productive_ms: 44_999,
  });
  assert.equal(result.action, WATCHDOG_ACTIONS.NONE);
  assert.equal(result.reason, WATCHDOG_REASONS.REASONING_WITHIN_BUDGET);
});

test("reasoning_only crossing soft ms threshold with no prior steer => soft_steer", () => {
  const result = evaluate({ elapsed_since_productive_ms: 45_000 });
  assert.equal(result.action, WATCHDOG_ACTIONS.SOFT_STEER);
  assert.equal(result.reason, WATCHDOG_REASONS.REASONING_SOFT_BUDGET_EXCEEDED);
  assert.equal(result.thresholds.soft_ms_exceeded, true);
  assert.equal(result.thresholds.soft_thinking_tokens_exceeded, false);
});

test("reasoning_only crossing soft token threshold with no prior steer => soft_steer", () => {
  const result = evaluate({
    semantic_progress: { thinking_tokens_since_productive: 4_000 },
    elapsed_since_productive_ms: 0,
  });
  assert.equal(result.action, WATCHDOG_ACTIONS.SOFT_STEER);
  assert.equal(result.thresholds.soft_thinking_tokens_exceeded, true);
});

test("hard exceeded before soft steer still returns soft_steer first (ms)", () => {
  const result = evaluate({ elapsed_since_productive_ms: 200_000, soft_steer_issued: false });
  assert.equal(result.action, WATCHDOG_ACTIONS.SOFT_STEER);
  assert.equal(
    result.reason,
    WATCHDOG_REASONS.REASONING_HARD_BUDGET_EXCEEDED_AWAITING_STEER,
  );
});

test("hard exceeded before soft steer still returns soft_steer first (tokens)", () => {
  const result = evaluate({
    semantic_progress: { thinking_tokens_since_productive: 100_000 },
    soft_steer_issued: false,
  });
  assert.equal(result.action, WATCHDOG_ACTIONS.SOFT_STEER);
  assert.equal(
    result.reason,
    WATCHDOG_REASONS.REASONING_HARD_BUDGET_EXCEEDED_AWAITING_STEER,
  );
});

test("after soft steer, crossing hard ms threshold => interrupt", () => {
  const result = evaluate({ elapsed_since_productive_ms: 90_000, soft_steer_issued: true });
  assert.equal(result.action, WATCHDOG_ACTIONS.INTERRUPT);
  assert.equal(result.reason, WATCHDOG_REASONS.REASONING_HARD_BUDGET_EXCEEDED);
  assert.equal(result.thresholds.hard_ms_exceeded, true);
});

test("after soft steer, crossing hard token threshold => interrupt", () => {
  const result = evaluate({
    semantic_progress: { thinking_tokens_since_productive: 7_000 },
    elapsed_since_productive_ms: 0,
    soft_steer_issued: true,
  });
  assert.equal(result.action, WATCHDOG_ACTIONS.INTERRUPT);
  assert.equal(result.thresholds.hard_thinking_tokens_exceeded, true);
});

test("after soft steer but still below hard threshold => none", () => {
  const result = evaluate({
    elapsed_since_productive_ms: 89_999,
    semantic_progress: { thinking_tokens_since_productive: 6_999 },
    soft_steer_issued: true,
  });
  assert.equal(result.action, WATCHDOG_ACTIONS.NONE);
  assert.equal(
    result.reason,
    WATCHDOG_REASONS.REASONING_POST_STEER_WITHIN_HARD_BUDGET,
  );
});

test("comparison triggers exactly at >= threshold", () => {
  assert.equal(
    evaluate({ elapsed_since_productive_ms: 44_999 }).action,
    WATCHDOG_ACTIONS.NONE,
  );
  assert.equal(
    evaluate({ elapsed_since_productive_ms: 45_000 }).action,
    WATCHDOG_ACTIONS.SOFT_STEER,
  );
  assert.equal(
    evaluate({ elapsed_since_productive_ms: 89_999, soft_steer_issued: true }).action,
    WATCHDOG_ACTIONS.NONE,
  );
  assert.equal(
    evaluate({ elapsed_since_productive_ms: 90_000, soft_steer_issued: true }).action,
    WATCHDOG_ACTIONS.INTERRUPT,
  );
});

test("output is compact, normalized, and carries decision evidence", () => {
  const result = evaluate({ elapsed_since_productive_ms: 45_000 });
  assert.deepEqual(Object.keys(result).sort(), [
    "action",
    "observed_elapsed_ms",
    "observed_thinking_tokens",
    "reason",
    "semantic_state",
    "soft_steer_issued",
    "thresholds",
  ]);
  assert.equal(result.semantic_state, WATCHDOG_SEMANTIC_STATES.REASONING_ONLY);
  assert.equal(result.observed_elapsed_ms, 45_000);
  assert.ok(Object.isFrozen(result));
});

test("invalid semantic state fails loudly", () => {
  assert.throws(
    () => evaluate({ semantic_progress: { semantic_state: "thinking" } }),
    /semantic_state must be/,
  );
});

test("negative or non-integer elapsed fails loudly", () => {
  assert.throws(() => evaluate({ elapsed_since_productive_ms: -1 }), /non-negative integer/);
  assert.throws(() => evaluate({ elapsed_since_productive_ms: 1.5 }), /non-negative integer/);
  assert.throws(() => evaluate({ elapsed_since_productive_ms: "45000" }), /non-negative integer/);
});

test("non-boolean soft_steer_issued fails loudly", () => {
  assert.throws(
    () =>
      evaluateReasoningWatchdog({
        semantic_progress: progress(),
        elapsed_since_productive_ms: 0,
        soft_steer_issued: "false",
      }),
    /must be a boolean/,
  );
});

test("invalid thinking token count fails loudly and is not coerced", () => {
  assert.throws(
    () => evaluate({ semantic_progress: { thinking_tokens_since_productive: -5 } }),
    /non-negative integer/,
  );
  assert.throws(
    () => evaluate({ semantic_progress: { thinking_tokens_since_productive: "4000" } }),
    /non-negative integer/,
  );
  assert.throws(
    () => evaluate({ semantic_progress: { thinking_tokens_since_productive: 1.5 } }),
    /non-negative integer/,
  );
  assert.throws(
    () => evaluate({ semantic_progress: { thinking_tokens_since_productive: undefined } }),
    /non-negative integer/,
  );
});

test("null thinking tokens is accepted and disables token thresholds", () => {
  const none = evaluate({
    semantic_progress: { thinking_tokens_since_productive: null },
    elapsed_since_productive_ms: 44_999,
  });
  assert.equal(none.action, WATCHDOG_ACTIONS.NONE);
  assert.equal(none.reason, WATCHDOG_REASONS.REASONING_WITHIN_BUDGET);
  assert.equal(none.observed_thinking_tokens, null);

  const soft = evaluate({
    semantic_progress: { thinking_tokens_since_productive: null },
    elapsed_since_productive_ms: 45_000,
  });
  assert.equal(soft.action, WATCHDOG_ACTIONS.SOFT_STEER);
  assert.equal(soft.reason, WATCHDOG_REASONS.REASONING_SOFT_BUDGET_EXCEEDED);
  assert.equal(soft.thresholds.soft_thinking_tokens_exceeded, false);
  assert.equal(soft.thresholds.soft_ms_exceeded, true);

  const interrupt = evaluate({
    semantic_progress: { thinking_tokens_since_productive: null },
    elapsed_since_productive_ms: 90_000,
    soft_steer_issued: true,
  });
  assert.equal(interrupt.action, WATCHDOG_ACTIONS.INTERRUPT);
  assert.equal(interrupt.reason, WATCHDOG_REASONS.REASONING_HARD_BUDGET_EXCEEDED);
  assert.equal(interrupt.thresholds.hard_thinking_tokens_exceeded, false);

  const hugeTokensIgnored = evaluate({
    semantic_progress: { thinking_tokens_since_productive: null },
    elapsed_since_productive_ms: 0,
    soft_steer_issued: true,
  });
  assert.equal(hugeTokensIgnored.action, WATCHDOG_ACTIONS.NONE);
});

test("invalid config fails loudly", () => {
  assert.throws(() => evaluate({ config: { soft_after_ms: -1 } }), /config\./);
  assert.throws(
    () =>
      evaluate({
        config: { ...DEFAULT_WATCHDOG_CONFIG, hard_after_ms: 10, soft_after_ms: 20 },
      }),
    /hard_after_ms must be >=/,
  );
  assert.throws(
    () => evaluate({ config: { ...DEFAULT_WATCHDOG_CONFIG, bogus: 1 } }),
    /unknown key/,
  );
  assert.throws(
    () =>
      evaluateReasoningWatchdog({
        semantic_progress: progress(),
        elapsed_since_productive_ms: 0,
        soft_steer_issued: false,
        config: null,
      }),
    /config must be an object/,
  );
});

test("a valid single-field partial config override merges over defaults", () => {
  const result = evaluate({
    elapsed_since_productive_ms: 10_000,
    config: { soft_after_ms: 10_000 },
  });
  assert.equal(result.action, WATCHDOG_ACTIONS.SOFT_STEER);
  // untouched fields keep their v0 defaults
  assert.equal(
    evaluate({
      elapsed_since_productive_ms: 90_000,
      soft_steer_issued: true,
      config: { soft_after_ms: 10_000 },
    }).action,
    WATCHDOG_ACTIONS.INTERRUPT,
  );
});

test("invalid last_productive_at fails loudly", () => {
  assert.throws(
    () => evaluate({ semantic_progress: { last_productive_at: 12345 } }),
    /last_productive_at must be a string or null/,
  );
});

test("invalid last_productive_cursor fails loudly and is not coerced", () => {
  assert.throws(
    () => evaluate({ semantic_progress: { last_productive_cursor: "step-3" } }),
    /last_productive_cursor must be a non-negative integer/,
  );
  assert.throws(
    () => evaluate({ semantic_progress: { last_productive_cursor: -1 } }),
    /last_productive_cursor must be a non-negative integer/,
  );
});

test("custom config budgets are honored", () => {
  const config = {
    soft_after_ms: 1_000,
    soft_after_thinking_tokens: 100,
    hard_after_ms: 2_000,
    hard_after_thinking_tokens: 200,
  };
  assert.equal(
    evaluate({ elapsed_since_productive_ms: 1_000, config }).action,
    WATCHDOG_ACTIONS.SOFT_STEER,
  );
  assert.equal(
    evaluate({ elapsed_since_productive_ms: 2_000, soft_steer_issued: true, config }).action,
    WATCHDOG_ACTIONS.INTERRUPT,
  );
});
