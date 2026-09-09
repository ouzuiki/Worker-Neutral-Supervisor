import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileCheckpointStore } from "./checkpoint-store.mjs";
import { processDurableTask } from "./host-daemon.mjs";
import { createHostState, digestHostPayload, transitionHostState } from "./host-state.mjs";
import { SHD4_TEST_PROFILE } from "./shd4-prekill-barrier.mjs";
import { classifySessionTermination } from "../../supervisor-policy/session-termination.mjs";
import { planSameWorkerRespawn } from "../../supervisor-policy/same-worker-respawn.mjs";

function checkpoint() { return { checkpoint_version: 1, revision: 7, task: { id: "shd4-disposable-task", project: "fixture", goal: "benign read-only test", phase: "test", status: "open" }, gates: { completed: ["setup"], open: ["SHD-4"] }, workspace: { path: "/disposable/read-only", git_sha: "abc", branch: "test" }, constraints: { items: [], approval: { status: "not_required", request_refs: [] } }, evidence_refs: [], receipt_refs: [], handoff_refs: [], semantic_progress: { semantic_state: "productive", last_productive_at: null, last_productive_cursor: 1, thinking_tokens_since_productive: 0 }, last_execution: { worker_id: "codex", native_session_id: "old-session", native_status: "interrupted" }, continuation: { next_action: { kind: "run_gate", gate_id: "SHD-4", input_ref: null }, resume_cursor: "SHD-4", retry_count: 0, safe_to_resume: true } }; }
function facts(cp) { return { workspace: cp.workspace, human_block: "none", effect: { kind: "read_only", status: "known_not_applied", prior_claim_keys: [] } }; }
function profile(attempt = "attempt-1", token = "secret-1") { return { profile: SHD4_TEST_PROFILE, disposable: true, mutation_effect: "none", attempt_id: attempt, token, turn_id: "turn-1" }; }
async function setup(root, barrier = undefined) {
  const path = join(root, "task.json"); const cp = checkpoint(); const store = new FileCheckpointStore(path);
  await store.acquire(); await store.save(createHostState(cp)); await store.release();
  await writeFile(`${path}.descriptor`, JSON.stringify({ descriptor_version: 1, operation: "same_worker_recovery", expected_checkpoint_revision: cp.revision, expected_native_session_id: "old-session", termination_evidence: { signals: ["interrupted"] }, runtime_facts: facts(cp), policy: { max_retry_count: 1 }, ...(barrier ? { shd4_test_barrier: barrier } : {}) }));
  return { path, cp };
}
async function load(path) { const store = new FileCheckpointStore(path); await store.acquire(); try { return await store.load(); } finally { await store.release(); } }
async function readDurable(path) { const envelope = JSON.parse(await readFile(path, "utf8")); assert.equal(envelope.digest, digestHostPayload(envelope.payload)); return envelope.payload; }
async function waitFor(path) { for (let index = 0; index < 100; index += 1) { try { return JSON.parse(await readFile(path, "utf8")); } catch (error) { if (error?.code !== "ENOENT") throw error; await new Promise(resolve => setTimeout(resolve, 5)); } } throw new Error("arm record was not written"); }
async function persistStarted(path, cp) { const plan = planSameWorkerRespawn({ checkpoint: cp, termination_result: classifySessionTermination({ checkpoint: cp, termination_evidence: { signals: ["interrupted"] } }), policy: { max_retry_count: 1 } }); let state = transitionHostState(createHostState(cp), { type: "action_planned", action: plan }); state = transitionHostState(state, { type: "action_started", claim_key: plan.claim_key }); const store = new FileCheckpointStore(path); await store.acquire(); await store.save(state); await store.release(); return plan; }

test("SHD-4 barrier is absent by default and acknowledgement behavior is unchanged", async () => {
  const root = await mkdtemp(join(tmpdir(), "shd4-default-")); const { path } = await setup(root); let calls = 0;
  const status = await processDurableTask(path, { transport: { async spawn() { calls += 1; return { acknowledgement: "accepted", worker_id: "codex", native_session_id: "new-session", response_ref: "test://new" }; } } });
  const state = await load(path); assert.equal(status.phase, "observing"); assert.equal(calls, 1); assert.equal(state.receipts.filter(item => item.event === "action_acknowledged").length, 1);
});

