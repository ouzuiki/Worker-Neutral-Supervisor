// Worker-neutral Reasoning Watchdog binding layer.
//
// Pure, deterministic translation of evaluateReasoningWatchdog() verdicts into
// the worker-neutral Supervisor control verbs. This module never executes a
// tool, never calls a bridge, and adds no threshold logic of its own: it
// delegates entirely to reasoning-watchdog.mjs and only maps the resulting
// action/reason onto a supervisor_instruction (+ optional control verb).

import {
  WATCHDOG_ACTIONS,
  WATCHDOG_REASONS,
  evaluateReasoningWatchdog,
} from "./reasoning-watchdog.mjs";

export const SUPERVISOR_INSTRUCTIONS = Object.freeze({
  CONTINUE_OBSERVING: "continue_observing",
  AWAIT_BLOCKED_RESOLUTION: "await_blocked_resolution",
  SEND_SOFT_STEER: "send_soft_steer",
  INTERRUPT_RUN: "interrupt_run",
});

export const WATCHDOG_CONTROL_VERBS = Object.freeze({
  STEER: "steer",
  INTERRUPT: "interrupt",
});

export const WATCHDOG_TERMINAL_REASON = "reasoning_budget_exceeded";

// Fixed, worker-neutral steer text. Concise and operational: it tells the worker
// to stop analysing and produce a result now.
export const WATCHDOG_SOFT_STEER_MESSAGE =
  "Evidence gathered so far is sufficient. Stop further analysis and produce a " +
  "concise final result for the current step now. Do not call more tools unless " +
  "a concrete unresolved contradiction genuinely requires it. If the only " +
  "remaining blocker is missing external or version-sensitive information, a " +
  "single bounded read-only web search or page read is acceptable; this is a " +
  "suggestion, not a requirement, and must stay within that one bounded lookup.";

function mappingError(verdict) {
  return new Error(
    `reasoning-watchdog-binding: impossible watchdog verdict mapping ` +
      `(action=${verdict.action}, reason=${verdict.reason})`,
  );
}

/**
 * Translate a Reasoning Watchdog verdict into a Supervisor instruction.
 *
 * @param {object} input
 * @param {object} input.semantic_progress neutral semantic progress shape
 * @param {number} input.elapsed_since_productive_ms non-negative integer ms
 * @param {boolean} input.soft_steer_issued whether a soft steer was already sent
 * @param {object} [input.config] budget overrides forwarded verbatim
 */
export function evaluateWatchdogBinding({
  semantic_progress,
  elapsed_since_productive_ms,
  soft_steer_issued,
  config,
} = {}) {
  const watchdog = evaluateReasoningWatchdog({
    semantic_progress,
    elapsed_since_productive_ms,
    soft_steer_issued,
    ...(config === undefined ? {} : { config }),
  });

  // Blocked / pending approval is never spinning: no control verb, just wait.
  if (watchdog.reason === WATCHDOG_REASONS.BLOCKED_PENDING_APPROVAL) {
    if (watchdog.action !== WATCHDOG_ACTIONS.NONE) {
      throw mappingError(watchdog);
    }
    return Object.freeze({
      supervisor_instruction: SUPERVISOR_INSTRUCTIONS.AWAIT_BLOCKED_RESOLUTION,
      control: null,
      watchdog,
    });
  }

  switch (watchdog.action) {
    case WATCHDOG_ACTIONS.NONE:
      return Object.freeze({
        supervisor_instruction: SUPERVISOR_INSTRUCTIONS.CONTINUE_OBSERVING,
        control: null,
        watchdog,
      });

    case WATCHDOG_ACTIONS.SOFT_STEER:
      return Object.freeze({
        supervisor_instruction: SUPERVISOR_INSTRUCTIONS.SEND_SOFT_STEER,
        control: Object.freeze({
          verb: WATCHDOG_CONTROL_VERBS.STEER,
          message: WATCHDOG_SOFT_STEER_MESSAGE,
        }),
        watchdog,
      });

    case WATCHDOG_ACTIONS.INTERRUPT:
      return Object.freeze({
        supervisor_instruction: SUPERVISOR_INSTRUCTIONS.INTERRUPT_RUN,
        control: Object.freeze({
          verb: WATCHDOG_CONTROL_VERBS.INTERRUPT,
          terminal_reason: WATCHDOG_TERMINAL_REASON,
        }),
        watchdog,
      });

    default:
      throw mappingError(watchdog);
  }
}
