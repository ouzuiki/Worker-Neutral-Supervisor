import assert from "node:assert/strict";
import test from "node:test";
import { BridgeLifecycleObserver, normalizeBridgeObservation } from "./bridge-observer.mjs";

const progress = { semantic_state: "productive", last_productive_at: null, last_productive_cursor: 2, thinking_tokens_since_productive: 0 };

test("LSH-2 normalizes all bridge lifecycle shapes without adding bridge policy", async () => {
  const fixtures = {
    codex_observe: { runtime_status: "completed", thread_id: "codex-a", next_cursor: 3, stream_id: "s1", pending_requests: [], semantic_progress: progress, terminal: { status: "completed" } },
    claude_observe: { status: "running", session_id: "claude-native", next_cursor: 4, stream_id: "s2", pending_requests: [], semantic_progress: progress, terminal: null },
    claude_result: { ready: false },
    pi_observe: { status: "terminal", sessionPath: "pi-session.jsonl", nextCursor: 5, streamId: "s3", pendingRequests: [], semantic_progress: progress },
    pi_result: { ready: true, ok: false, terminal_reason: "runtime_timeout" },
  };
  const calls = []; const observer = new BridgeLifecycleObserver({ async callTool(name, args) { calls.push([name, args]); return fixtures[name]; } });
  const codex = await observer.observe({ worker_id: "codex", native_session_id: "codex-a" }); assert.equal(codex.termination_signal, "normal_completion"); assert.equal(codex.native_session_id, "codex-a");
  assert.equal((await observer.observe({ worker_id: "claude", native_session_id: "run-a" })).native_state, "active");
  assert.equal((await observer.observe({ worker_id: "pi", native_session_id: "ignored" })).termination_signal, "runtime_timeout");
  assert.deepEqual(calls.map(([name]) => name), ["codex_observe", "claude_observe", "claude_result", "pi_observe", "pi_result"]);
});

test("LSH-2 pending approval and unknown lifecycle fail closed", () => {
  const fact = normalizeBridgeObservation("claude", { status: "mystery", session_id: "s", pending_requests: [{ request_id: "p" }], semantic_progress: { ...progress, semantic_state: "blocked" }, terminal: null });
  assert.equal(fact.pending_approval, true); assert.equal(fact.native_state, "unknown"); assert.equal(fact.termination_signal, "unknown");
});

test("LSH-2 retained session without bridge-local runtime is an honest unknown fact", () => {
  const fact = normalizeBridgeObservation("codex", { runtime_available: false, runtime_status: "unavailable", pending_requests: [] }, null, "retained-thread");
  assert.equal(fact.runtime_available, false); assert.equal(fact.native_session_id, "retained-thread"); assert.equal(fact.native_state, "unknown"); assert.equal(fact.semantic_progress_available, false); assert.equal(fact.watchdog_eligible, false); assert.deepEqual(fact.semantic_progress, { semantic_state: "blocked", last_productive_at: null, last_productive_cursor: null, thinking_tokens_since_productive: 0 });
});

test("LSH-2 absent Codex semantic progress uses conservative watchdog-safe telemetry while malformed telemetry rejects", () => {
  const fact = normalizeBridgeObservation("codex", { runtime_available: true, runtime_status: "running", pending_requests: [], terminal: null }, null, "thread-a");
  assert.equal(fact.semantic_progress_available, false); assert.equal(fact.semantic_progress.semantic_state, "blocked");
  assert.throws(() => normalizeBridgeObservation("codex", { runtime_status: "running", pending_requests: [], semantic_progress: { semantic_state: "invented" } }, null, "thread-a"), /semantic_state/);
});