test("SHD-4 barrier arms only after independently verified durable spawn and releases exactly once", async () => {
  const root = await mkdtemp(join(tmpdir(), "shd4-armed-")); const barrierRoot = join(root, "barriers"); const { path, cp } = await setup(root, profile()); let calls = 0;
  const running = processDurableTask(path, { shd4_test_barrier: { enabled: true, root: barrierRoot, process_identity: 4242, poll_ms: 2 }, transport: { async spawn() { calls += 1; return { acknowledgement: "accepted", worker_id: "codex", native_session_id: "new-session", response_ref: "test://new" }; } } });
  let arm; let armed;
  try { arm = await waitFor(join(barrierRoot, "attempt-1.armed.json")); armed = await readDurable(path); }
  finally { await mkdir(barrierRoot, { recursive: true }); await writeFile(join(barrierRoot, "attempt-1.control.json"), JSON.stringify({ attempt_id: "attempt-1", token: "secret-1", action: "release" })); }
  await running; const done = await load(path);
  assert.equal(calls, 1); assert.equal(armed.phase, "awaiting_ack"); assert.equal(armed.receipts.filter(item => item.event === "spawn_observed").length, 1); assert.equal(armed.receipts.filter(item => item.event === "action_acknowledged").length, 0);
  assert.equal(Object.hasOwn(arm, "token"), false);
  assert.deepEqual({ attempt_id: arm.attempt_id, task_id: arm.task_id, claim_key: arm.claim_key, worker_id: arm.worker_id, native_session_id: arm.native_session_id, checkpoint_revision: arm.checkpoint_revision, checkpoint_sequence: arm.checkpoint_sequence, checkpoint_digest: arm.checkpoint_digest, process_identity: arm.process_identity }, { attempt_id: "attempt-1", task_id: cp.task.id, claim_key: armed.active_action.claim_key, worker_id: "codex", native_session_id: "new-session", checkpoint_revision: cp.revision, checkpoint_sequence: armed.sequence, checkpoint_digest: digestHostPayload(armed), process_identity: 4242 });
  assert.equal(calls, 1); assert.equal(done.receipts.filter(item => item.event === "action_acknowledged").length, 1); assert.equal(done.task_checkpoint.last_execution.native_session_id, "new-session");
});

test("SHD-4 wrong profile and wrong release identity fail closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "shd4-closed-")); const invalid = profile(); invalid.disposable = false; const { path } = await setup(root, invalid); let calls = 0;
  await assert.rejects(() => processDurableTask(path, { shd4_test_barrier: { enabled: true, root: join(root, "barriers") }, transport: { async spawn() { calls += 1; } } }), /profile is not eligible/); assert.equal(calls, 0);
  const root2 = await mkdtemp(join(tmpdir(), "shd4-token-")); const barrierRoot = join(root2, "barriers"); const second = await setup(root2, profile("attempt-2", "right"));
  const running = processDurableTask(second.path, { shd4_test_barrier: { enabled: true, root: barrierRoot, poll_ms: 2 }, transport: { async spawn() { return { acknowledgement: "accepted", worker_id: "codex", native_session_id: "new-session", response_ref: null }; } } });
  await waitFor(join(barrierRoot, "attempt-2.armed.json")); await writeFile(join(barrierRoot, "attempt-2.control.json"), JSON.stringify({ attempt_id: "attempt-wrong", token: "wrong", action: "release" }));
  await assert.rejects(running, /control identity mismatch/); const state = await load(second.path); assert.equal(state.phase, "awaiting_ack"); assert.equal(state.receipts.some(item => item.event === "action_acknowledged"), false);
});

test("SHD-4 abort safely acknowledges once without replay", async () => {
  const root = await mkdtemp(join(tmpdir(), "shd4-abort-")); const barrierRoot = join(root, "barriers"); const { path } = await setup(root, profile("attempt-abort", "abort-token")); let calls = 0;
  const running = processDurableTask(path, { shd4_test_barrier: { enabled: true, root: barrierRoot, poll_ms: 2 }, transport: { async spawn() { calls += 1; return { acknowledgement: "accepted", worker_id: "codex", native_session_id: "abort-session", response_ref: null }; } } });
  try { await waitFor(join(barrierRoot, "attempt-abort.armed.json")); }
  finally { await mkdir(barrierRoot, { recursive: true }); await writeFile(join(barrierRoot, "attempt-abort.control.json"), JSON.stringify({ attempt_id: "attempt-abort", token: "abort-token", action: "abort" })); } await running;
  const done = await load(path); assert.equal(calls, 1); assert.equal(done.receipts.filter(item => item.event === "spawn_observed").length, 1); assert.equal(done.receipts.filter(item => item.event === "action_acknowledged").length, 1); assert.equal(done.task_checkpoint.last_execution.native_session_id, "abort-session");
});

