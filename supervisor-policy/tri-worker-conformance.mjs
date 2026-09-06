import assert from "node:assert/strict";

export const SEMANTIC_STATES = Object.freeze(["productive", "reasoning_only", "blocked"]);

export function assertSemanticProgress(value, worker) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${worker}: semantic_progress missing`);
  assert.ok(SEMANTIC_STATES.includes(value.semantic_state), `${worker}: invalid semantic_state`);
  assert.ok(value.last_productive_at === null || typeof value.last_productive_at === "string", `${worker}: invalid last_productive_at`);
  assert.ok(value.last_productive_cursor === null || Number.isSafeInteger(value.last_productive_cursor), `${worker}: invalid last_productive_cursor`);
  assert.ok(value.thinking_tokens_since_productive === null
    || (Number.isSafeInteger(value.thinking_tokens_since_productive) && value.thinking_tokens_since_productive >= 0),
  `${worker}: invalid thinking_tokens_since_productive`);
  return true;
}

export function assertPendingProjection(observation, worker) {
  assert.ok(Array.isArray(observation.pending_requests), `${worker}: pending_requests must be authoritative array state`);
  if (observation.pending_requests.length > 0) {
    assert.equal(observation.semantic_progress?.semantic_state, "blocked", `${worker}: pending HITL must project blocked progress`);
    for (const pending of observation.pending_requests) {
      assert.equal(pending.blocking, true, `${worker}: actionable pending request must be blocking`);
      assert.ok(
        (typeof pending.request_id === "string" && pending.request_id.length > 0)
          || (Number.isSafeInteger(pending.request_id)),
        `${worker}: pending request must preserve an opaque string or integer identity`,
      );
    }
  }
  return true;
}

export function normalizeObservation(worker, observation) {
  assert.ok(observation && typeof observation === "object" && !Array.isArray(observation), `${worker}: invalid observation`);
  const pending = worker === "pi" ? observation.pendingRequests : observation.pending_requests;
  return Object.freeze({
    semantic_progress: observation.semantic_progress,
    pending_requests: pending,
  });
}

export function normalizeStartAcceptance(worker, start) {
  assert.ok(start && typeof start === "object" && !Array.isArray(start), `${worker}: invalid start response`);
  if (start.acknowledgement === "unknown" || start.acknowledgement === "rejected" || start.accepted === false) return false;
  if (worker === "codex") {
    return start.accepted === true && typeof start.thread_id === "string" && typeof start.turn_id === "string";
  }
  if (worker === "claude") {
    return start.accepted === true && start.acknowledgement === "accepted" && typeof start.run_id === "string";
  }
  if (worker === "pi") {
    return start.acknowledgement === "accepted" && start.status === "running" && start.terminal === false;
  }
  throw new Error(`unsupported worker: ${worker}`);
}

export function assertLiveLifecycle({ worker, startAccepted, observation, result, expectedToken }) {
  assert.equal(startAccepted, true, `${worker}: start was not accepted`);
  assertSemanticProgress(observation.semantic_progress, worker);
  assertPendingProjection(observation, worker);
  assert.equal(result.terminal, true, `${worker}: terminal state not proven`);
  assert.equal(result.ok, true, `${worker}: terminal result was not successful`);
  if (result.token !== expectedToken) throw new Error(`${worker}: fixed token mismatch (actual output suppressed)`);
  return Object.freeze({ worker, accepted: true, progress: true, terminal: true, token: true });
}
