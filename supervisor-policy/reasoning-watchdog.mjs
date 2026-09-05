// Worker-neutral Reasoning Watchdog policy.
//
// Pure, deterministic, reason-coded evaluator analogous to completion-gate.mjs.
// No I/O, no Date.now(): the caller observes elapsed time and thinking-token
// counts against a neutral semantic_progress shape (compatible with LClB) and
// this module decides whether the reasoning loop is spinning.

export const WATCHDOG_ACTIONS = Object.freeze({
  NONE: "none",
  SOFT_STEER: "soft_steer",
  INTERRUPT: "interrupt",
});

export const WATCHDOG_SEMANTIC_STATES = Object.freeze({
  PRODUCTIVE: "productive",
  BLOCKED: "blocked",
  REASONING_ONLY: "reasoning_only",
});

export const WATCHDOG_REASONS = Object.freeze({
  PRODUCTIVE_PROGRESS: "productive_progress",
  BLOCKED_PENDING_APPROVAL: "blocked_pending_approval",
  REASONING_WITHIN_BUDGET: "reasoning_within_budget",
  REASONING_SOFT_BUDGET_EXCEEDED: "reasoning_soft_budget_exceeded",
  REASONING_HARD_BUDGET_EXCEEDED_AWAITING_STEER: "reasoning_hard_budget_exceeded_awaiting_steer",
  REASONING_POST_STEER_WITHIN_HARD_BUDGET: "reasoning_post_steer_within_hard_budget",
  REASONING_HARD_BUDGET_EXCEEDED: "reasoning_hard_budget_exceeded",
});

export const DEFAULT_WATCHDOG_CONFIG = Object.freeze({
  soft_after_ms: 45_000,
  soft_after_thinking_tokens: 4_000,
  hard_after_ms: 90_000,
  hard_after_thinking_tokens: 7_000,
});

const VALID_STATES = new Set(Object.values(WATCHDOG_SEMANTIC_STATES));
const CONFIG_KEYS = Object.freeze([
  "soft_after_ms",
  "soft_after_thinking_tokens",
  "hard_after_ms",
  "hard_after_thinking_tokens",
]);

function requireObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function requireNonNegativeInteger(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer`);
  }
  return value;
}

function requireBoolean(value, label) {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean`);
  }
  return value;
}

function requireStringOrNull(value, label) {
  if (value !== null && typeof value !== "string") {
    throw new TypeError(`${label} must be a string or null`);
  }
  return value;
}

function requireNonNegativeIntegerOrNull(value, label) {
  if (value === null) {
    return value;
  }
  return requireNonNegativeInteger(value, label);
}

function normalizeConfig(config) {
  // Partial budget overrides merged over DEFAULT_WATCHDOG_CONFIG.
  const source = requireObject(config, "config");
  for (const key of Object.keys(source)) {
    if (!CONFIG_KEYS.includes(key)) {
      throw new TypeError(`config has an unknown key: ${key}`);
    }
  }
  const normalized = {};
  for (const key of CONFIG_KEYS) {
    normalized[key] = Object.hasOwn(source, key)
      ? requireNonNegativeInteger(source[key], `config.${key}`)
      : DEFAULT_WATCHDOG_CONFIG[key];
  }
  if (normalized.hard_after_ms < normalized.soft_after_ms) {
    throw new TypeError("config.hard_after_ms must be >= config.soft_after_ms");
  }
  if (normalized.hard_after_thinking_tokens < normalized.soft_after_thinking_tokens) {
    throw new TypeError(
      "config.hard_after_thinking_tokens must be >= config.soft_after_thinking_tokens",
    );
  }
  return Object.freeze(normalized);
}

function normalizeSemanticProgress(semanticProgress) {
  const source = requireObject(semanticProgress, "semantic_progress");
  const semanticState = source.semantic_state;
  if (!VALID_STATES.has(semanticState)) {
    throw new TypeError(
      "semantic_progress.semantic_state must be productive, blocked, or reasoning_only",
    );
  }
  const thinkingTokens = requireNonNegativeIntegerOrNull(
    source.thinking_tokens_since_productive,
    "semantic_progress.thinking_tokens_since_productive",
  );
  const lastProductiveAt = Object.hasOwn(source, "last_productive_at")
    ? requireStringOrNull(source.last_productive_at, "semantic_progress.last_productive_at")
    : null;
  const lastProductiveCursor = Object.hasOwn(source, "last_productive_cursor")
    ? requireNonNegativeIntegerOrNull(
        source.last_productive_cursor,
        "semantic_progress.last_productive_cursor",
      )
    : null;
  return {
    semantic_state: semanticState,
    last_productive_at: lastProductiveAt,
    last_productive_cursor: lastProductiveCursor,
    thinking_tokens_since_productive: thinkingTokens,
  };
}