test("SHD-4 reused attempt, pre-existing control, and malformed control fail closed", async () => {
  const reservedRoot = await mkdtemp(join(tmpdir(), "shd4-reserved-")); const reservedBarriers = join(reservedRoot, "barriers"); const reserved = await setup(reservedRoot, profile("reserved", "unique")); let reservedCalls = 0; await mkdir(reservedBarriers); await writeFile(join(reservedBarriers, "reserved.reserved.json"), "{}\n");
  await assert.rejects(() => processDurableTask(reserved.path, { shd4_test_barrier: { enabled: true, root: reservedBarriers }, transport: { async spawn() { reservedCalls += 1; } } }), /attempt already exists/); assert.equal(reservedCalls, 0);

  const root = await mkdtemp(join(tmpdir(), "shd4-reuse-")); const barrierRoot = join(root, "barriers"); const first = await setup(root, profile("reused", "unique")); let reusedCalls = 0;
  await writeFile(join(root, "placeholder"), "x"); await mkdir(barrierRoot);
  await writeFile(join(barrierRoot, "reused.armed.json"), "{}\n");
  await assert.rejects(() => processDurableTask(first.path, { shd4_test_barrier: { enabled: true, root: barrierRoot }, transport: { async spawn() { reusedCalls += 1; return { acknowledgement: "accepted", worker_id: "codex", native_session_id: "reuse-session", response_ref: null }; } } }), /arm already exists/);
  assert.equal(reusedCalls, 0); assert.equal((await load(first.path)).receipts.some(item => item.event === "action_acknowledged"), false);

  const root2 = await mkdtemp(join(tmpdir(), "shd4-precontrol-")); const controls = join(root2, "barriers"); const second = await setup(root2, profile("precontrol", "fresh")); let controlCalls = 0; await mkdir(controls); await writeFile(join(controls, "precontrol.control.json"), JSON.stringify({ attempt_id: "precontrol", token: "fresh", action: "release" }));
  await assert.rejects(() => processDurableTask(second.path, { shd4_test_barrier: { enabled: true, root: controls }, transport: { async spawn() { controlCalls += 1; return { acknowledgement: "accepted", worker_id: "codex", native_session_id: "precontrol-session", response_ref: null }; } } }), /control already exists/); assert.equal(controlCalls, 0);

  const root3 = await mkdtemp(join(tmpdir(), "shd4-malformed-")); const malformedRoot = join(root3, "barriers"); const third = await setup(root3, profile("malformed", "token")); const running = processDurableTask(third.path, { shd4_test_barrier: { enabled: true, root: malformedRoot, poll_ms: 2 }, transport: { async spawn() { return { acknowledgement: "accepted", worker_id: "codex", native_session_id: "malformed-session", response_ref: null }; } } }); await waitFor(join(malformedRoot, "malformed.armed.json")); await writeFile(join(malformedRoot, "malformed.control.json"), "not-json\n"); await assert.rejects(running, /control is malformed/);
});

test("SHD-4 preserves legacy descriptor fields and rejects traversal ids before spawn or filesystem effects", async () => {
  const root = await mkdtemp(join(tmpdir(), "shd4-compat-")); const normal = await setup(root); const descriptor = JSON.parse(await readFile(`${normal.path}.descriptor`, "utf8")); descriptor.legacy_extension = { tolerated: true }; await writeFile(`${normal.path}.descriptor`, JSON.stringify(descriptor)); let normalCalls = 0;
  await processDurableTask(normal.path, { transport: { async spawn() { normalCalls += 1; return { acknowledgement: "accepted", worker_id: "codex", native_session_id: "compat-session", response_ref: null }; } } }); assert.equal(normalCalls, 1);
  for (const attemptId of [".", "..", "../escape", "back\\slash", "/absolute"]) {
    const testRoot = await mkdtemp(join(tmpdir(), "shd4-path-")); const barrierRoot = join(testRoot, "barriers"); const candidate = await setup(testRoot, profile(attemptId, "token")); let calls = 0;
    await assert.rejects(() => processDurableTask(candidate.path, { shd4_test_barrier: { enabled: true, root: barrierRoot }, transport: { async spawn() { calls += 1; } } }), /safe bounded identifier/); assert.equal(calls, 0); await assert.rejects(() => readFile(barrierRoot), error => error?.code === "ENOENT" || error?.code === "EISDIR");
  }
});

