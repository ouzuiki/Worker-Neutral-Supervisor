// Worker-neutral passive semantic-progress diagnostics.
//
// This module normalizes Bridge telemetry and classifies the observed reasoning
// budget. It has no control verbs, does not recommend steering/interruption,
// and performs no I/O. Elapsed time and token counts are diagnostic facts only.

export const WATCHDOG_SEMANTIC_STATES = Object.freeze({
  PRODUCTIVE: "productive",
  BLOCKED: "blocked",
  REASONING_ONLY: "reasoning_only",
});

export const WATCHDOG_DIAGNOSTIC_STATES = Object.freeze({
  PRODUCTIVE: "productive",
  BLOCKED: "blocked",
  REASONING_WITHIN_BUDGET: "reasoning_within_budget",
  REASONING_SOFT_BUDGET_EXCEEDED: "reasoning_soft_budget_exceeded",
  REASONING_HARD_BUDGET_EXCEEDED: "reasoning_hard_budget_exceeded",
});

export const WATCHDOG_REASONS = Object.freeze({
  PRODUCTIVE_PROGRESS: "productive_progress",
  BLOCKED_PENDING_APPROVAL: "blocked_pending_approval",
  REASONING_WITHIN_BUDGET: "reasoning_within_budget",
  REASONING_SOFT_BUDGET_EXCEEDED: "reasoning_soft_budget_exceeded",
  REASONING_HARD_BUDGET_EXCEEDED: "reasoning_hard_budget_exceeded",
});

export const DEFAULT_WATCHDOG_CONFIG = Object.freeze({
  soft_after_ms: 45_000,
  soft_after_thinking_tokens: 4_000,
  hard_after_ms: 90_000,
  hard_after_thinking_tokens: 7_000,
});

const VALID_STATES = new Set(Object.values(WATCHDOG_SEMANTIC_STATES));
const CONFIG_KEYS = Object.freeze(Object.keys(DEFAULT_WATCHDOG_CONFIG));

function requireObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function nonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new TypeError(`${label} must be a non-negative integer`);
  return value;
}

function integerOrNull(value, label) {
  return value === null ? null : nonNegativeInteger(value, label);
}

function stringOrNull(value, label) {
  if (value !== null && typeof value !== "string") throw new TypeError(`${label} must be a string or null`);
  return value;
}

function normalizeConfig(config) {
  const source = requireObject(config, "config");
  for (const key of Object.keys(source)) if (!CONFIG_KEYS.includes(key)) throw new TypeError(`config has an unknown key: ${key}`);
  const value = Object.fromEntries(CONFIG_KEYS.map(key => [key, nonNegativeInteger(source[key] ?? DEFAULT_WATCHDOG_CONFIG[key], `config.${key}`)]));
  if (value.hard_after_ms < value.soft_after_ms) throw new TypeError("config.hard_after_ms must be >= config.soft_after_ms");
  if (value.hard_after_thinking_tokens < value.soft_after_thinking_tokens) throw new TypeError("config.hard_after_thinking_tokens must be >= config.soft_after_thinking_tokens");
  return Object.freeze(value);
}

export function normalizeSemanticProgress(semanticProgress) {
  const source = requireObject(semanticProgress, "semantic_progress");
  if (!VALID_STATES.has(source.semantic_state)) throw new TypeError("semantic_progress.semantic_state must be productive, blocked, or reasoning_only");
  return Object.freeze({
    semantic_state: source.semantic_state,
    last_productive_at: stringOrNull(source.last_productive_at ?? null, "semantic_progress.last_productive_at"),
    last_productive_cursor: integerOrNull(source.last_productive_cursor ?? null, "semantic_progress.last_productive_cursor"),
    thinking_tokens_since_productive: integerOrNull(source.thinking_tokens_since_productive, "semantic_progress.thinking_tokens_since_productive"),
  });
}

export function evaluateReasoningWatchdog(input = {}) {
  const value = requireObject(input, "input");
  for (const key of Object.keys(value)) {
    if (!["semantic_progress", "elapsed_since_productive_ms", "config"].includes(key)) throw new TypeError(`input has an unknown key: ${key}`);
  }
  const { semantic_progress, elapsed_since_productive_ms, config = DEFAULT_WATCHDOG_CONFIG } = value;
  const thresholds = normalizeConfig(config);
  const progress = normalizeSemanticProgress(semantic_progress);
  const elapsed = nonNegativeInteger(elapsed_since_productive_ms, "elapsed_since_productive_ms");
  const tokens = progress.thinking_tokens_since_productive;

  let diagnostic_state;
  let reason;
  if (progress.semantic_state === WATCHDOG_SEMANTIC_STATES.PRODUCTIVE) {
    diagnostic_state = WATCHDOG_DIAGNOSTIC_STATES.PRODUCTIVE;
    reason = WATCHDOG_REASONS.PRODUCTIVE_PROGRESS;
  } else if (progress.semantic_state === WATCHDOG_SEMANTIC_STATES.BLOCKED) {
    diagnostic_state = WATCHDOG_DIAGNOSTIC_STATES.BLOCKED;
    reason = WATCHDOG_REASONS.BLOCKED_PENDING_APPROVAL;
  } else {
    const hard = elapsed >= thresholds.hard_after_ms || (tokens !== null && tokens >= thresholds.hard_after_thinking_tokens);
    const soft = elapsed >= thresholds.soft_after_ms || (tokens !== null && tokens >= thresholds.soft_after_thinking_tokens);
    diagnostic_state = hard
      ? WATCHDOG_DIAGNOSTIC_STATES.REASONING_HARD_BUDGET_EXCEEDED
      : soft
        ? WATCHDOG_DIAGNOSTIC_STATES.REASONING_SOFT_BUDGET_EXCEEDED
        : WATCHDOG_DIAGNOSTIC_STATES.REASONING_WITHIN_BUDGET;
    reason = diagnostic_state;
  }

  return Object.freeze({
    diagnostic_state,
    reason,
    semantic_state: progress.semantic_state,
    observed_elapsed_ms: elapsed,
    observed_thinking_tokens: tokens,
    thresholds,
  });
}
