// Supervisor Recovery Policy (WL3).
//
// Pure recommendation layer over WL2. It never invokes control, starts a run,
// or selects a Worker. Routing is explicitly delegated to the existing policy.

import {
  SUPERVISOR_INSTRUCTIONS,
  WATCHDOG_CONTROL_VERBS,
  WATCHDOG_SOFT_STEER_MESSAGE,
  WATCHDOG_TERMINAL_REASON,
} from "./reasoning-watchdog-binding.mjs";
import { LIVENESS_STATES } from "./liveness-verdict.mjs";

export const RECOVERY_ACTIONS = Object.freeze({
  CONTINUE_OBSERVING: "continue_observing",
  AWAIT_BLOCKED_RESOLUTION: "await_blocked_resolution",
  SOFT_STEER: "soft_steer",
  INTERRUPT: "interrupt",
  RECONCILE: "reconcile",
  RETRY_FRESH_RUN: "retry_fresh_run",
  REROUTE: "reroute",
  EXHAUSTED: "exhausted",
});

export const RECOVERY_REASONS = Object.freeze({
  HEALTHY: "liveness_healthy",
  BLOCKED: "liveness_blocked",
  SOFT_STEER_REQUIRED: "stall_suspected_soft_steer_required",
  RECOVERY_OBSERVATION: "soft_steer_recovery_observation",
  INTERRUPT_REQUIRED: "stall_confirmed_interrupt_required",
  INTERRUPT_OUTCOME_PENDING: "interrupt_outcome_pending",
  MUTATION_ACK_UNKNOWN: "mutation_ack_unknown",
  NATIVE_STATE_UNKNOWN: "native_state_unknown",
  RECONCILIATION_REQUIRED: "restart_requires_reconciliation",
  RESTART_SAFE: "reconciliation_restart_safe",
  REROUTE_REQUIRED: "recovery_budget_exhausted_delegate_routing",
  EXHAUSTED: "recovery_and_reroute_exhausted",
});

export const DEFAULT_RECOVERY_CONFIG = Object.freeze({ max_recovery_attempts: 1 });
export const ROUTING_POLICY_DELEGATE = "supervisor-policy/policy.mjs#selectWorker";

const MUTATION_ACKS = [null, "accepted", "rejected", "unknown"];
const NATIVE_STATES = ["active", "terminal", "unknown"];
const INTERRUPT_OUTCOMES = ["pending", "known"];
const RECONCILIATIONS = ["not_performed", "safe_to_restart", "unsafe_to_restart"];

function requireObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function nonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer`);
  }
  return value;
}

function enumValue(value, allowed, label) {
  if (!allowed.includes(value)) throw new TypeError(`${label} must be one of: ${allowed.join(", ")}`);
  return value;
}

function freezeRecoveryState(progressEpoch, recoveryAttempts, interruptIssued) {
  return Object.freeze({
    progress_epoch: nonNegativeInteger(progressEpoch, "recovery_state.progress_epoch"),
    recovery_attempts: nonNegativeInteger(recoveryAttempts, "recovery_state.recovery_attempts"),
    interrupt_issued: interruptIssued,
  });
}

export function createRecoveryState(progress_epoch = 0) {
  return freezeRecoveryState(progress_epoch, 0, false);
}

function normalizeRecoveryState(state) {
  const value = requireObject(state, "recovery_state");
  if (typeof value.interrupt_issued !== "boolean") {
    throw new TypeError("recovery_state.interrupt_issued must be a boolean");
  }
  return freezeRecoveryState(value.progress_epoch, value.recovery_attempts, value.interrupt_issued);
}

export function markRecoveryInterruptIssued(state) {
  const current = normalizeRecoveryState(state);
  return freezeRecoveryState(current.progress_epoch, current.recovery_attempts, true);
}

export function recordRecoveryAttempt(state) {
  const current = normalizeRecoveryState(state);
  return freezeRecoveryState(current.progress_epoch, current.recovery_attempts + 1, false);
}

function syncEpoch(state, progressEpoch) {
  const current = normalizeRecoveryState(state);
  return current.progress_epoch === progressEpoch ? current : createRecoveryState(progressEpoch);
}

function normalizeConfig(config) {
  const value = requireObject(config, "config");
  for (const key of Object.keys(value)) {
    if (key !== "max_recovery_attempts") throw new TypeError(`config has an unknown key: ${key}`);
  }
  return Object.freeze({
    max_recovery_attempts: nonNegativeInteger(
      value.max_recovery_attempts ?? DEFAULT_RECOVERY_CONFIG.max_recovery_attempts,
      "config.max_recovery_attempts",
    ),
  });
}

function normalizeEvidence(evidence) {
  const value = requireObject(evidence, "evidence");
  if (typeof (value.reroute_available ?? false) !== "boolean") {
    throw new TypeError("evidence.reroute_available must be a boolean");
  }
  return Object.freeze({
    mutation_ack: enumValue(value.mutation_ack ?? null, MUTATION_ACKS, "evidence.mutation_ack"),
    native_state: enumValue(value.native_state ?? "unknown", NATIVE_STATES, "evidence.native_state"),
    interrupt_outcome: enumValue(
      value.interrupt_outcome ?? "pending",
      INTERRUPT_OUTCOMES,
      "evidence.interrupt_outcome",
    ),
    reconciliation: enumValue(
      value.reconciliation ?? "not_performed",
      RECONCILIATIONS,
      "evidence.reconciliation",
    ),
    reroute_available: value.reroute_available ?? false,
  });
}

function recommendation(action, reason, recoveryState, additions = {}) {
  return Object.freeze({
    recommended_action: action,
    reason,
    recovery_state: recoveryState,
    ...additions,
  });
}

function exhaustedRecommendation(recoveryState, evidence) {
  if (evidence.reroute_available) {
    return recommendation(RECOVERY_ACTIONS.REROUTE, RECOVERY_REASONS.REROUTE_REQUIRED, recoveryState, {
      delegates_to: ROUTING_POLICY_DELEGATE,
    });
  }
  return recommendation(RECOVERY_ACTIONS.EXHAUSTED, RECOVERY_REASONS.EXHAUSTED, recoveryState);
}

export function evaluateRecoveryPolicy({
  liveness_verdict,
  recovery_state,
  evidence = {},
  config = DEFAULT_RECOVERY_CONFIG,
} = {}) {
  const verdict = requireObject(liveness_verdict, "liveness_verdict");
  enumValue(verdict.liveness, Object.values(LIVENESS_STATES), "liveness_verdict.liveness");
  const progressEpoch = nonNegativeInteger(verdict.progress_epoch, "liveness_verdict.progress_epoch");
  let state = syncEpoch(recovery_state, progressEpoch);
  const observed = normalizeEvidence(evidence);
  const normalizedConfig = normalizeConfig(config);

  if (verdict.liveness === LIVENESS_STATES.HEALTHY) {
    return recommendation(RECOVERY_ACTIONS.CONTINUE_OBSERVING, RECOVERY_REASONS.HEALTHY, state, {
      supervisor_instruction: SUPERVISOR_INSTRUCTIONS.CONTINUE_OBSERVING,
      control: null,
    });
  }
  if (verdict.liveness === LIVENESS_STATES.BLOCKED) {
    return recommendation(RECOVERY_ACTIONS.AWAIT_BLOCKED_RESOLUTION, RECOVERY_REASONS.BLOCKED, state, {
      supervisor_instruction: SUPERVISOR_INSTRUCTIONS.AWAIT_BLOCKED_RESOLUTION,
      control: null,
    });
  }
  if (verdict.liveness === LIVENESS_STATES.STALL_SUSPECTED) {
    return recommendation(RECOVERY_ACTIONS.SOFT_STEER, RECOVERY_REASONS.SOFT_STEER_REQUIRED, state, {
      supervisor_instruction: SUPERVISOR_INSTRUCTIONS.SEND_SOFT_STEER,
      control: Object.freeze({ verb: WATCHDOG_CONTROL_VERBS.STEER, message: WATCHDOG_SOFT_STEER_MESSAGE }),
    });
  }
  if (verdict.liveness === LIVENESS_STATES.RECOVERING) {
    return recommendation(RECOVERY_ACTIONS.CONTINUE_OBSERVING, RECOVERY_REASONS.RECOVERY_OBSERVATION, state, {
      supervisor_instruction: SUPERVISOR_INSTRUCTIONS.CONTINUE_OBSERVING,
      control: null,
    });
  }

  // stall_confirmed
  if (!state.interrupt_issued) {
    return recommendation(RECOVERY_ACTIONS.INTERRUPT, RECOVERY_REASONS.INTERRUPT_REQUIRED, state, {
      supervisor_instruction: SUPERVISOR_INSTRUCTIONS.INTERRUPT_RUN,
      control: Object.freeze({
        verb: WATCHDOG_CONTROL_VERBS.INTERRUPT,
        terminal_reason: WATCHDOG_TERMINAL_REASON,
      }),
    });
  }
  if (observed.mutation_ack === "unknown") {
    return recommendation(RECOVERY_ACTIONS.RECONCILE, RECOVERY_REASONS.MUTATION_ACK_UNKNOWN, state);
  }
  if (observed.native_state === "unknown") {
    return recommendation(RECOVERY_ACTIONS.RECONCILE, RECOVERY_REASONS.NATIVE_STATE_UNKNOWN, state);
  }
  if (observed.interrupt_outcome !== "known") {
    return recommendation(RECOVERY_ACTIONS.CONTINUE_OBSERVING, RECOVERY_REASONS.INTERRUPT_OUTCOME_PENDING, state);
  }
  if (observed.native_state === "active") {
    return recommendation(RECOVERY_ACTIONS.RECONCILE, RECOVERY_REASONS.RECONCILIATION_REQUIRED, state);
  }
  if (observed.reconciliation === "not_performed") {
    return recommendation(RECOVERY_ACTIONS.RECONCILE, RECOVERY_REASONS.RECONCILIATION_REQUIRED, state);
  }
  if (observed.reconciliation === "unsafe_to_restart") {
    return exhaustedRecommendation(state, observed);
  }
  if (state.recovery_attempts < normalizedConfig.max_recovery_attempts) {
    return recommendation(RECOVERY_ACTIONS.RETRY_FRESH_RUN, RECOVERY_REASONS.RESTART_SAFE, state);
  }
  return exhaustedRecommendation(state, observed);
}
