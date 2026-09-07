import assert from "node:assert/strict";
import test from "node:test";

import {
  WEB_RESEARCH_ACTIONS,
  WEB_RESEARCH_ALLOWED_OPERATIONS,
  WEB_RESEARCH_EVIDENCE_REQUIREMENTS,
  WEB_RESEARCH_REASONS,
  WEB_RESEARCH_REASON_CODES,
  evaluateWebResearchPolicy,
} from "./web-research-policy.mjs";

test("no signals => no research", () => {
  const result = evaluateWebResearchPolicy({});
  assert.equal(result.action, WEB_RESEARCH_ACTIONS.NO_RESEARCH);
  assert.equal(result.reason, WEB_RESEARCH_REASONS.NOT_WARRANTED);
  assert.equal(result.warranted, false);
  assert.deepEqual(result.allowed_operations, []);
  assert.equal(result.evidence_requirements, null);
});

test("reasoning stall alone => no research (explicit reason)", () => {
  const result = evaluateWebResearchPolicy({ reasoning_stall: true });
  assert.equal(result.action, WEB_RESEARCH_ACTIONS.NO_RESEARCH);
  assert.equal(
    result.reason,
    WEB_RESEARCH_REASONS.REASONING_STALL_ALONE_INSUFFICIENT,
  );
  assert.deepEqual(result.triggers, []);
});

test("reasoning stall does not tip an otherwise sub-threshold case", () => {
  const result = evaluateWebResearchPolicy({
    reasoning_stall: true,
    external_info_likely_helpful: true,
    local_attempt_failures: 1,
    capability_available: true,
    privacy_safe_query: true,
  });
  assert.equal(result.action, WEB_RESEARCH_ACTIONS.NO_RESEARCH);
});

test("two local failures + external info likely helpful => research", () => {
  const result = evaluateWebResearchPolicy({
    local_attempt_failures: 2,
    external_info_likely_helpful: true,
    capability_available: true,
    privacy_safe_query: true,
  });
  assert.equal(result.action, WEB_RESEARCH_ACTIONS.RESEARCH);
  assert.equal(
    result.reason,
    WEB_RESEARCH_REASONS.STRONG_EXTERNAL_INFO_CONDITIONS,
  );
  assert.ok(
    result.triggers.includes("repeated_local_failures_with_external_info"),
  );
  assert.deepEqual(
    result.allowed_operations,
    WEB_RESEARCH_ALLOWED_OPERATIONS,
  );
  assert.deepEqual(result.allowed_operations, ["search", "read"]);
  assert.equal(
    result.evidence_requirements,
    WEB_RESEARCH_EVIDENCE_REQUIREMENTS,
  );
});

test("local failures without external-info judgement => no research", () => {
  const result = evaluateWebResearchPolicy({
    local_attempt_failures: 5,
    capability_available: true,
    privacy_safe_query: true,
  });
  assert.equal(result.action, WEB_RESEARCH_ACTIONS.NO_RESEARCH);
});

test("one local failure + external info => not yet strong enough", () => {
  const result = evaluateWebResearchPolicy({
    local_attempt_failures: 1,
    external_info_likely_helpful: true,
    capability_available: true,
    privacy_safe_query: true,
  });
  assert.equal(result.action, WEB_RESEARCH_ACTIONS.NO_RESEARCH);
});

test("version-sensitive question => research on its own", () => {
  const result = evaluateWebResearchPolicy({
    version_sensitive: true,
    capability_available: true,
    privacy_safe_query: true,
  });
  assert.equal(result.action, WEB_RESEARCH_ACTIONS.RESEARCH);
  assert.ok(result.triggers.includes("version_sensitive"));
});

test("unfamiliar error + external info => research", () => {
  const result = evaluateWebResearchPolicy({
    unfamiliar_error: true,
    external_info_likely_helpful: true,
    capability_available: true,
    privacy_safe_query: true,
  });
  assert.equal(result.action, WEB_RESEARCH_ACTIONS.RESEARCH);
});

test("upstream behaviour unclear + external info => research", () => {
  const result = evaluateWebResearchPolicy({
    upstream_behavior_unclear: true,
    external_info_likely_helpful: true,
    capability_available: true,
    privacy_safe_query: true,
  });
  assert.equal(result.action, WEB_RESEARCH_ACTIONS.RESEARCH);
});

