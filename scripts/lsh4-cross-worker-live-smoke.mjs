#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpStdioPort, LOCAL_BRIDGES } from "../worker-neutral/supervisor-runtime/mcp-stdio-port.mjs";
import { MultiBridgeSpawnTransport } from "../worker-neutral/supervisor-runtime/bridge-transport.mjs";
import { FileCheckpointStore } from "../worker-neutral/supervisor-runtime/checkpoint-store.mjs";
import { createHostState } from "../worker-neutral/supervisor-runtime/host-state.mjs";
import { runCrossWorkerRecovery } from "../worker-neutral/supervisor-runtime/recovery-host.mjs";

const digest = value => createHash("sha256").update(value).digest("hex");
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const required = { codex: ["codex_turn", "codex_observe", "codex_interrupt"], claude: ["claude_start", "claude_observe", "claude_result"], pi: ["pi_start", "pi_observe", "pi_result"] };
const workspace = await mkdtemp(join(tmpdir(), "lsh4-cross-live-")); const fixture = join(workspace, "READ_ONLY_FIXTURE.txt"); const ports = {}; const availability = {};
let store;
try {
  await writeFile(fixture, "LSH4_CROSS_WORKER_READ_ONLY\n"); const before = digest(await readFile(fixture));
  for (const worker of ["codex", "claude", "pi"]) {
    const port = new McpStdioPort(LOCAL_BRIDGES[worker].launcher);
    try { await port.initialize(); const names = (await port.listTools()).map(({ name }) => name); const missing = required[worker].filter(name => !names.includes(name)); availability[worker] = { initialized: true, available: missing.length === 0, required_tools: required[worker], missing_tools: missing }; if (missing.length === 0) ports[worker] = port; else await port.close(); }
    catch (error) { availability[worker] = { initialized: false, available: false, required_tools: required[worker], missing_tools: required[worker], reason: error.message }; await port.close().catch(() => {}); }
  }
  if (!ports.codex) throw new Error("Codex source bridge unavailable");
  const source = await ports.codex.callTool("codex_turn", { text: "Disposable read-only cross-worker source. Run `sleep 120`, then read READ_ONLY_FIXTURE.txt.", cwd: workspace, sandbox: "read-only", approval_policy: "never" });
  if (source.accepted !== true) throw new Error("Codex source start rejected"); await wait(1_000);
  const sourceObserved = await ports.codex.callTool("codex_observe", { thread_id: source.thread_id, cursor: 0, limit: 100, wait_ms: 0 });
  await ports.codex.callTool("codex_interrupt", { thread_id: source.thread_id, turn_id: source.turn_id });
  let sourceTerminal; for (let i = 0; i < 30; i += 1) { sourceTerminal = await ports.codex.callTool("codex_observe", { thread_id: source.thread_id, cursor: 0, limit: 100, wait_ms: 1_000 }); if (sourceTerminal.terminal) break; }
  if (!sourceTerminal?.terminal) throw new Error("source did not terminate");

  const checkpoint = { checkpoint_version: 1, revision: 3, task: { id: "lsh4-live-stable-task", project: "worker-neutral-supervisor", goal: "prove cross-worker recovery", phase: "LSH-4", status: "open" }, gates: { completed: ["LSH-1", "LSH-2", "LSH-3"], open: ["LSH-4"] }, workspace: { path: workspace, git_sha: null, branch: null }, constraints: { items: [{ id: "read-only", status: "active", source_ref: "smoke:lsh4" }], approval: { status: "not_required", request_refs: [] } }, evidence_refs: [{ id: "source", kind: "live-observation", locator: `codex://${source.thread_id}`, digest: null }], receipt_refs: [], handoff_refs: [], semantic_progress: { semantic_state: "productive", last_productive_at: null, last_productive_cursor: 0, thinking_tokens_since_productive: 0 }, last_execution: { worker_id: "codex", native_session_id: source.thread_id, native_status: "failed" }, continuation: { next_action: { kind: "run_gate", gate_id: "LSH-4", input_ref: "smoke://fixture" }, resume_cursor: "gate:LSH-4", retry_count: 0, safe_to_resume: true } };
  const initial = createHostState(checkpoint); store = new FileCheckpointStore(join(workspace, ".supervisor", "host.json")); await store.acquire(); await store.save(initial);
  const starts = {}; const wrappedPorts = Object.fromEntries(Object.entries(ports).map(([worker, port]) => [worker, { async callTool(name, args) { const response = await port.callTool(name, args); if (name === LOCAL_BRIDGES[worker].start_tool) starts[worker] = { args, response }; return response; } }]));
  const profiles = { codex: { sandbox: "read-only", approval_policy: "never" }, claude: { effort: "low" }, pi: { mode: "read", readScope: { files: ["READ_ONLY_FIXTURE.txt"], maxCalls: 2, maxOutputBytes: 4096 } } };
  const workers = Object.fromEntries(["codex", "claude", "pi"].map(worker => [worker, { availability: availability[worker].available ? "available" : "unavailable", budget_pressure: "normal" }]));
  const recovery = await runCrossWorkerRecovery({ host_state: initial, termination_evidence: { signals: ["tool_runtime_failure"] }, runtime_facts: { workspace: checkpoint.workspace, human_block: "none", effect: { kind: "read_only", status: "known_not_applied", prior_claim_keys: [] } }, policy: { max_reroute_count: 2 }, task: { task_class: "general_engineering" }, worker_state: { workers, failed_workers: [] }, routing_policy: {}, transport: new MultiBridgeSpawnTransport(wrappedPorts, profiles), persist_state: state => store.save(state) });
  if (recovery.outcome !== "spawned") throw new Error(`cross-worker outcome ${recovery.outcome}:${recovery.reason_code}`);
  const target = recovery.target_worker_id; const start = starts[target]; let targetObservation;
  if (target === "claude") targetObservation = await ports.claude.callTool("claude_observe", { run_id: start.response.run_id, cursor: 0, limit: 100, wait_ms: 1_000 });
  else if (target === "pi") targetObservation = await ports.pi.callTool("pi_observe", { cursor: 0, limit: 100 });
  else targetObservation = await ports.codex.callTool("codex_observe", { thread_id: start.response.thread_id, cursor: 0, limit: 100, wait_ms: 1_000 });
  const restored = await store.load(); const after = digest(await readFile(fixture)); const prompt = start.args.task ?? start.args.text;
  const evidence = { gate: "LSH-4", result: "pass", availability, source: { worker_id: "codex", thread_id: source.thread_id, observed: sourceObserved.runtime_available === true, terminal_status: sourceTerminal.terminal.status }, selection: { delegated_to_selectWorker: true, target_worker_id: target, differs_from_source: target !== "codex" }, target: { native_session_id: restored.task_checkpoint.last_execution.native_session_id, start_accepted: true, observable_same_port: Boolean(targetObservation) }, continuation: { marker: prompt.startsWith("SUPERVISOR_CONTINUATION_V1"), task_id_present: prompt.includes("lsh4-live-stable-task"), completed_gates_present: prompt.includes('"completed":["LSH-1","LSH-2","LSH-3"]') }, supervisor: { task_id_stable: restored.task_checkpoint.task.id === checkpoint.task.id, completed_gates: restored.task_checkpoint.gates.completed, phase: restored.phase, retry_count: restored.task_checkpoint.continuation.retry_count, claims: restored.claims.length, receipts: restored.receipts.map(({ event, status }) => ({ event, status })) }, fixture_unchanged: before === after, mutation_effect: "none" };
  if (!evidence.selection.differs_from_source || !evidence.target.observable_same_port || !evidence.continuation.marker || !evidence.continuation.task_id_present || !evidence.continuation.completed_gates_present || !evidence.supervisor.task_id_stable || evidence.supervisor.phase !== "observing" || evidence.supervisor.claims !== 1 || !evidence.fixture_unchanged) throw new Error("LSH-4 assertions failed");
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
} finally {
  if (store) await store.release().catch(() => {}); for (const port of Object.values(ports)) await port.close().catch(() => {}); await rm(workspace, { recursive: true, force: true });
}
