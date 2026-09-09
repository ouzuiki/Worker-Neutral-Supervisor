import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { HostServiceLock, processDurableTask, readServiceHealth, runHostDaemon, scanHostCheckpoints } from "./host-daemon.mjs";
import { FileCheckpointStore } from "./checkpoint-store.mjs";
import { createHostState, transitionHostState } from "./host-state.mjs";
import { classifySessionTermination } from "../../supervisor-policy/session-termination.mjs";
import { planSameWorkerRespawn } from "../../supervisor-policy/same-worker-respawn.mjs";

function checkpoint() { return { checkpoint_version: 1, revision: 1, task: { id: "shd-task", project: "p", goal: "g", phase: "run", status: "open" }, gates: { completed: ["SHD-1"], open: ["SHD-2"] }, workspace: { path: "/work", git_sha: null, branch: null }, constraints: { items: [], approval: { status: "not_required", request_refs: [] } }, evidence_refs: [], receipt_refs: [], handoff_refs: [], semantic_progress: { semantic_state: "productive", last_productive_at: null, last_productive_cursor: 1, thinking_tokens_since_productive: 0 }, last_execution: { worker_id: "codex", native_session_id: "old", native_status: "interrupted" }, continuation: { next_action: { kind: "run_gate", gate_id: "SHD-2", input_ref: null }, resume_cursor: "SHD-2", retry_count: 0, safe_to_resume: true } }; }

test("SHD-2 daemon writes atomic bounded health and reports degraded checkpoints", async () => {
  const root = await mkdtemp(join(tmpdir(), "shd2-")); const tasks = join(root, "tasks");
  const first = await runHostDaemon({ state_dir: root, once: true, inspect: async () => ({ healthy: false, phase: "human_required", task_id: "t" }) });
  assert.equal(first.cycles, 1); let health = await readServiceHealth(first.health_path); assert.equal(health.healthy, true); assert.equal(health.checkpoint_count, 0);
  await writeFile(join(tasks, "t.json"), "{}\n"); await runHostDaemon({ state_dir: root, once: true, inspect: async () => ({ healthy: false, phase: "human_required", task_id: "t" }) });
  health = JSON.parse(await readFile(first.health_path, "utf8")); assert.equal(health.alive, true); assert.equal(health.healthy, false); assert.equal(health.degraded_count, 1);
});

test("SHD-2 scanner is deterministic and corrupt tasks fail closed without killing service", async () => {
  const root = await mkdtemp(join(tmpdir(), "shd2-scan-")); await runHostDaemon({ state_dir: root, once: true });
  await writeFile(join(root, "tasks", "b.json"), "bad\n"); await writeFile(join(root, "tasks", "a.json"), "bad\n");
  const found = await scanHostCheckpoints(join(root, "tasks"), async path => { if (path.endsWith("a.json")) throw new Error("corrupt checkpoint"); return { healthy: true }; });
  assert.deepEqual(found.map(item => item.path.split("/").at(-1)), ["a.json", "b.json"]); assert.match(found[0].error, /corrupt/); assert.equal(found[1].status.healthy, true);
});

test("SHD-2 service lock excludes a second daemon instance", async () => {
  const root = await mkdtemp(join(tmpdir(), "shd2-lock-")); const lock = new HostServiceLock(join(root, "service.lock")); await lock.acquire();
  await assert.rejects(() => runHostDaemon({ state_dir: root, once: true }), /not safely disprovable/); await lock.release();
});

test("SHD-2 service lock reclaims only an ESRCH-confirmed dead PID", async () => {
  const root = await mkdtemp(join(tmpdir(), "shd2-dead-lock-")); const path = join(root, "service.lock"); await writeFile(path, "2147483647\n", { mode: 0o600 });
  const lock = new HostServiceLock(path); await lock.acquire(); assert.equal(await readFile(path, "utf8"), `${process.pid}\n`); await lock.release();
});

test("SHD-2 concurrent stale-lock reclaim leaves exactly one live owner lock", async () => {
  const root = await mkdtemp(join(tmpdir(), "shd2-race-lock-")); const path = join(root, "service.lock"); await writeFile(path, "2147483647\n", { mode: 0o600 });
  const contenders = [new HostServiceLock(path), new HostServiceLock(path)]; const results = await Promise.allSettled(contenders.map(lock => lock.acquire()));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1); assert.equal(results.filter(result => result.status === "rejected").length, 1); assert.equal(await readFile(path, "utf8"), `${process.pid}\n`);
  await contenders[results.findIndex(result => result.status === "fulfilled")].release();
});

test("SHD-2 service lock refuses malformed owner records", async () => {
  const root = await mkdtemp(join(tmpdir(), "shd2-bad-lock-")); const path = join(root, "service.lock");
  for (const value of ["", "0\n", "12x\n", "12", "1\nextra\n"]) { await writeFile(path, value); const lock = new HostServiceLock(path); await assert.rejects(() => lock.acquire(), /malformed/); }
});

