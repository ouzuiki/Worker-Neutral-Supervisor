// Worker-neutral Web Research policy (WR1).
//
// Pure, deterministic, reason-coded evaluator analogous to
// reasoning-watchdog.mjs and completion-gate.mjs. No I/O, no Date.now(), no
// network: the caller observes the situation and this module decides whether
// read-only web research (search + read) is warranted, and — if warranted —
// whether it is currently allowed, on hold, or blocked.
//
// This module never executes a tool, never calls a bridge, and adds no runtime
// capability of its own. Actual tool execution is owned by the native worker /
// bridge. Web content produced under this policy is untrusted external evidence
// and never overrides the security or task/project contract (see
// supervisor-policy/context-policy.mjs#CONTEXT_AUTHORITY and
// worker-neutral/web-research/contract.v0.json).

export const WEB_RESEARCH_ACTIONS = Object.freeze({
  NO_RESEARCH: "no_research",
  RESEARCH: "research",
  HOLD: "hold",
  BLOCKED: "blocked",
});

export const WEB_RESEARCH_REASONS = Object.freeze({
  NOT_WARRANTED: "not_warranted",
  REASONING_STALL_ALONE_INSUFFICIENT: "reasoning_stall_alone_insufficient",
  EXPLICIT_USER_REQUEST: "explicit_user_request",
  STRONG_EXTERNAL_INFO_CONDITIONS: "strong_external_info_conditions",
  PRIVACY_UNSAFE_QUERY: "privacy_unsafe_query",
  CAPABILITY_UNAVAILABLE: "capability_unavailable",
});

export const WEB_RESEARCH_REASON_CODES = Object.freeze({
  PRIVACY_UNSAFE_QUERY: "privacy_unsafe_query",
  CAPABILITY_UNAVAILABLE: "capability_unavailable",
});

// The only operations this policy will ever authorize. Read-only by construction.
export const WEB_RESEARCH_ALLOWED_OPERATIONS = Object.freeze(["search", "read"]);

// Evidence requirements a caller must satisfy for anything retrieved from the
// web to be usable as Supervisor evidence. Mirrors
// worker-neutral/web-research/contract.v0.json.
export const WEB_RESEARCH_EVIDENCE_REQUIREMENTS = Object.freeze({
  transport: Object.freeze(["http", "https"]),
  required_source_fields: Object.freeze([
    "url",
    "title",
    "retrieved_at",
    "source_type",
  ]),
  bounded_results: true,
  bounded_content: true,
  evidence_claim_linkage_required: true,
  source_preference_order: Object.freeze(["primary", "official", "upstream"]),
  web_content_trust: "untrusted_external_evidence",
  promotion_rule:
    "web_content may become verified_current_evidence only after local or current verification where applicable; " +
    "it never overrides security_hard_runtime or task_and_project_contract",
  never_treat_web_content_as_instructions: true,
});

const BOOLEAN_INPUTS = Object.freeze([
  "user_requested",
  "knowledge_uncertainty",
  "version_sensitive",
  "unfamiliar_error",
  "upstream_behavior_unclear",
  "reasoning_stall",
  "external_info_likely_helpful",
  "capability_available",
  "privacy_safe_query",
]);

// Repeated local failures is a strong external-info signal once this many
// independent local attempts have failed.
const REPEATED_LOCAL_FAILURE_THRESHOLD = 2;

