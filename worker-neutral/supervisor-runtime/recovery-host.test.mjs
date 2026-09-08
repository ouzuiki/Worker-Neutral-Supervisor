import assert from "node:assert/strict";
import test from "node:test";
import { createHostState } from "./host-state.mjs";
import { runCrossWorkerRecovery, runSameWorkerRecovery } from "./recovery-host.mjs";
import { BridgeSpawnTransport } from "./bridge-transport.mjs";

function checkpoint() { return { checkpoint_version: 1, revision: 4, task: { id: "stable-task", project: "project", goal: "goal", phase: "execute", status: "open" }, gates: { completed: ["LSH-1", "LSH-2"], open: ["LSH-3"] }, workspace: { path: "/work", git_sha: "abc", branch: "main" }, constraints: { items: [], approval: { status: "not_required", request_refs: [] } }, evidence_refs: [{ id: "e1", kind: "test", locator: "test://lsh2", digest: null }], receipt_refs: [], handoff_refs: [], semantic_progress: { semantic_state: "productive", last_productive_at: null, last_productive_cursor: 2, thinking_tokens_since_productive: 0 }, last_execution: { worker_id: "codex", native_session_id: "session-a", native_status: "interrupted" }, continuation: { next_action: { kind: "run_gate", gate_id: "LSH-3", input_ref: null }, resume_cursor: "gate:LSH-3", retry_count: 0, safe_to_resume: true } }; }
const facts = { workspace: { path: "/work", git_sha: "abc", branch: "main" }, human_block: "none", effect: { kind: "read_only", status: "known_not_applied", prior_claim_keys: [] } };

test("LSH-3 Codex A rolls to fresh Codex B with stable task, minimum context, ack, and persisted transitions", async () => {
  const calls = []; const port = { async callTool(name, args) { calls.push({ name, args }); return { accepted: true, thread_id: "session-b", turn_id: "turn-b" }; } };
  const persisted = []; const result = await runSameWorkerRecovery({ host_state: createHostState(checkpoint()), termination_evidence: { signals: ["interrupted"] }, runtime_facts: facts, policy: { max_retry_count: 2 }, transport: new BridgeSpawnTransport(port, { codex: { sandbox: "read-only", approval_policy: "never" } }), persist_state: async state => persisted.push(state) });
  assert.equal(result.outcome, "spawned"); assert.equal(result.state.task_checkpoint.task.id, "stable-task"); assert.equal(result.state.task_checkpoint.last_execution.native_session_id, "session-b"); assert.notEqual(result.state.task_checkpoint.last_execution.native_session_id, "session-a"); assert.deepEqual(result.state.task_checkpoint.gates.completed, ["LSH-1", "LSH-2"]); assert.equal(result.state.receipts.length, 2); assert.equal(persisted.length, 4);
  assert.equal(calls[0].name, "codex_turn"); assert.equal(Object.hasOwn(calls[0].args, "thread_id"), false); assert.match(calls[0].args.text, /Do not replay gates/);
});

test("LSH-3 unknown spawn acknowledgement persists reconciliation and never acknowledges claim", async () => {
  const result = await runSameWorkerRecovery({ host_state: createHostState(checkpoint()), termination_evidence: { signals: ["interrupted"] }, runtime_facts: facts, policy: { max_retry_count: 1 }, transport: { async spawn() { return { acknowledgement: "unknown", worker_id: "codex", native_session_id: null, response_ref: null }; } } });
  assert.equal(result.outcome, "reconciliation_required"); assert.equal(result.state.phase, "reconciling"); assert.deepEqual(result.state.claims, []); assert.equal(result.state.active_action.action, "spawn_same_worker");
});

test("LSH-3 accepted same-session spawn preserves evidence and reconciles without acknowledgement", async () => {
  const result = await runSameWorkerRecovery({ host_state: createHostState(checkpoint()), termination_evidence: { signals: ["interrupted"] }, runtime_facts: facts, policy: { max_retry_count: 1 }, transport: { async spawn() { return { acknowledgement: "accepted", worker_id: "codex", native_session_id: "session-a", response_ref: "codex://session-a" }; } } });
  assert.equal(result.outcome, "reconciliation_required"); assert.equal(result.reason_code, "spawn_reused_source_session"); assert.equal(result.state.phase, "reconciling"); assert.deepEqual(result.state.claims, []); assert.equal(result.state.active_action.spawn_evidence.native_session_id, "session-a"); assert.equal(result.state.receipts.at(-1).status, "accepted_pending_checkpoint");
});

