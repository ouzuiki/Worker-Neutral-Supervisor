// WL4 bounded taxonomy and pure mapping into privacy-safe telemetry labels.
// Observational only: this module does not detect stalls or influence policy.

import { RECOVERY_ACTIONS } from "./liveness-recovery.mjs";
import { LIVENESS_STATES } from "./liveness-verdict.mjs";
import { TASK_CLASSES, WORKERS } from "./policy.mjs";
import { WATCHDOG_SEMANTIC_STATES } from "./reasoning-watchdog.mjs";

export const STALL_REASONS = Object.freeze(["reasoning_only_no_progress", "unclassified"]);
export const AUTOMATIC_STALL_REASONS = Object.freeze(["reasoning_only_no_progress"]);
export const RECOVERY_ACTION_LABELS = Object.freeze([
  "none",
  ...Object.values(RECOVERY_ACTIONS),
]);
export const UNCLASSIFIED_PATTERN_VERSION = "u1";

const UNKNOWN = "unknown";
const PATTERN_ENUMS = Object.freeze([
  Object.freeze([...WORKERS, UNKNOWN]),
  Object.freeze([...TASK_CLASSES, UNKNOWN]),
  Object.freeze([...Object.values(LIVENESS_STATES), UNKNOWN]),
  Object.freeze([...Object.values(WATCHDOG_SEMANTIC_STATES), UNKNOWN]),
  Object.freeze([...RECOVERY_ACTION_LABELS, UNKNOWN]),
]);

function objectOrEmpty(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function recoveryCount(recommendation) {
  const count = objectOrEmpty(recommendation.recovery_state).recovery_attempts;
  return Number.isInteger(count) && count >= 0 ? count : 0;
}

function boundedEnum(value, allowed) {
  return allowed.includes(value) ? value : UNKNOWN;
}

export function isUnclassifiedPatternKey(value) {
  if (typeof value !== "string" || value.length > 160) return false;
  const parts = value.split(":");
  return (
    parts.length === 6 &&
    parts[0] === UNCLASSIFIED_PATTERN_VERSION &&
    PATTERN_ENUMS.every((allowed, index) => allowed.includes(parts[index + 1]))
  );
}

export function captureUnclassifiedStall({ explicit_unclassified, evidence } = {}) {
  if (explicit_unclassified !== true) {
    return Object.freeze({
      captured: false,
      stall_reason: null,
      pattern_key: null,
      evidence: null,
    });
  }

  const value = objectOrEmpty(evidence);
  const normalized = Object.freeze({
    worker: boundedEnum(value.worker, PATTERN_ENUMS[0]),
    task_class: boundedEnum(value.task_class, PATTERN_ENUMS[1]),
    liveness_state: boundedEnum(value.liveness_state, PATTERN_ENUMS[2]),
    semantic_state: boundedEnum(value.semantic_state, PATTERN_ENUMS[3]),
    recovery_action: boundedEnum(value.recovery_action, PATTERN_ENUMS[4]),
  });
  const patternKey = [UNCLASSIFIED_PATTERN_VERSION, ...Object.values(normalized)].join(":");

  return Object.freeze({
    captured: true,
    stall_reason: "unclassified",
    pattern_key: patternKey,
    evidence: normalized,
  });
}

export function mapLivenessTelemetry({
  liveness_verdict,
  recovery_recommendation,
  post_recovery_progress = false,
} = {}) {
  const verdict = objectOrEmpty(liveness_verdict);
  const recommendation = objectOrEmpty(recovery_recommendation);
  const stallDetected = [
    LIVENESS_STATES.STALL_SUSPECTED,
    LIVENESS_STATES.RECOVERING,
    LIVENESS_STATES.STALL_CONFIRMED,
  ].includes(verdict.liveness);
  const action = RECOVERY_ACTION_LABELS.includes(recommendation.recommended_action)
    ? recommendation.recommended_action
    : null;

  return Object.freeze({
    stall_detected: stallDetected,
    stall_reason: stallDetected ? AUTOMATIC_STALL_REASONS[0] : null,
    recovery_action: action,
    recovery_count: recoveryCount(recommendation),
    post_recovery_progress:
      verdict.liveness === LIVENESS_STATES.HEALTHY && post_recovery_progress === true,
  });
}
