import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileCheckpointStore } from "./checkpoint-store.mjs";
import { createHostState, transitionHostState } from "./host-state.mjs";
import { hostStatus, reconcileAcceptedSpawn, resumeHostAfterRestart, superviseUntilBoundary } from "./host-service.mjs";
import { classifySessionTermination } from "../../supervisor-policy/session-termination.mjs";
import { planSameWorkerRespawn } from "../../supervisor-policy/same-worker-respawn.mjs";

function checkpoint() { return { checkpoint_version: 1, revision: 1, task: { id: "restart-task", project: "p", goal: "g", phase: "run", status: "open" }, gates: { completed: ["safe"], open: ["next"] }, workspace: { path: "/work", git_sha: null, branch: null }, constraints: { items: [], approval: { status: "not_required", request_refs: [] } }, evidence_refs: [], receipt_refs: [], handoff_refs: [], semantic_progress: { semantic_state: "productive", last_productive_at: null, last_productive_cursor: 1, thinking_tokens_since_productive: 0 }, last_execution: { worker_id: "codex", native_session_id: "old", native_status: "interrupted" }, continuation: { next_action: { kind: "run_gate", gate_id: "next", input_ref: null }, resume_cursor: "next", retry_count: 0, safe_to_resume: true } }; }
function acceptedState() { const cp = checkpoint(); const plan = planSameWorkerRespawn({ checkpoint: cp, termination_result: classifySessionTermination({ checkpoint: cp, termination_evidence: { signals: ["interrupted"] } }), policy: { max_retry_count: 1 } }); let state = createHostState(cp); state = transitionHostState(state, { type: "action_planned", action: plan }); state = transitionHostState(state, { type: "action_started", claim_key: plan.claim_key }); return transitionHostState(state, { type: "spawn_observed", claim_key: plan.claim_key, worker_id: "codex", native_session_id: "new", evidence_ref: "codex://new" }); }

test("LSH-5 crash restart reconciles accepted spawn evidence without a second spawn", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lsh5-")); const store = new FileCheckpointStore(join(dir, "host.json")); await store.acquire(); await store.save(acceptedState()); const restarted = await store.load();
  let inspections = 0; const result = await reconcileAcceptedSpawn({ host_state: restarted, inspect_spawn: async evidence => { inspections += 1; return { status: "accepted", worker_id: evidence.worker_id, native_session_id: evidence.native_session_id }; }, persist_state: value => store.save(value) });
  assert.equal(result.outcome, "reconciled"); assert.equal(inspections, 1); assert.equal(result.state.task_checkpoint.last_execution.native_session_id, "new"); assert.equal(result.state.claims.length, 1); assert.equal((await store.load()).phase, "observing"); await store.release();
});

test("LSH-5 unresolved reconciliation and supervision exhaustion escalate explicitly", async () => {
  let state = transitionHostState(acceptedState(), { type: "reconciliation_required", reason_code: "restart", evidence_ref: null });
  const unresolved = await reconcileAcceptedSpawn({ host_state: state, inspect_spawn: async () => ({ status: "unknown" }) }); assert.equal(unresolved.state.phase, "human_required"); assert.equal(unresolved.state.escalation.reason_code, "spawn_reconciliation_unresolved");
  const exhausted = await superviseUntilBoundary({ host_state: createHostState(checkpoint()), max_cycles: 2, observe_once: async () => null }); assert.equal(exhausted.boundary, "human_required"); assert.equal(exhausted.state.escalation.reason_code, "supervision_cycle_budget_exhausted"); assert.equal(hostStatus(exhausted.state).healthy, false);
});

test("LSH-5 restart with spawn evidence reconciles before duplicate-spawn branch", async () => {
  let spawnCalls = 0;
  const result = await resumeHostAfterRestart({ host_state: acceptedState(), inspect_spawn: async evidence => ({ status: "accepted", worker_id: evidence.worker_id, native_session_id: evidence.native_session_id }), spawn_transport: { async spawn() { spawnCalls += 1; throw new Error("duplicate spawn canary"); } } });
  assert.equal(result.outcome, "reconciled"); assert.equal(spawnCalls, 0); assert.equal(result.state.claims.length, 1);
});
