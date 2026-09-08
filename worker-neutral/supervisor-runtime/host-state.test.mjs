import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { ConcurrentHostError, CorruptCheckpointError, FileCheckpointStore } from "./checkpoint-store.mjs";
import { createHostState, transitionHostState } from "./host-state.mjs";

function checkpoint(status = "open") { return { checkpoint_version: 1, revision: 0, task: { id: "task-lsh", project: "project", goal: "goal", phase: "execute", status }, gates: { completed: ["audit"], open: status === "open" ? ["implement"] : [] }, workspace: { path: "/work", git_sha: "abc", branch: "main" }, constraints: { items: [], approval: { status: "not_required", request_refs: [] } }, evidence_refs: [], receipt_refs: [], handoff_refs: [], semantic_progress: { semantic_state: "productive", last_productive_at: null, last_productive_cursor: 1, thinking_tokens_since_productive: 0 }, last_execution: { worker_id: "codex", native_session_id: "session-a", native_status: "running" }, continuation: { next_action: { kind: "run_gate", gate_id: status === "open" ? "implement" : null, input_ref: null }, resume_cursor: "gate:implement", retry_count: 0, safe_to_resume: status === "open" } }; }

test("LSH-1 deterministic action/ack state machine preserves task identity and lineage", () => {
  const initial = createHostState(checkpoint()); const action = { claim_key: "claim:1", action: "test_double" };
  const planned = transitionHostState(initial, { type: "action_planned", action });
  const started = transitionHostState(planned, { type: "action_started", claim_key: "claim:1" });
  const nextCheckpoint = structuredClone(checkpoint()); nextCheckpoint.revision = 1; nextCheckpoint.last_execution.native_session_id = "session-b";
  const acked = transitionHostState(started, { type: "action_acknowledged", claim_key: "claim:1", task_checkpoint: nextCheckpoint, worker_id: "codex", native_session_id: "session-b", evidence_ref: "test://ack" });
  assert.equal(acked.task_checkpoint.task.id, initial.task_checkpoint.task.id); assert.equal(acked.task_checkpoint.last_execution.native_session_id, "session-b"); assert.deepEqual(acked.claims, ["claim:1"]); assert.equal(acked.receipts.length, 1);
  assert.throws(() => transitionHostState(acked, { type: "action_planned", action }), /duplicate/);
});

test("LSH-1 checkpoint persistence is atomic, digest checked, and crash-restorable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lsh1-")); const path = join(dir, "host.json"); const store = new FileCheckpointStore(path);
  await store.acquire(); await store.save(createHostState(checkpoint())); const restored = await store.load(); await store.release();
  assert.equal(restored.task_checkpoint.task.id, "task-lsh"); assert.equal(JSON.parse(await readFile(path, "utf8")).format, "supervisor-host-checkpoint-v1");
  const envelope = JSON.parse(await readFile(path, "utf8")); envelope.payload.sequence = 99; await writeFile(path, JSON.stringify(envelope));
  await assert.rejects(() => store.load(), CorruptCheckpointError);
});

test("LSH-1 one checkpoint permits only one live host claim", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lsh1-lock-")); const path = join(dir, "host.json"); const first = new FileCheckpointStore(path); const second = new FileCheckpointStore(path);
  await first.acquire(); await assert.rejects(() => second.acquire(), ConcurrentHostError); await first.release(); await second.acquire(); await second.release();
});

test("LSH-5 a demonstrably dead PID lock is reclaimed after host crash", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lsh5-stale-lock-")); const path = join(dir, "host.json"); await writeFile(`${path}.lock`, "99999999\n"); const store = new FileCheckpointStore(path); await store.acquire(); await store.release();
});
