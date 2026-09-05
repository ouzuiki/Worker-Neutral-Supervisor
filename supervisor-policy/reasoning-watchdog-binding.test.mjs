import assert from "node:assert/strict";
import test from "node:test";

import {
  WATCHDOG_ACTIONS,
  WATCHDOG_REASONS,
  WATCHDOG_SEMANTIC_STATES,
  evaluateReasoningWatchdog,
} from "./reasoning-watchdog.mjs";
import {
  SUPERVISOR_INSTRUCTIONS,
  WATCHDOG_CONTROL_VERBS,
  WATCHDOG_SOFT_STEER_MESSAGE,
  WATCHDOG_TERMINAL_REASON,
  evaluateWatchdogBinding,
} from "./reasoning-watchdog-binding.mjs";

function progress(overrides = {}) {
  return {
    semantic_state: WATCHDOG_SEMANTIC_STATES.REASONING_ONLY,
    last_productive_at: "2026-09-05T00:00:00.000Z",
    last_productive_cursor: 3,
    thinking_tokens_since_productive: 0,
    ...overrides,
  };
}

function bind(input = {}) {
  return evaluateWatchdogBinding({
    semantic_progress: progress(input.semantic_progress),
    elapsed_since_productive_ms: input.elapsed_since_productive_ms ?? 0,
    soft_steer_issued: input.soft_steer_issued ?? false,
    ...(input.config ? { config: input.config } : {}),
  });
}

function watchdogFor(input = {}) {
  return evaluateReasoningWatchdog({
    semantic_progress: progress(input.semantic_progress),
    elapsed_since_productive_ms: input.elapsed_since_productive_ms ?? 0,
    soft_steer_issued: input.soft_steer_issued ?? false,
    ...(input.config ? { config: input.config } : {}),
  });
}

test("blocked with a huge budget => await_blocked_resolution, never steer/interrupt", () => {
  const result = bind({
    semantic_progress: {
      semantic_state: WATCHDOG_SEMANTIC_STATES.BLOCKED,
      thinking_tokens_since_productive: 10_000_000,
    },
    elapsed_since_productive_ms: 999_999_999,
    soft_steer_issued: true,
  });
  assert.equal(
    result.supervisor_instruction,
    SUPERVISOR_INSTRUCTIONS.AWAIT_BLOCKED_RESOLUTION,
  );
  assert.equal(result.control, null);
  assert.equal(result.watchdog.reason, WATCHDOG_REASONS.BLOCKED_PENDING_APPROVAL);
});

test("productive progress => continue_observing, no control", () => {
  const result = bind({
    semantic_progress: {
      semantic_state: WATCHDOG_SEMANTIC_STATES.PRODUCTIVE,
      thinking_tokens_since_productive: 999_999,
    },
    elapsed_since_productive_ms: 999_999,
  });
  assert.equal(
    result.supervisor_instruction,
    SUPERVISOR_INSTRUCTIONS.CONTINUE_OBSERVING,
  );
  assert.equal(result.control, null);
});

test("reasoning below the soft budget => continue_observing", () => {
  const result = bind({
    semantic_progress: { thinking_tokens_since_productive: 3_999 },
    elapsed_since_productive_ms: 44_999,
  });
  assert.equal(
    result.supervisor_instruction,
    SUPERVISOR_INSTRUCTIONS.CONTINUE_OBSERVING,
  );
  assert.equal(result.control, null);
});

test("soft threshold => send_soft_steer + verb steer + exact exported message", () => {
  const result = bind({ elapsed_since_productive_ms: 45_000 });
  assert.equal(
    result.supervisor_instruction,
    SUPERVISOR_INSTRUCTIONS.SEND_SOFT_STEER,
  );
  assert.equal(result.control.verb, WATCHDOG_CONTROL_VERBS.STEER);
  assert.equal(result.control.verb, "steer");
  assert.equal(result.control.message, WATCHDOG_SOFT_STEER_MESSAGE);
});

test("hard threshold reached before any soft steer => STILL send_soft_steer", () => {
  const result = bind({
    elapsed_since_productive_ms: 200_000,
    soft_steer_issued: false,
  });
  assert.equal(
    result.supervisor_instruction,
    SUPERVISOR_INSTRUCTIONS.SEND_SOFT_STEER,
  );
  assert.equal(result.control.verb, "steer");
  assert.equal(
    result.watchdog.reason,
    WATCHDOG_REASONS.REASONING_HARD_BUDGET_EXCEEDED_AWAITING_STEER,
  );
});

test("after steer, still below hard budget => continue_observing", () => {
  const result = bind({
    elapsed_since_productive_ms: 89_999,
    semantic_progress: { thinking_tokens_since_productive: 6_999 },
    soft_steer_issued: true,
  });
  assert.equal(
    result.supervisor_instruction,
    SUPERVISOR_INSTRUCTIONS.CONTINUE_OBSERVING,
  );
  assert.equal(result.control, null);
});

test("after steer, at the hard budget => interrupt_run + verb interrupt + terminal_reason", () => {
  const result = bind({
    elapsed_since_productive_ms: 90_000,
    soft_steer_issued: true,
  });
  assert.equal(
    result.supervisor_instruction,
    SUPERVISOR_INSTRUCTIONS.INTERRUPT_RUN,
  );
  assert.equal(result.control.verb, WATCHDOG_CONTROL_VERBS.INTERRUPT);
  assert.equal(result.control.verb, "interrupt");
  assert.equal(result.control.terminal_reason, WATCHDOG_TERMINAL_REASON);
  assert.equal(result.control.terminal_reason, "reasoning_budget_exceeded");
});

test("no force flag is ever present on a control verb", () => {
  const steer = bind({ elapsed_since_productive_ms: 45_000 });
  const interrupt = bind({
    elapsed_since_productive_ms: 90_000,
    soft_steer_issued: true,
  });
  for (const control of [steer.control, interrupt.control]) {
    assert.ok(!Object.hasOwn(control, "force"));
    assert.equal(control.force, undefined);
  }
});

test("binding delegates a custom partial config rather than duplicating thresholds", () => {
  const config = { soft_after_ms: 10_000 };
  assert.equal(
    bind({ elapsed_since_productive_ms: 10_000, config }).supervisor_instruction,
    SUPERVISOR_INSTRUCTIONS.SEND_SOFT_STEER,
  );
  // untouched budgets keep their watchdog defaults
  assert.equal(
    bind({
      elapsed_since_productive_ms: 90_000,
      soft_steer_issued: true,
      config,
    }).supervisor_instruction,
    SUPERVISOR_INSTRUCTIONS.INTERRUPT_RUN,
  );
  assert.equal(
    bind({ elapsed_since_productive_ms: 9_999, config }).supervisor_instruction,
    SUPERVISOR_INSTRUCTIONS.CONTINUE_OBSERVING,
  );
});

test("output is frozen and carries the underlying watchdog verdict unchanged", () => {
  const input = { elapsed_since_productive_ms: 45_000 };
  const result = bind(input);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.control));
  assert.deepEqual(result.watchdog, watchdogFor(input));
  assert.ok(Object.isFrozen(result.watchdog));
});

test("verdict actions map onto exactly the four supervisor instructions", () => {
  assert.deepEqual(Object.values(SUPERVISOR_INSTRUCTIONS).sort(), [
    "await_blocked_resolution",
    "continue_observing",
    "interrupt_run",
    "send_soft_steer",
  ]);
  assert.deepEqual(Object.values(WATCHDOG_ACTIONS).sort(), [
    "interrupt",
    "none",
    "soft_steer",
  ]);
});
