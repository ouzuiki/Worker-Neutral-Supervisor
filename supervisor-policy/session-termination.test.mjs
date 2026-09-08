import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { classifySessionTermination } from "./session-termination.mjs";

function checkpoint(status = "open", approval = "not_required") {
  return { checkpoint_version: 1, revision: 1, task: { id: "task-1", project: "project", goal: "goal", phase: "execute", status }, gates: { completed: ["intake"], open: ["execute"] }, workspace: { path: "/work", git_sha: "abc", branch: "main" }, constraints: { items: [], approval: { status: approval, request_refs: approval === "not_required" ? [] : ["approval:1"] } }, evidence_refs: [{ id: "e1", kind: "observation", locator: "evidence://1", digest: null }], receipt_refs: [], handoff_refs: [], semantic_progress: { semantic_state: "productive", last_productive_at: null, last_productive_cursor: 1, thinking_tokens_since_productive: 0 }, last_execution: { worker_id: "worker-a", native_session_id: "session-a", native_status: "interrupted" }, continuation: { next_action: { kind: "run_gate", gate_id: "execute", input_ref: null }, resume_cursor: "gate:execute", retry_count: 0, safe_to_resume: true } };
}
function classify(signal, state = checkpoint()) { return classifySessionTermination({ checkpoint: state, termination_evidence: { signals: [signal] } }); }

test("every bounded termination class maps to its required disposition", () => {
  const expected = {
    normal_completion: ["continue_next_phase", false, false], interrupted: ["resumable", false, false],
    session_timeout: ["resumable", true, false], runtime_timeout: ["resumable", true, false], context_exhausted: ["resumable", true, false],
    transient_provider_error: ["retry_same_worker_candidate", true, false], model_stall: ["retry_same_worker_candidate", true, false],
    tool_runtime_failure: ["retry_or_reroute_candidate", true, true], safety_block: ["human_required", false, false],
    terminal_task_failure: ["terminal", false, false], unknown: ["review_required", false, false],
  };
  for (const [signal, [classification, sameWorker, reroute]] of Object.entries(expected)) {
    const outcome = classify(signal);
    assert.equal(outcome.classification, classification, signal);
    assert.equal(outcome.same_worker_retry_eligible, sameWorker, signal);
    assert.equal(outcome.cross_worker_reroute_eligible, reroute, signal);
  }
});

test("terminal task state overrides worker-session noise", () => {
  assert.equal(classify("transient_provider_error", checkpoint("completed")).reason_code, "task_already_completed");
  assert.equal(classify("safety_block", checkpoint("cancelled")).reason_code, "task_already_cancelled");
});
test("normal completion of an open task continues instead of retrying", () => { const outcome = classify("normal_completion"); assert.equal(outcome.disposition, "continue_next_phase"); assert.equal(outcome.same_worker_retry_eligible, false); });
test("interrupted open task is resumable from its durable checkpoint", () => { const outcome = classify("interrupted"); assert.equal(outcome.disposition, "resume_from_checkpoint"); assert.equal(outcome.automatic_resume_eligible, true); });
test("pending or rejected approval requires a human and refuses automatic resume", () => { for (const approval of ["pending", "rejected"]) { const outcome = classify("session_timeout", checkpoint("open", approval)); assert.equal(outcome.classification, "human_required"); assert.equal(outcome.automatic_resume_eligible, false); assert.equal(outcome.same_worker_retry_eligible, false); } });
test("approval and safety override retry signals", () => { assert.equal(classifySessionTermination({ checkpoint: checkpoint("open", "pending"), termination_evidence: { signals: ["model_stall", "tool_runtime_failure"] } }).reason_code, "approval_pending"); assert.equal(classifySessionTermination({ checkpoint: checkpoint(), termination_evidence: { signals: ["safety_block", "session_timeout"] } }).reason_code, "safety_block"); });
test("conflicting or absent evidence fails conservative", () => { for (const signals of [[], ["interrupted", "normal_completion"]]) { const outcome = classifySessionTermination({ checkpoint: checkpoint(), termination_evidence: { signals } }); assert.equal(outcome.classification, "review_required"); assert.equal(outcome.automatic_resume_eligible, false); } });
test("classification is deterministic, idempotent, and does not mutate checkpoint", () => { const state = checkpoint(); const before = structuredClone(state); const input = { checkpoint: state, termination_evidence: { signals: ["context_exhausted"] } }; const first = classifySessionTermination(input); assert.deepEqual(classifySessionTermination(input), first); assert.deepEqual(classifySessionTermination({ checkpoint: state, termination_evidence: { signals: ["context_exhausted"] } }), first); assert.deepEqual(state, before); });
test("unbounded evidence and external orchestrator dependencies are rejected or absent", () => { assert.throws(() => classifySessionTermination({ checkpoint: checkpoint(), termination_evidence: { signals: ["provider-specific-code"] } }), /invalid value/); assert.throws(() => classifySessionTermination({ checkpoint: checkpoint(), termination_evidence: { signals: ["interrupted"], prose: "trust me" } }), /unknown key/); const source = readFileSync(new URL("./session-termination.mjs", import.meta.url), "utf8"); assert.equal(source.includes(["Agent", "Navi"].join("")), false); });