test("explicit user request => research when safe and available", () => {
  const result = evaluateWebResearchPolicy({
    user_requested: true,
    capability_available: true,
    privacy_safe_query: true,
  });
  assert.equal(result.action, WEB_RESEARCH_ACTIONS.RESEARCH);
  assert.equal(result.reason, WEB_RESEARCH_REASONS.EXPLICIT_USER_REQUEST);
  assert.deepEqual(result.triggers, ["user_requested"]);
});

test("secrets / private code => blocked even on explicit user request", () => {
  const result = evaluateWebResearchPolicy({
    user_requested: true,
    capability_available: true,
    privacy_safe_query: false,
  });
  assert.equal(result.action, WEB_RESEARCH_ACTIONS.BLOCKED);
  assert.equal(result.reason, WEB_RESEARCH_REASONS.PRIVACY_UNSAFE_QUERY);
  assert.deepEqual(result.reason_codes, [
    WEB_RESEARCH_REASON_CODES.PRIVACY_UNSAFE_QUERY,
  ]);
  assert.deepEqual(result.allowed_operations, []);
});

test("privacy-unsafe is blocked ahead of a missing capability", () => {
  const result = evaluateWebResearchPolicy({
    version_sensitive: true,
    capability_available: false,
    privacy_safe_query: false,
  });
  assert.equal(result.action, WEB_RESEARCH_ACTIONS.BLOCKED);
});

test("capability unavailable => hold with reason code", () => {
  const result = evaluateWebResearchPolicy({
    user_requested: true,
    capability_available: false,
    privacy_safe_query: true,
  });
  assert.equal(result.action, WEB_RESEARCH_ACTIONS.HOLD);
  assert.equal(result.reason, WEB_RESEARCH_REASONS.CAPABILITY_UNAVAILABLE);
  assert.deepEqual(result.reason_codes, [
    WEB_RESEARCH_REASON_CODES.CAPABILITY_UNAVAILABLE,
  ]);
  assert.deepEqual(result.allowed_operations, []);
});

test("output and its nested collections are frozen", () => {
  const result = evaluateWebResearchPolicy({
    user_requested: true,
    capability_available: true,
    privacy_safe_query: true,
  });
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.triggers));
  assert.ok(Object.isFrozen(result.reason_codes));
  assert.ok(Object.isFrozen(result.allowed_operations));
  assert.ok(Object.isFrozen(result.evidence_requirements));
});

test("allowed operations are read-only search + read only", () => {
  assert.deepEqual([...WEB_RESEARCH_ALLOWED_OPERATIONS].sort(), [
    "read",
    "search",
  ]);
});

test("evidence requirements pin the untrusted-content and transport rules", () => {
  assert.deepEqual(WEB_RESEARCH_EVIDENCE_REQUIREMENTS.transport, [
    "http",
    "https",
  ]);
  assert.deepEqual(
    WEB_RESEARCH_EVIDENCE_REQUIREMENTS.required_source_fields,
    ["url", "title", "retrieved_at", "source_type"],
  );
  assert.equal(
    WEB_RESEARCH_EVIDENCE_REQUIREMENTS.web_content_trust,
    "untrusted_external_evidence",
  );
  assert.equal(
    WEB_RESEARCH_EVIDENCE_REQUIREMENTS.never_treat_web_content_as_instructions,
    true,
  );
  assert.deepEqual(
    WEB_RESEARCH_EVIDENCE_REQUIREMENTS.source_preference_order,
    ["primary", "official", "upstream"],
  );
});

test("unknown input key is rejected", () => {
  assert.throws(
    () => evaluateWebResearchPolicy({ wat: true }),
    /unknown key/,
  );
});

test("non-integer failure count is rejected", () => {
  assert.throws(
    () => evaluateWebResearchPolicy({ local_attempt_failures: 1.5 }),
    /non-negative integer/,
  );
});

test("non-boolean flag is rejected", () => {
  assert.throws(
    () => evaluateWebResearchPolicy({ user_requested: "yes" }),
    /must be a boolean/,
  );
});