test("LSH-3 post-spawn persist failure records accepted session and durably reconciles on retry", async () => {
  let saves = 0; const durable = [];
  const result = await runSameWorkerRecovery({ host_state: createHostState(checkpoint()), termination_evidence: { signals: ["interrupted"] }, runtime_facts: facts, policy: { max_retry_count: 1 }, transport: { async spawn() { return { acknowledgement: "accepted", worker_id: "codex", native_session_id: "session-b", response_ref: "codex://session-b" }; } }, persist_state: async state => { saves += 1; if (saves === 4) throw new Error("disk fault after spawn"); durable.push(state); } });
  assert.equal(result.outcome, "reconciliation_required"); assert.equal(result.reason_code, "post_spawn_checkpoint_failure"); assert.equal(result.state.phase, "reconciling"); assert.equal(result.state.active_action.spawn_evidence.native_session_id, "session-b"); assert.equal(durable.at(-1).phase, "reconciling"); assert.deepEqual(result.state.claims, []);
});

test("LSH-3 approval and ambiguous effects block before transport", async () => {
  let calls = 0; const transport = { async spawn() { calls += 1; } };
  const ambiguous = await runSameWorkerRecovery({ host_state: createHostState(checkpoint()), termination_evidence: { signals: ["interrupted"] }, runtime_facts: { ...facts, effect: { kind: "mutating", status: "unknown", prior_claim_keys: [] } }, policy: { max_retry_count: 1 }, transport });
  assert.equal(ambiguous.outcome, "recovery_required"); assert.equal(calls, 0);
  const pending = checkpoint(); pending.constraints.approval = { status: "pending", request_refs: ["approval:1"] };
  const blocked = await runSameWorkerRecovery({ host_state: createHostState(pending), termination_evidence: { signals: ["interrupted"] }, runtime_facts: facts, policy: { max_retry_count: 1 }, transport });
  assert.equal(blocked.outcome, "not_planned"); assert.equal(calls, 0);
});

test("LSH-4 ASR-5 delegates selection, excludes source, and preserves minimum context across worker", async () => {
  const cp = checkpoint(); cp.last_execution.native_status = "failed"; const plans = [];
  const result = await runCrossWorkerRecovery({ host_state: createHostState(cp), termination_evidence: { signals: ["tool_runtime_failure"] }, runtime_facts: facts, policy: { max_reroute_count: 2 }, task: { task_class: "general_engineering" }, worker_state: { workers: { codex: { availability: "available" }, claude: { availability: "available" }, pi: { availability: "available" } }, failed_workers: [] }, routing_policy: {}, transport: { async spawn(plan) { plans.push(plan); return { acknowledgement: "accepted", worker_id: plan.target_worker_id, native_session_id: "cross-b", response_ref: "test://cross-b" }; } } });
  assert.equal(result.outcome, "spawned"); assert.notEqual(result.target_worker_id, "codex"); assert.equal(result.state.task_checkpoint.task.id, "stable-task"); assert.equal(result.state.task_checkpoint.last_execution.worker_id, result.target_worker_id); assert.deepEqual(result.state.task_checkpoint.evidence_refs, cp.evidence_refs); assert.equal(plans[0].action, "spawn_cross_worker"); assert.deepEqual(plans[0].gates.completed, ["LSH-1", "LSH-2"]);
});

test("LSH-4 acknowledged worker lineage prevents A-B-A ping-pong and remains budget bounded", async () => {
  const cp = checkpoint(); cp.last_execution = { worker_id: "codex", native_session_id: "a", native_status: "failed" }; cp.continuation.retry_count = 1;
  const host = { ...createHostState(cp), receipts: [{ sequence: 1, event: "action_acknowledged", claim_key: "prior", worker_id: "claude", native_session_id: "b", status: "accepted", evidence_ref: null }] };
  const result = await runCrossWorkerRecovery({ host_state: host, termination_evidence: { signals: ["tool_runtime_failure"] }, runtime_facts: facts, policy: { max_reroute_count: 2 }, task: { task_class: "general_engineering" }, worker_state: { workers: { codex: { availability: "available" }, claude: { availability: "available" }, pi: { availability: "unavailable" } }, failed_workers: [] }, routing_policy: {}, transport: { async spawn() { throw new Error("must not spawn"); } } });
  assert.equal(result.outcome, "not_planned"); assert.equal(result.reason_code, "no_supported_target_worker");
  const exhausted = await runCrossWorkerRecovery({ host_state: createHostState({ ...cp, continuation: { ...cp.continuation, retry_count: 2 } }), termination_evidence: { signals: ["tool_runtime_failure"] }, runtime_facts: facts, policy: { max_reroute_count: 2 }, task: {}, worker_state: {}, transport: { async spawn() {} } });
  assert.equal(exhausted.reason_code, "reroute_budget_exhausted");
});
