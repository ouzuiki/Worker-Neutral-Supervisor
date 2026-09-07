import assert from "node:assert/strict";
import test from "node:test";

import {
  SUPERVISOR_INSTRUCTIONS,
  WATCHDOG_CONTROL_VERBS,
  WATCHDOG_SOFT_STEER_MESSAGE,
} from "./reasoning-watchdog-binding.mjs";
import {
  DEFAULT_RECOVERY_CONFIG,
  RECOVERY_ACTIONS,
  ROUTING_POLICY_DELEGATE,
  createRecoveryState,
  evaluateRecoveryPolicy,
  markRecoveryInterruptIssued,
  recordRecoveryAttempt,
} from "./liveness-recovery.mjs";

function verdict(liveness, progress_epoch = 1) {
  return Object.freeze({ liveness, progress_epoch });
}

function evaluate(liveness, overrides = {}) {
  return evaluateRecoveryPolicy({
    liveness_verdict: verdict(liveness, overrides.progress_epoch ?? 1),
    recovery_state: overrides.recovery_state ?? createRecoveryState(1),
    evidence: overrides.evidence,
    config: overrides.config,
  });
}

test("healthy continues without replenishing bookkeeping inside the same epoch", () => {
  const dirty = markRecoveryInterruptIssued(recordRecoveryAttempt(createRecoveryState(1)));
  const result = evaluate("healthy", { recovery_state: dirty });
  assert.equal(result.recommended_action, RECOVERY_ACTIONS.CONTINUE_OBSERVING);
  assert.deepEqual(result.recovery_state, dirty);
});

test("blocked awaits resolution without counting a retry", () => {
  const state = recordRecoveryAttempt(createRecoveryState(1));
  const result = evaluate("blocked", { recovery_state: state });
  assert.equal(result.recommended_action, RECOVERY_ACTIONS.AWAIT_BLOCKED_RESOLUTION);
  assert.equal(result.recovery_state.recovery_attempts, 1);
});

test("stall suspected recommends the existing soft-steer control unchanged", () => {
  const result = evaluate("stall_suspected");
  assert.equal(result.recommended_action, RECOVERY_ACTIONS.SOFT_STEER);
  assert.equal(result.supervisor_instruction, SUPERVISOR_INSTRUCTIONS.SEND_SOFT_STEER);
  assert.deepEqual(result.control, {
    verb: WATCHDOG_CONTROL_VERBS.STEER,
    message: WATCHDOG_SOFT_STEER_MESSAGE,
  });
});

test("recovering continues observation and does not interrupt", () => {
  const result = evaluate("recovering");
  assert.equal(result.recommended_action, RECOVERY_ACTIONS.CONTINUE_OBSERVING);
  assert.equal(result.control, null);
});

test("confirmed stall recommends interrupt until interrupt is recorded", () => {
  const result = evaluate("stall_confirmed");
  assert.equal(result.recommended_action, RECOVERY_ACTIONS.INTERRUPT);
  assert.equal(result.supervisor_instruction, SUPERVISOR_INSTRUCTIONS.INTERRUPT_RUN);
  assert.equal(result.control.verb, WATCHDOG_CONTROL_VERBS.INTERRUPT);
});

test("pending interrupt outcome continues observing", () => {
  const state = markRecoveryInterruptIssued(createRecoveryState(1));
  const result = evaluate("stall_confirmed", {
    recovery_state: state,
    evidence: { mutation_ack: "accepted", native_state: "active" },
  });
  assert.equal(result.recommended_action, RECOVERY_ACTIONS.CONTINUE_OBSERVING);
});

test("UNKNOWN mutation acknowledgement forces reconcile and cannot replay", () => {
  const state = markRecoveryInterruptIssued(createRecoveryState(1));
  const result = evaluate("stall_confirmed", {
    recovery_state: state,
    evidence: {
      mutation_ack: "unknown",
      native_state: "terminal",
      interrupt_outcome: "known",
      reconciliation: "safe_to_restart",
    },
  });
  assert.equal(result.recommended_action, RECOVERY_ACTIONS.RECONCILE);
  assert.notEqual(result.recommended_action, RECOVERY_ACTIONS.RETRY_FRESH_RUN);
});

