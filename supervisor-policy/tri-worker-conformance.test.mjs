import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertLiveLifecycle,
  assertPendingProjection,
  normalizeStartAcceptance,
  normalizeObservation,
} from "./tri-worker-conformance.mjs";
import { selectWorker } from "./policy.mjs";

const progress = (semantic_state = "productive") => ({
  semantic_state,
  last_productive_at: null,
  last_productive_cursor: null,
  thinking_tokens_since_productive: 0,
});

test("live fixture owns one context token and Claude uses only the thin native compatibility shim", () => {
  const fixture = fileURLToPath(new URL("../test/fixtures/tri-worker-context/", import.meta.url));
  const agents = readFileSync(`${fixture}AGENTS.md`, "utf8");
  const claude = readFileSync(`${fixture}CLAUDE.md`, "utf8");
  assert.match(agents, /^TRI_BRIDGE_CONTEXT_TOKEN=TRI_BRIDGE_CONTEXT_OK_7F29$/m);
  assert.equal(claude, "@AGENTS.md\n");
});

test("existing worker selection policy owns UNKNOWN acknowledgement reconciliation", () => {
  assert.deepEqual(selectWorker({
    state: { active_worker: "codex", active_terminal: false, mutation_ack: "unknown" },
  }), {
    action: "reconcile",
    worker: "codex",
    fallback_chain: [],
    reason: "mutation_ack_unknown",
  });
});

test("pending requests remain authoritative worker-native projections and force common blocked progress", () => {
  assert.equal(assertPendingProjection({ pending_requests: [], semantic_progress: progress() }, "codex"), true);
  assert.equal(assertPendingProjection({
    pending_requests: [{ request_id: 7, blocking: true, method: "native/approval" }],
    semantic_progress: progress("blocked"),
  }, "pi"), true);
  assert.throws(() => assertPendingProjection({
    pending_requests: [{ request_id: "native-7", blocking: true }],
    semantic_progress: progress(),
  }, "claude"), /pending HITL must project blocked/);
  assert.throws(() => assertPendingProjection({
    pending_requests: [{ request_id: {}, blocking: true }],
    semantic_progress: progress("blocked"),
  }, "codex"), /opaque string or integer identity/);
});

test("worker-native pending fields normalize without changing native bridge shapes", () => {
  const semantic = progress();
  assert.deepEqual(normalizeObservation("codex", { pending_requests: [], semantic_progress: semantic }), {
    pending_requests: [], semantic_progress: semantic,
  });
  assert.deepEqual(normalizeObservation("claude", { pending_requests: [], semantic_progress: semantic }), {
    pending_requests: [], semantic_progress: semantic,
  });
  assert.deepEqual(normalizeObservation("pi", { pendingRequests: [], semantic_progress: semantic }), {
    pending_requests: [], semantic_progress: semantic,
  });
});

test("live lifecycle assertion checks only the common contract, not native event shapes", () => {
  assert.equal(normalizeStartAcceptance("codex", {
    accepted: true, thread_id: "thread-1", turn_id: "turn-1",
  }), true);
  assert.equal(normalizeStartAcceptance("claude", {
    accepted: true, acknowledgement: "accepted", run_id: "run-1",
  }), true);
  assert.equal(normalizeStartAcceptance("pi", {
    acknowledgement: "accepted", status: "running", terminal: false,
  }), true);
  for (const worker of ["codex", "claude", "pi"]) {
    assert.equal(normalizeStartAcceptance(worker, { acknowledgement: "rejected", accepted: false }), false);
    assert.equal(normalizeStartAcceptance(worker, { acknowledgement: "unknown" }), false);
  }
  assert.deepEqual(assertLiveLifecycle({
    worker: "claude",
    startAccepted: true,
    observation: { pending_requests: [], semantic_progress: progress(), native_events: [{ arbitrary: true }] },
    result: { terminal: true, ok: true, token: "TOKEN" },
    expectedToken: "TOKEN",
  }), { worker: "claude", accepted: true, progress: true, terminal: true, token: true });
  assert.deepEqual(assertLiveLifecycle({
    worker: "pi",
    startAccepted: true,
    observation: { pending_requests: [], semantic_progress: progress(), native_events: [] },
    result: { terminal: true, ok: true, token: "TOKEN" },
    expectedToken: "TOKEN",
  }), { worker: "pi", accepted: true, progress: true, terminal: true, token: true });
});