/**
 * Evaluate whether a reasoning loop is spinning and needs a nudge.
 *
 * @param {object} input
 * @param {object} input.semantic_progress neutral semantic progress shape
 * @param {number} input.elapsed_since_productive_ms non-negative integer ms
 * @param {boolean} input.soft_steer_issued whether a soft steer was already sent
 * @param {object} [input.config] budget overrides; defaults to DEFAULT_WATCHDOG_CONFIG
 */
export function evaluateReasoningWatchdog({
  semantic_progress,
  elapsed_since_productive_ms,
  soft_steer_issued,
  config = DEFAULT_WATCHDOG_CONFIG,
} = {}) {
  const normalizedConfig = normalizeConfig(config);
  const progress = normalizeSemanticProgress(semantic_progress);
  const elapsedMs = requireNonNegativeInteger(
    elapsed_since_productive_ms,
    "elapsed_since_productive_ms",
  );
  const softSteerIssued = requireBoolean(soft_steer_issued, "soft_steer_issued");
  const thinkingTokens = progress.thinking_tokens_since_productive;

  const base = {
    semantic_state: progress.semantic_state,
    observed_elapsed_ms: elapsedMs,
    observed_thinking_tokens: thinkingTokens,
    soft_steer_issued: softSteerIssued,
  };

  if (progress.semantic_state === WATCHDOG_SEMANTIC_STATES.BLOCKED) {
    // Pending approval is never spinning.
    return Object.freeze({
      ...base,
      action: WATCHDOG_ACTIONS.NONE,
      reason: WATCHDOG_REASONS.BLOCKED_PENDING_APPROVAL,
      thresholds: {},
    });
  }

  if (progress.semantic_state === WATCHDOG_SEMANTIC_STATES.PRODUCTIVE) {
    return Object.freeze({
      ...base,
      action: WATCHDOG_ACTIONS.NONE,
      reason: WATCHDOG_REASONS.PRODUCTIVE_PROGRESS,
      thresholds: {},
    });
  }

  // reasoning_only
  const softMsExceeded = elapsedMs >= normalizedConfig.soft_after_ms;
  const softTokensExceeded =
    thinkingTokens !== null && thinkingTokens >= normalizedConfig.soft_after_thinking_tokens;
  const hardMsExceeded = elapsedMs >= normalizedConfig.hard_after_ms;
  const hardTokensExceeded =
    thinkingTokens !== null && thinkingTokens >= normalizedConfig.hard_after_thinking_tokens;
  const softExceeded = softMsExceeded || softTokensExceeded;
  const hardExceeded = hardMsExceeded || hardTokensExceeded;

  if (!softExceeded) {
    return Object.freeze({
      ...base,
      action: WATCHDOG_ACTIONS.NONE,
      reason: WATCHDOG_REASONS.REASONING_WITHIN_BUDGET,
      thresholds: {
        soft_after_ms: normalizedConfig.soft_after_ms,
        soft_after_thinking_tokens: normalizedConfig.soft_after_thinking_tokens,
      },
    });
  }

  if (!softSteerIssued) {
    // Hard thresholds must never skip the soft steer stage.
    return Object.freeze({
      ...base,
      action: WATCHDOG_ACTIONS.SOFT_STEER,
      reason: hardExceeded
        ? WATCHDOG_REASONS.REASONING_HARD_BUDGET_EXCEEDED_AWAITING_STEER
        : WATCHDOG_REASONS.REASONING_SOFT_BUDGET_EXCEEDED,
      thresholds: {
        soft_after_ms: normalizedConfig.soft_after_ms,
        soft_after_thinking_tokens: normalizedConfig.soft_after_thinking_tokens,
        soft_ms_exceeded: softMsExceeded,
        soft_thinking_tokens_exceeded: softTokensExceeded,
      },
    });
  }

  if (hardExceeded) {
    return Object.freeze({
      ...base,
      action: WATCHDOG_ACTIONS.INTERRUPT,
      reason: WATCHDOG_REASONS.REASONING_HARD_BUDGET_EXCEEDED,
      thresholds: {
        hard_after_ms: normalizedConfig.hard_after_ms,
        hard_after_thinking_tokens: normalizedConfig.hard_after_thinking_tokens,
        hard_ms_exceeded: hardMsExceeded,
        hard_thinking_tokens_exceeded: hardTokensExceeded,
      },
    });
  }

  return Object.freeze({
    ...base,
    action: WATCHDOG_ACTIONS.NONE,
    reason: WATCHDOG_REASONS.REASONING_POST_STEER_WITHIN_HARD_BUDGET,
    thresholds: {
      hard_after_ms: normalizedConfig.hard_after_ms,
      hard_after_thinking_tokens: normalizedConfig.hard_after_thinking_tokens,
    },
  });
}
