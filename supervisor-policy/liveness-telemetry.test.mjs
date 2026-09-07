import assert from "node:assert/strict";
import test from "node:test";

import { RECOVERY_ACTIONS, createRecoveryState } from "./liveness-recovery.mjs";
import {
  AUTOMATIC_STALL_REASONS,
  RECOVERY_ACTION_LABELS,
  STALL_REASONS,
  mapLivenessTelemetry,
} from "./liveness-telemetry.mjs";

function map(liveness, action = RECOVERY_ACTIONS.CONTINUE_OBSERVING, overrides = {}) {
  return mapLivenessTelemetry({
    liveness_verdict: { liveness },
    recovery_recommendation: {
      recommended_action: action,
      recovery_state: overrides.recovery_state ?? createRecoveryState(),
    },
    post_recovery_progress: overrides.post_recovery_progress,
  });
}

test("WL4 preserves reasoning-only as the sole automatically mapped Phase 1 reason", () => {
  assert.deepEqual(STALL_REASONS, ["reasoning_only_no_progress", "unclassified"]);
  assert.deepEqual(AUTOMATIC_STALL_REASONS, ["reasoning_only_no_progress"]);
  assert.ok(Object.isFrozen(STALL_REASONS));
  for (const deferred of ["repeated_action", "repeated_error", "ping_pong", "runtime_silence"]) {
    assert.equal(STALL_REASONS.includes(deferred), false);
  }
});

test("ordinary WL4 mapping never returns the explicit-only unclassified reason", () => {
  for (const liveness of ["healthy", "blocked", "stall_suspected", "recovering", "stall_confirmed"]) {
    assert.notEqual(map(liveness).stall_reason, "unclassified");
  }
});

test("recovery taxonomy is exactly none plus existing WL3 actions", () => {
  assert.deepEqual(RECOVERY_ACTION_LABELS, ["none", ...Object.values(RECOVERY_ACTIONS)]);
  assert.ok(Object.isFrozen(RECOVERY_ACTION_LABELS));
});

test("all Phase 1 reasoning stall verdicts map consistently", () => {
  for (const liveness of ["stall_suspected", "recovering", "stall_confirmed"]) {
    const labels = map(liveness);
    assert.equal(labels.stall_detected, true);
    assert.equal(labels.stall_reason, "reasoning_only_no_progress");
  }
});

test("valid WL3 recommendations map without renaming", () => {
  for (const action of Object.values(RECOVERY_ACTIONS)) {
    assert.equal(map("stall_confirmed", action).recovery_action, action);
  }
});

test("healthy and blocked verdicts never fabricate a stall", () => {
  for (const liveness of ["healthy", "blocked"]) {
    const labels = map(liveness);
    assert.equal(labels.stall_detected, false);
    assert.equal(labels.stall_reason, null);
  }
});

test("post-recovery progress requires explicit evidence and a healthy verdict", () => {
  assert.equal(map("healthy", undefined, { post_recovery_progress: true }).post_recovery_progress, true);
  assert.equal(map("healthy").post_recovery_progress, false);
  assert.equal(map("recovering", undefined, { post_recovery_progress: true }).post_recovery_progress, false);
});

test("malformed mapping inputs collapse to bounded null/zero labels", () => {
  const labels = mapLivenessTelemetry({
    liveness_verdict: { liveness: "ARBITRARY_LIVENESS_TEXT" },
    recovery_recommendation: {
      recommended_action: "ARBITRARY_RECOVERY_TEXT",
      recovery_state: { recovery_attempts: "many" },
    },
    post_recovery_progress: true,
  });
  assert.deepEqual(labels, {
    stall_detected: false,
    stall_reason: null,
    recovery_action: null,
    recovery_count: 0,
    post_recovery_progress: false,
  });
  assert.ok(Object.isFrozen(labels));
});
