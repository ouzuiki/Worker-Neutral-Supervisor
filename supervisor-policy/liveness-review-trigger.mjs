// WL7 advisory-only Phase 2 review trigger.
//
// The caller supplies ordered prior records; current_pattern is not part of
// history_records and is appended exactly once here. No history is stored.

import { isUnclassifiedPatternKey } from "./liveness-telemetry.mjs";

export const LIVENESS_PHASE2_REVIEW_RECOMMENDED =
  "LIVENESS_PHASE2_REVIEW_RECOMMENDED";

export const REVIEW_REASONS = Object.freeze({
  OPERATOR_REPEAT_FLAG: "operator_repeat_flag",
  SAME_PATTERN_RECURRENCE: "same_pattern_recurrence",
  RECENT_WINDOW_RECURRENCE: "recent_window_recurrence",
});

export const DEFAULT_REVIEW_CONFIG = Object.freeze({
  total_recurrence_threshold: 3,
  recent_recurrence_threshold: 2,
  recent_window_size: 10,
});

export const MAX_HISTORY_RECORDS = 100;

// The occurrence universe is the bounded history (<= MAX_HISTORY_RECORDS) plus
// the single current pattern, so no threshold or window larger than this can
// ever change an outcome. Cap config there to keep it genuinely small.
export const MAX_OCCURRENCE_UNIVERSE = MAX_HISTORY_RECORDS + 1;

function boundedPositiveInteger(value, label, max) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer`);
  }
  if (value > max) {
    throw new RangeError(`${label} must be a positive integer no greater than ${max}`);
  }
  return value;
}

function normalizeConfig(config) {
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    throw new TypeError("config must be an object");
  }
  for (const key of Object.keys(config)) {
    if (!Object.hasOwn(DEFAULT_REVIEW_CONFIG, key)) {
      throw new TypeError(`config has an unknown key: ${key}`);
    }
  }
  const recentWindowSize = boundedPositiveInteger(
    config.recent_window_size ?? DEFAULT_REVIEW_CONFIG.recent_window_size,
    "config.recent_window_size",
    MAX_OCCURRENCE_UNIVERSE,
  );
  return Object.freeze({
    total_recurrence_threshold: boundedPositiveInteger(
      config.total_recurrence_threshold ?? DEFAULT_REVIEW_CONFIG.total_recurrence_threshold,
      "config.total_recurrence_threshold",
      MAX_OCCURRENCE_UNIVERSE,
    ),
    recent_recurrence_threshold: boundedPositiveInteger(
      config.recent_recurrence_threshold ?? DEFAULT_REVIEW_CONFIG.recent_recurrence_threshold,
      "config.recent_recurrence_threshold",
      recentWindowSize,
    ),
    recent_window_size: recentWindowSize,
  });
}

function extractPattern(record) {
  if (record === null || typeof record !== "object" || Array.isArray(record)) return null;
  if (isUnclassifiedPatternKey(record.stall_pattern)) return record.stall_pattern;
  if (isUnclassifiedPatternKey(record.pattern_key)) return record.pattern_key;
  return null;
}

function output({ recommended, reason, patternKey, matchingCount, recentMatchingCount, windowSize }) {
  return Object.freeze({
    review_recommended: recommended,
    advisory_code: recommended ? LIVENESS_PHASE2_REVIEW_RECOMMENDED : null,
    reason,
    pattern_key: patternKey,
    matching_count: matchingCount,
    recent_matching_count: recentMatchingCount,
    recent_window_size: windowSize,
  });
}

export function evaluateLivenessReviewTrigger({
  current_pattern,
  history_records = [],
  operator_repeat_flag = false,
  config = DEFAULT_REVIEW_CONFIG,
} = {}) {
  const normalizedConfig = normalizeConfig(config);
  if (!Array.isArray(history_records)) {
    throw new TypeError("history_records must be an array");
  }
  if (history_records.length > MAX_HISTORY_RECORDS) {
    throw new RangeError(`history_records must contain at most ${MAX_HISTORY_RECORDS} records`);
  }
  if (!isUnclassifiedPatternKey(current_pattern)) {
    return output({
      recommended: false,
      reason: null,
      patternKey: null,
      matchingCount: 0,
      recentMatchingCount: 0,
      windowSize: normalizedConfig.recent_window_size,
    });
  }

  const priorPatterns = history_records.map(extractPattern).filter((value) => value !== null);
  const occurrences = [...priorPatterns, current_pattern];
  const matchingCount = occurrences.filter((value) => value === current_pattern).length;
  const recentMatchingCount = occurrences
    .slice(-normalizedConfig.recent_window_size)
    .filter((value) => value === current_pattern).length;

  let reason = null;
  if (operator_repeat_flag === true) {
    reason = REVIEW_REASONS.OPERATOR_REPEAT_FLAG;
  } else if (matchingCount >= normalizedConfig.total_recurrence_threshold) {
    reason = REVIEW_REASONS.SAME_PATTERN_RECURRENCE;
  } else if (recentMatchingCount >= normalizedConfig.recent_recurrence_threshold) {
    reason = REVIEW_REASONS.RECENT_WINDOW_RECURRENCE;
  }

  return output({
    recommended: reason !== null,
    reason,
    patternKey: current_pattern,
    matchingCount,
    recentMatchingCount,
    windowSize: normalizedConfig.recent_window_size,
  });
}
