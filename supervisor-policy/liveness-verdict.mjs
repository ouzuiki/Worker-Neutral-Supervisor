// Supervisor-internal Liveness Verdict layer (WL2).
//
// This is execution-health judgment, not Worker lifecycle. It is pure and
// deterministic, delegates all budget logic to the v0 Reasoning Watchdog, and
// takes soft-steer authority only from the current WL1 progress epoch.

import { observeLiveness } from "./liveness-state.mjs";
import {
  WATCHDOG_ACTIONS,
  WATCHDOG_SEMANTIC_STATES,
  evaluateReasoningWatchdog,
} from "./reasoning-watchdog.mjs";

export const LIVENESS_STATES = Object.freeze({
  HEALTHY: "healthy",
  BLOCKED: "blocked",
  STALL_SUSPECTED: "stall_suspected",
  RECOVERING: "recovering",
  STALL_CONFIRMED: "stall_confirmed",
});

function mapLiveness(watchdog, softSteerIssued) {
  if (watchdog.semantic_state === WATCHDOG_SEMANTIC_STATES.PRODUCTIVE) {
    return LIVENESS_STATES.HEALTHY;
  }
  if (watchdog.semantic_state === WATCHDOG_SEMANTIC_STATES.BLOCKED) {
    return LIVENESS_STATES.BLOCKED;
  }
  if (watchdog.action === WATCHDOG_ACTIONS.INTERRUPT) {
    return LIVENESS_STATES.STALL_CONFIRMED;
  }
  if (softSteerIssued) {
    return LIVENESS_STATES.RECOVERING;
  }
  if (watchdog.action === WATCHDOG_ACTIONS.SOFT_STEER) {
    return LIVENESS_STATES.STALL_SUSPECTED;
  }
  return LIVENESS_STATES.HEALTHY;
}

export function evaluateLivenessVerdict({
  liveness_state,
  semantic_progress,
  elapsed_since_productive_ms,
  config,
} = {}) {
  const executionState = observeLiveness(liveness_state, semantic_progress);
  const softSteerIssued = executionState.episode.soft_steer_issued;
  const watchdog = evaluateReasoningWatchdog({
    semantic_progress,
    elapsed_since_productive_ms,
    soft_steer_issued: softSteerIssued,
    ...(config === undefined ? {} : { config }),
  });

  return Object.freeze({
    liveness: mapLiveness(watchdog, softSteerIssued),
    reason: watchdog.reason,
    progress_epoch: executionState.progress_epoch,
    execution_state: executionState,
    watchdog,
  });
}