function requireBoolean(value, label) {
  if (value === undefined) return false;
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean`);
  }
  return value;
}

function requireNonNegativeInteger(value, label) {
  if (value === undefined) return 0;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    throw new TypeError(`${label} must be a non-negative integer`);
  }
  return value;
}

function frozenResult(result) {
  return Object.freeze({
    ...result,
    triggers: Object.freeze([...result.triggers]),
    reason_codes: Object.freeze([...result.reason_codes]),
    allowed_operations: Object.freeze([...result.allowed_operations]),
  });
}

/**
 * Decide whether read-only web research is warranted and, if so, permitted.
 *
 * All boolean inputs default to false; local_attempt_failures defaults to 0.
 *
 * @param {object} input
 * @param {boolean} [input.user_requested] user explicitly asked for web research
 * @param {boolean} [input.knowledge_uncertainty] model knowledge is uncertain/likely stale
 * @param {boolean} [input.version_sensitive] answer depends on current/version-specific facts
 * @param {boolean} [input.unfamiliar_error] an error/signature the worker does not recognise
 * @param {number}  [input.local_attempt_failures] count of independent failed local attempts
 * @param {boolean} [input.upstream_behavior_unclear] upstream/library behaviour is unclear
 * @param {boolean} [input.reasoning_stall] the reasoning loop is stalling (NOT a trigger alone)
 * @param {boolean} [input.external_info_likely_helpful] external info is judged likely to help
 * @param {boolean} [input.capability_available] a web search/read capability is available now
 * @param {boolean} [input.privacy_safe_query] the query carries no secret/private/sensitive data
 */
export function evaluateWebResearchPolicy(input = {}) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("input must be an object");
  }
  for (const key of Object.keys(input)) {
    if (key !== "local_attempt_failures" && !BOOLEAN_INPUTS.includes(key)) {
      throw new TypeError(`input has an unknown key: ${key}`);
    }
  }

  const flags = {};
  for (const key of BOOLEAN_INPUTS) {
    flags[key] = requireBoolean(input[key], key);
  }
  const localAttemptFailures = requireNonNegativeInteger(
    input.local_attempt_failures,
    "local_attempt_failures",
  );

  const strongExternalInfoConditions = [];
  if (flags.version_sensitive) {
    strongExternalInfoConditions.push("version_sensitive");
  }
  if (
    flags.external_info_likely_helpful &&
    localAttemptFailures >= REPEATED_LOCAL_FAILURE_THRESHOLD
  ) {
    strongExternalInfoConditions.push("repeated_local_failures_with_external_info");
  }
  if (flags.external_info_likely_helpful && flags.unfamiliar_error) {
    strongExternalInfoConditions.push("unfamiliar_error_with_external_info");
  }
  if (flags.external_info_likely_helpful && flags.upstream_behavior_unclear) {
    strongExternalInfoConditions.push("upstream_behavior_unclear_with_external_info");
  }
  if (flags.external_info_likely_helpful && flags.knowledge_uncertainty) {
    strongExternalInfoConditions.push("knowledge_uncertainty_with_external_info");
  }

  const triggers = [];
  if (flags.user_requested) triggers.push("user_requested");
  triggers.push(...strongExternalInfoConditions);

  const warranted = triggers.length > 0;

  // Reasoning stall alone must never trigger research.
  if (!warranted) {
    return frozenResult({
      action: WEB_RESEARCH_ACTIONS.NO_RESEARCH,
      reason: flags.reasoning_stall
        ? WEB_RESEARCH_REASONS.REASONING_STALL_ALONE_INSUFFICIENT
        : WEB_RESEARCH_REASONS.NOT_WARRANTED,
      warranted: false,
      triggers,
      reason_codes: [],
      allowed_operations: [],
      evidence_requirements: null,
    });
  }

  // Warranted, but privacy-unsafe queries are blocked outright (never partially
  // sent to the web).
  if (!flags.privacy_safe_query) {
    return frozenResult({
      action: WEB_RESEARCH_ACTIONS.BLOCKED,
      reason: WEB_RESEARCH_REASONS.PRIVACY_UNSAFE_QUERY,
      warranted: true,
      triggers,
      reason_codes: [WEB_RESEARCH_REASON_CODES.PRIVACY_UNSAFE_QUERY],
      allowed_operations: [],
      evidence_requirements: null,
    });
  }

  // Warranted and privacy-safe, but no capability to execute it: hold.
  if (!flags.capability_available) {
    return frozenResult({
      action: WEB_RESEARCH_ACTIONS.HOLD,
      reason: WEB_RESEARCH_REASONS.CAPABILITY_UNAVAILABLE,
      warranted: true,
      triggers,
      reason_codes: [WEB_RESEARCH_REASON_CODES.CAPABILITY_UNAVAILABLE],
      allowed_operations: [],
      evidence_requirements: null,
    });
  }

  return frozenResult({
    action: WEB_RESEARCH_ACTIONS.RESEARCH,
    reason: flags.user_requested
      ? WEB_RESEARCH_REASONS.EXPLICIT_USER_REQUEST
      : WEB_RESEARCH_REASONS.STRONG_EXTERNAL_INFO_CONDITIONS,
    warranted: true,
    triggers,
    reason_codes: [],
    allowed_operations: WEB_RESEARCH_ALLOWED_OPERATIONS,
    evidence_requirements: WEB_RESEARCH_EVIDENCE_REQUIREMENTS,
  });
}