test("SHD-2 daemon processor reconciles a durable accepted spawn exactly once", async () => {
  const root = await mkdtemp(join(tmpdir(), "shd2-process-")); const path = join(root, "task.json"); const cp = checkpoint();
  const plan = planSameWorkerRespawn({ checkpoint: cp, termination_result: classifySessionTermination({ checkpoint: cp, termination_evidence: { signals: ["interrupted"] } }), policy: { max_retry_count: 1 } });
  let state = createHostState(cp); state = transitionHostState(state, { type: "action_planned", action: plan }); state = transitionHostState(state, { type: "action_started", claim_key: plan.claim_key }); state = transitionHostState(state, { type: "spawn_observed", claim_key: plan.claim_key, worker_id: "codex", native_session_id: "new", evidence_ref: "codex://new" });
  const store = new FileCheckpointStore(path); await store.acquire(); await store.save(state); await store.release();
  await writeFile(`${path}.descriptor`, JSON.stringify({ descriptor_version: 1, operation: "reconcile_accepted_spawn", expected_checkpoint_revision: 1, expected_native_session_id: "old" }));
  let inspections = 0; const status = await processDurableTask(path, { inspect_spawn: async evidence => { inspections += 1; return { status: "accepted", worker_id: evidence.worker_id, native_session_id: evidence.native_session_id }; } });
  const verify = new FileCheckpointStore(path); await verify.acquire(); const durable = await verify.load(); await verify.release();
  assert.equal(status.phase, "observing"); assert.equal(inspections, 1); assert.equal(durable.task_checkpoint.last_execution.native_session_id, "new"); assert.equal(durable.claims.length, 1); assert.equal(durable.receipts.at(-1).event, "action_acknowledged");
  await processDurableTask(path, { inspect_spawn: async () => { throw new Error("descriptor must be stale"); } }); assert.equal(inspections, 1);
});

test("SHD-2 one production-style daemon cycle reconciles persisted state and projects the result", async () => {
  const root = await mkdtemp(join(tmpdir(), "shd2-cycle-")); const tasks = join(root, "tasks"); await runHostDaemon({ state_dir: root, once: true }); const path = join(tasks, "cycle.json"); const cp = checkpoint();
  const plan = planSameWorkerRespawn({ checkpoint: cp, termination_result: classifySessionTermination({ checkpoint: cp, termination_evidence: { signals: ["interrupted"] } }), policy: { max_retry_count: 1 } });
  let state = createHostState(cp); state = transitionHostState(state, { type: "action_planned", action: plan }); state = transitionHostState(state, { type: "action_started", claim_key: plan.claim_key }); state = transitionHostState(state, { type: "spawn_observed", claim_key: plan.claim_key, worker_id: "codex", native_session_id: "cycle-new", evidence_ref: "codex://cycle-new" });
  const store = new FileCheckpointStore(path); await store.acquire(); await store.save(state); await store.release();
  await writeFile(`${path}.descriptor`, JSON.stringify({ descriptor_version: 1, operation: "reconcile_accepted_spawn", expected_checkpoint_revision: 1, expected_native_session_id: "old" }));
  await runHostDaemon({ state_dir: root, once: true, inspect: taskPath => processDurableTask(taskPath, { inspect_spawn: async evidence => ({ status: "accepted", worker_id: evidence.worker_id, native_session_id: evidence.native_session_id }) }) });
  const health = await readServiceHealth(join(root, "health.json")); const verify = new FileCheckpointStore(path); await verify.acquire(); const durable = await verify.load(); await verify.release();
  assert.equal(health.healthy, true); assert.equal(health.checkpoint_count, 1); assert.equal(health.checkpoints[0].status.phase, "observing"); assert.equal(durable.task_checkpoint.last_execution.native_session_id, "cycle-new"); assert.equal(durable.receipts.at(-1).event, "action_acknowledged");
});

test("SHD-2 ambiguous mutation is never transported and becomes degraded", async () => {
  const root = await mkdtemp(join(tmpdir(), "shd2-ambiguous-")); const path = join(root, "task.json"); const cp = checkpoint(); const store = new FileCheckpointStore(path); await store.acquire(); await store.save(createHostState(cp)); await store.release();
  await writeFile(`${path}.descriptor`, JSON.stringify({ descriptor_version: 1, operation: "same_worker_recovery", expected_checkpoint_revision: 1, expected_native_session_id: "old", termination_evidence: { signals: ["interrupted"] }, runtime_facts: { workspace: cp.workspace, human_block: "none", effect: { kind: "mutating", status: "unknown", prior_claim_keys: [] } }, policy: { max_retry_count: 1 } }));
  let spawnCalls = 0; const status = await processDurableTask(path, { transport: { async spawn() { spawnCalls += 1; } } });
  assert.equal(spawnCalls, 0); assert.equal(status.healthy, false); assert.equal(status.phase, "reconciling"); assert.equal(status.escalation.reason_code, "effect_state_unknown_reconcile");
});
