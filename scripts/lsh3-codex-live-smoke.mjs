#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpStdioPort, LOCAL_BRIDGES } from "../worker-neutral/supervisor-runtime/mcp-stdio-port.mjs";
import { BridgeSpawnTransport } from "../worker-neutral/supervisor-runtime/bridge-transport.mjs";
import { FileCheckpointStore } from "../worker-neutral/supervisor-runtime/checkpoint-store.mjs";
import { createHostState } from "../worker-neutral/supervisor-runtime/host-state.mjs";
import { runSameWorkerRecovery } from "../worker-neutral/supervisor-runtime/recovery-host.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForTerminal(port, threadId) {
  let observation;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    observation = await port.callTool("codex_observe", { thread_id: threadId, cursor: 0, limit: 100, wait_ms: 1_000 });
    if (observation.terminal) return observation;
  }
  throw new Error("source interruption did not reach terminal state");
}

const workspace = await mkdtemp(join(tmpdir(), "lsh3-codex-live-"));
const checkpointPath = join(workspace, ".supervisor", "host.json");
const fixturePath = join(workspace, "READ_ONLY_FIXTURE.txt");
const port = new McpStdioPort(LOCAL_BRIDGES.codex.launcher, { request_timeout_ms: 30_000 });
const store = new FileCheckpointStore(checkpointPath);
try {
  await writeFile(fixturePath, "LSH3_READ_ONLY_FIXTURE\n"); const beforeHash = hash(await readFile(fixturePath));
  await port.initialize(); const tools = (await port.listTools()).map(({ name }) => name);
  for (const name of ["codex_turn", "codex_observe", "codex_interrupt"]) if (!tools.includes(name)) throw new Error(`missing ${name}`);
  const source = await port.callTool("codex_turn", { text: "This is a disposable read-only interruption fixture. Run `sleep 120`, then read READ_ONLY_FIXTURE.txt and return its value.", cwd: workspace, sandbox: "read-only", approval_policy: "never" });
  if (source.accepted !== true) throw new Error("source start rejected");
  await delay(1_000);
  const sourceBeforeInterrupt = await port.callTool("codex_observe", { thread_id: source.thread_id, cursor: 0, limit: 100, wait_ms: 0 });
  await port.callTool("codex_interrupt", { thread_id: source.thread_id, turn_id: source.turn_id });
  const sourceTerminal = await waitForTerminal(port, source.thread_id);

  const taskCheckpoint = { checkpoint_version: 1, revision: 2, task: { id: "lsh3-live-stable-task", project: "worker-neutral-supervisor", goal: "prove same-worker rollover", phase: "LSH-3", status: "open" }, gates: { completed: ["LSH-1", "LSH-2"], open: ["LSH-3"] }, workspace: { path: workspace, git_sha: null, branch: null }, constraints: { items: [{ id: "read-only", status: "active", source_ref: "smoke:lsh3" }], approval: { status: "not_required", request_refs: [] } }, evidence_refs: [{ id: "source-interrupt", kind: "live-observation", locator: `codex://${source.thread_id}`, digest: null }], receipt_refs: [], handoff_refs: [], semantic_progress: { semantic_state: "productive", last_productive_at: null, last_productive_cursor: 0, thinking_tokens_since_productive: 0 }, last_execution: { worker_id: "codex", native_session_id: source.thread_id, native_status: "interrupted" }, continuation: { next_action: { kind: "run_gate", gate_id: "LSH-3", input_ref: "smoke://read-only-fixture" }, resume_cursor: "gate:LSH-3", retry_count: 0, safe_to_resume: true } };
  const initial = createHostState(taskCheckpoint); await store.acquire(); await store.save(initial);
  const bridgeCalls = []; const transport = new BridgeSpawnTransport({ async callTool(name, args) { bridgeCalls.push({ name, has_old_thread_id: Object.hasOwn(args, "thread_id"), continuation_marker: typeof args.text === "string" && args.text.startsWith("SUPERVISOR_CONTINUATION_V1") && args.text.includes("lsh3-live-stable-task") && args.text.includes('"completed":["LSH-1","LSH-2"]') }); return port.callTool(name, args); } }, { codex: { sandbox: "read-only", approval_policy: "never" } });
  const recovery = await runSameWorkerRecovery({ host_state: initial, termination_evidence: { signals: ["interrupted"] }, runtime_facts: { workspace: taskCheckpoint.workspace, human_block: "none", effect: { kind: "read_only", status: "known_not_applied", prior_claim_keys: [] } }, policy: { max_retry_count: 1 }, transport, persist_state: state => store.save(state) });
  if (recovery.outcome !== "spawned") throw new Error(`recovery outcome ${recovery.outcome}`);
  const replacementId = recovery.state.task_checkpoint.last_execution.native_session_id;
  const replacementObservation = await port.callTool("codex_observe", { thread_id: replacementId, cursor: 0, limit: 100, wait_ms: 1_000 });
  const restored = await store.load(); const afterHash = hash(await readFile(fixturePath));
  const evidence = {
    gate: "LSH-3", result: "pass", transport_process_reused: true, workspace_disposable: true, mutation_effect: "none",
    tools_present: true, source: { thread_id: source.thread_id, turn_id: source.turn_id, observed_before_interrupt: sourceBeforeInterrupt.runtime_available === true, terminal_status: sourceTerminal.terminal?.status ?? null },
    replacement: { thread_id: replacementId, differs_from_source: replacementId !== source.thread_id, observable_same_port: replacementObservation.runtime_available === true },
    supervisor: { task_id_before: taskCheckpoint.task.id, task_id_after: restored.task_checkpoint.task.id, completed_gates: restored.task_checkpoint.gates.completed, checkpoint_phase: restored.phase, retry_count: restored.task_checkpoint.continuation.retry_count, claims: restored.claims.length, receipts: restored.receipts.map(({ event, status }) => ({ event, status })) },
    continuation: bridgeCalls[0], fixture_unchanged: beforeHash === afterHash,
  };
  if (!evidence.replacement.differs_from_source || !evidence.replacement.observable_same_port || !evidence.continuation.continuation_marker || evidence.continuation.has_old_thread_id || !evidence.fixture_unchanged || evidence.supervisor.task_id_before !== evidence.supervisor.task_id_after || evidence.supervisor.checkpoint_phase !== "observing" || evidence.supervisor.claims !== 1) throw new Error("LSH-3 live assertions failed");
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
} finally {
  await store.release().catch(() => {}); await port.close().catch(() => {}); await rm(workspace, { recursive: true, force: true });
}