test("SHD-4 restart reconciles durable accepted identity before transport", async () => {
  const root = await mkdtemp(join(tmpdir(), "shd4-restart-")); const { path, cp } = await setup(root, profile());
  const plan = planSameWorkerRespawn({ checkpoint: cp, termination_result: classifySessionTermination({ checkpoint: cp, termination_evidence: { signals: ["interrupted"] } }), policy: { max_retry_count: 1 } });
  let state = transitionHostState(createHostState(cp), { type: "action_planned", action: plan }); state = transitionHostState(state, { type: "action_started", claim_key: plan.claim_key }); state = transitionHostState(state, { type: "spawn_observed", claim_key: plan.claim_key, worker_id: "codex", native_session_id: "new-session", evidence_ref: "test://new" });
  const store = new FileCheckpointStore(path); await store.acquire(); await store.save(state); await store.release(); let calls = 0; let inspections = 0;
  await processDurableTask(path, { shd4_test_barrier: { enabled: true, root: join(root, "barriers") }, transport: { async spawn() { calls += 1; } }, inspect_spawn: async evidence => { inspections += 1; return { status: "accepted", worker_id: evidence.worker_id, native_session_id: evidence.native_session_id }; } });
  const done = await load(path); assert.equal(inspections, 1); assert.equal(calls, 0); assert.equal(done.claims[0], plan.claim_key); assert.equal(done.task_checkpoint.last_execution.native_session_id, "new-session"); assert.equal(done.receipts.filter(item => item.event === "action_acknowledged").length, 1);
});

for (const interruption of [
  { name: "after action_started before reservation", reservation: false },
  { name: "after reservation before transport result", reservation: true },
  { name: "after accepted transport result before spawn_observed persistence", reservation: true },
]) test(`SHD-4 restart fails closed ${interruption.name}`, async () => {
  const root = await mkdtemp(join(tmpdir(), "shd4-window-")); const barrierRoot = join(root, "barriers"); const { path, cp } = await setup(root, profile("window-attempt", "window-token")); const plan = await persistStarted(path, cp);
  if (interruption.reservation) { await mkdir(barrierRoot); await writeFile(join(barrierRoot, "window-attempt.reserved.json"), JSON.stringify({ barrier_version: 1, status: "reserved", attempt_id: "window-attempt", task_id: cp.task.id, claim_key: plan.claim_key, process_identity: 111 })); }
  let calls = 0; const options = { shd4_test_barrier: { enabled: true, root: barrierRoot }, transport: { async spawn() { calls += 1; } } };
  const first = await processDurableTask(path, options); const durable = await load(path); const sequence = durable.sequence;
  const second = await processDurableTask(path, options); const stable = await load(path);
  assert.equal(calls, 0); assert.equal(first.phase, "reconciling"); assert.equal(first.escalation.reason_code, "inflight_action_identity_unprovable"); assert.equal(durable.phase, "reconciling"); assert.equal(durable.receipts.some(item => item.event === "action_acknowledged"), false); assert.equal(second.phase, "reconciling"); assert.equal(stable.sequence, sequence);
});

test("SHD-4 stale descriptor is a no-op and ambiguous accepted identity fails closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "shd4-stale-")); const { path } = await setup(root, profile()); const descriptor = JSON.parse(await readFile(`${path}.descriptor`, "utf8")); descriptor.expected_checkpoint_revision = 6; await writeFile(`${path}.descriptor`, JSON.stringify(descriptor)); let calls = 0;
  const status = await processDurableTask(path, { shd4_test_barrier: { enabled: true, root: join(root, "barriers") }, transport: { async spawn() { calls += 1; } } }); assert.equal(status.phase, "observing"); assert.equal(calls, 0);
  const root2 = await mkdtemp(join(tmpdir(), "shd4-identity-")); const second = await setup(root2);
  await assert.rejects(() => processDurableTask(second.path, { transport: { async spawn() { return { acknowledgement: "accepted", worker_id: "unknown", native_session_id: "", response_ref: null }; } } }), /identity does not match/); const unchanged = await load(second.path); assert.equal(unchanged.receipts.some(item => item.event === "spawn_observed"), false);
});