test("unknown native state also forces reconcile", () => {
  const state = markRecoveryInterruptIssued(createRecoveryState(1));
  const result = evaluate("stall_confirmed", {
    recovery_state: state,
    evidence: { mutation_ack: "accepted", interrupt_outcome: "known" },
  });
  assert.equal(result.recommended_action, RECOVERY_ACTIONS.RECONCILE);
});

test("known active native execution cannot advance to retry", () => {
  const state = markRecoveryInterruptIssued(createRecoveryState(1));
  const result = evaluate("stall_confirmed", {
    recovery_state: state,
    evidence: {
      mutation_ack: "accepted",
      native_state: "active",
      interrupt_outcome: "known",
      reconciliation: "safe_to_restart",
    },
  });
  assert.equal(result.recommended_action, RECOVERY_ACTIONS.RECONCILE);
  assert.notEqual(result.recommended_action, RECOVERY_ACTIONS.RETRY_FRESH_RUN);
});

test("known interrupt outcome still requires explicit safe reconciliation before retry", () => {
  const state = markRecoveryInterruptIssued(createRecoveryState(1));
  const result = evaluate("stall_confirmed", {
    recovery_state: state,
    evidence: { mutation_ack: "accepted", native_state: "terminal", interrupt_outcome: "known" },
  });
  assert.equal(result.recommended_action, RECOVERY_ACTIONS.RECONCILE);
});

test("safe reconciliation recommends a bounded fresh-run retry without invoking start", () => {
  const state = markRecoveryInterruptIssued(createRecoveryState(1));
  const result = evaluate("stall_confirmed", {
    recovery_state: state,
    evidence: {
      mutation_ack: "accepted",
      native_state: "terminal",
      interrupt_outcome: "known",
      reconciliation: "safe_to_restart",
    },
  });
  assert.equal(result.recommended_action, RECOVERY_ACTIONS.RETRY_FRESH_RUN);
  assert.equal(result.worker, undefined);
  assert.equal(result.control, undefined);
});

test("retry budget exhaustion delegates reroute to existing worker selection", () => {
  const exhausted = markRecoveryInterruptIssued(recordRecoveryAttempt(createRecoveryState(1)));
  const result = evaluate("stall_confirmed", {
    recovery_state: exhausted,
    evidence: {
      mutation_ack: "accepted",
      native_state: "terminal",
      interrupt_outcome: "known",
      reconciliation: "safe_to_restart",
      reroute_available: true,
    },
  });
  assert.equal(DEFAULT_RECOVERY_CONFIG.max_recovery_attempts, 1);
  assert.equal(result.recommended_action, RECOVERY_ACTIONS.REROUTE);
  assert.equal(result.delegates_to, ROUTING_POLICY_DELEGATE);
  assert.equal(result.worker, undefined);
});

test("reroute unavailable after retry exhaustion recommends terminal exhaustion", () => {
  const exhausted = markRecoveryInterruptIssued(recordRecoveryAttempt(createRecoveryState(1)));
  const result = evaluate("stall_confirmed", {
    recovery_state: exhausted,
    evidence: {
      mutation_ack: "accepted",
      native_state: "terminal",
      interrupt_outcome: "known",
      reconciliation: "safe_to_restart",
      reroute_available: false,
    },
  });
  assert.equal(result.recommended_action, RECOVERY_ACTIONS.EXHAUSTED);
});

test("new WL1 progress epoch resets recovery attempts and interrupt state", () => {
  const old = markRecoveryInterruptIssued(recordRecoveryAttempt(createRecoveryState(1)));
  const result = evaluate("healthy", { progress_epoch: 2, recovery_state: old });
  assert.deepEqual(result.recovery_state, createRecoveryState(2));
});

test("recovery outputs and state are immutable", () => {
  const result = evaluate("stall_suspected");
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.recovery_state));
  assert.ok(Object.isFrozen(result.control));
});
