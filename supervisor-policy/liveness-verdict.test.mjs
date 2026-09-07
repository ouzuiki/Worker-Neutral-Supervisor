import assert from "node:assert/strict";
import test from "node:test";

import {
  createLivenessState,
  markSoftSteerIssued,
  observeLiveness,
} from "./liveness-state.mjs";
import {
  LIVENESS_STATES,
  evaluateLivenessVerdict,
} from "./liveness-verdict.mjs";
import { WATCHDOG_ACTIONS, WATCHDOG_REASONS } from "./reasoning-watchdog.mjs";

function progress(semantic_state, overrides = {}) {
  return {
    semantic_state,
    last_productive_at: "2026-09-07T00:00:00.000Z",
    last_productive_cursor: 1,
    thinking_tokens_since_productive: 0,
    ...overrides,
  };
}

function verdict({ state = createLivenessState(), semantic_state = "reasoning_only", ...input } = {}) {
  return evaluateLivenessVerdict({
    liveness_state: state,
    semantic_progress: progress(semantic_state, input.semantic_progress),
    elapsed_since_productive_ms: input.elapsed_since_productive_ms ?? 0,
  });
}

test("WL2 exposes exactly the five Supervisor-internal liveness states", () => {
  assert.deepEqual(Object.values(LIVENESS_STATES).sort(), [
    "blocked",
    "healthy",
    "recovering",
    "stall_confirmed",
    "stall_suspected",
  ]);
  assert.ok(Object.isFrozen(LIVENESS_STATES));
});

test("productive maps to healthy", () => {
  const result = verdict({ semantic_state: "productive" });
  assert.equal(result.liveness, LIVENESS_STATES.HEALTHY);
  assert.equal(result.reason, WATCHDOG_REASONS.PRODUCTIVE_PROGRESS);
});

test("blocked maps to blocked regardless of large counters", () => {
  const result = verdict({
    semantic_state: "blocked",
    semantic_progress: { thinking_tokens_since_productive: 99_999 },
    elapsed_since_productive_ms: 999_999,
  });
  assert.equal(result.liveness, LIVENESS_STATES.BLOCKED);
  assert.equal(result.reason, WATCHDOG_REASONS.BLOCKED_PENDING_APPROVAL);
});

test("reasoning below the soft threshold maps to healthy", () => {
  const result = verdict({
    semantic_progress: { thinking_tokens_since_productive: 3_999 },
    elapsed_since_productive_ms: 44_999,
  });
  assert.equal(result.liveness, LIVENESS_STATES.HEALTHY);
  assert.equal(result.reason, WATCHDOG_REASONS.REASONING_WITHIN_BUDGET);
});

test("reasoning at the soft threshold before first steer maps to stall_suspected", () => {
  const result = verdict({ elapsed_since_productive_ms: 45_000 });
  assert.equal(result.liveness, LIVENESS_STATES.STALL_SUSPECTED);
  assert.equal(result.watchdog.action, WATCHDOG_ACTIONS.SOFT_STEER);
});

test("hard threshold without a current-epoch steer remains stall_suspected", () => {
  const result = verdict({ elapsed_since_productive_ms: 90_000 });
  assert.equal(result.liveness, LIVENESS_STATES.STALL_SUSPECTED);
  assert.equal(
    result.reason,
    WATCHDOG_REASONS.REASONING_HARD_BUDGET_EXCEEDED_AWAITING_STEER,
  );
});

test("reasoning below hard after a current-epoch steer maps to recovering", () => {
  const state = markSoftSteerIssued(createLivenessState());
  const result = verdict({ state, elapsed_since_productive_ms: 89_999 });
  assert.equal(result.liveness, LIVENESS_STATES.RECOVERING);
  assert.equal(result.reason, WATCHDOG_REASONS.REASONING_POST_STEER_WITHIN_HARD_BUDGET);
  assert.equal(result.watchdog.soft_steer_issued, true);
});

test("hard threshold after a current-epoch steer maps to stall_confirmed", () => {
  const state = markSoftSteerIssued(createLivenessState());
  const result = verdict({ state, elapsed_since_productive_ms: 90_000 });
  assert.equal(result.liveness, LIVENESS_STATES.STALL_CONFIRMED);
  assert.equal(result.reason, WATCHDOG_REASONS.REASONING_HARD_BUDGET_EXCEEDED);
});

test("new productive epoch resets a recovering episode to healthy", () => {
  const epochOne = observeLiveness(createLivenessState(), progress("productive"));
  const recovering = verdict({
    state: markSoftSteerIssued(epochOne),
    elapsed_since_productive_ms: 89_999,
  });
  const progressed = evaluateLivenessVerdict({
    liveness_state: recovering.execution_state,
    semantic_progress: progress("productive", {
      last_productive_at: "2026-09-07T00:00:01.000Z",
      last_productive_cursor: 2,
    }),
    elapsed_since_productive_ms: 0,
  });
  assert.equal(recovering.liveness, LIVENESS_STATES.RECOVERING);
  assert.equal(progressed.liveness, LIVENESS_STATES.HEALTHY);
  assert.equal(progressed.progress_epoch, 2);
  assert.equal(progressed.execution_state.episode.soft_steer_issued, false);
});

test("new productive epoch resets a suspected episode to healthy", () => {
  const suspected = verdict({ elapsed_since_productive_ms: 45_000 });
  const progressed = evaluateLivenessVerdict({
    liveness_state: suspected.execution_state,
    semantic_progress: progress("productive", { last_productive_cursor: 2 }),
    elapsed_since_productive_ms: 0,
  });
  assert.equal(suspected.liveness, LIVENESS_STATES.STALL_SUSPECTED);
  assert.equal(progressed.liveness, LIVENESS_STATES.HEALTHY);
  assert.equal(progressed.execution_state.episode.soft_steer_issued, false);
});

test("verdict is immutable, reason-coded, and carries the watchdog verdict unchanged", () => {
  const result = verdict({ elapsed_since_productive_ms: 45_000 });
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.execution_state));
  assert.ok(Object.isFrozen(result.watchdog));
  assert.equal(result.reason, result.watchdog.reason);
  assert.equal(result.watchdog.soft_steer_issued, result.execution_state.episode.soft_steer_issued);
});
