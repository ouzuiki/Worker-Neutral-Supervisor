#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { inspectCheckpoint, processDurableTask, runHostDaemon } from "../worker-neutral/supervisor-runtime/host-daemon.mjs";
import { McpStdioPort, LOCAL_BRIDGES } from "../worker-neutral/supervisor-runtime/mcp-stdio-port.mjs";
import { BridgeSpawnTransport } from "../worker-neutral/supervisor-runtime/bridge-transport.mjs";
import { BridgeLifecycleObserver } from "../worker-neutral/supervisor-runtime/bridge-observer.mjs";

const stateDir = process.env.SUPERVISOR_HOST_STATE_DIR;
const interval = Number.parseInt(process.env.SUPERVISOR_HOST_INTERVAL_MS ?? "5000", 10);
const shd4BarrierEnabled = process.argv.includes("--enable-shd4-test-barrier");
if (!stateDir) { process.stderr.write("SUPERVISOR_HOST_STATE_DIR is required\n"); process.exitCode = 2; }
else {
  const controller = new AbortController();
  for (const name of ["SIGTERM", "SIGINT"]) process.once(name, () => controller.abort());
  const ports = {};
  const portFor = async worker => { if (!ports[worker]) { const port = new McpStdioPort(LOCAL_BRIDGES[worker].launcher); await port.initialize(); ports[worker] = port; } return ports[worker]; };
  const inspect = async path => {
    let descriptor; try { descriptor = JSON.parse(await readFile(`${path}.descriptor`, "utf8")); } catch (error) { if (error?.code === "ENOENT") return inspectCheckpoint(path); throw error; }
    const transport = { spawn: async plan => { const worker = plan.action === "spawn_cross_worker" ? plan.target_worker_id : plan.source_worker_id; return new BridgeSpawnTransport(await portFor(worker), descriptor.profiles ?? {}).spawn(plan); } };
    return processDurableTask(path, { transport, shd4_test_barrier: shd4BarrierEnabled ? { enabled: true, root: `${stateDir}/shd4-test-barriers` } : null, inspect_spawn: async evidence => { const fact = await new BridgeLifecycleObserver(await portFor(evidence.worker_id)).observe({ worker_id: evidence.worker_id, native_session_id: evidence.native_session_id, cursor: 0 }); return { status: fact.runtime_available ? "accepted" : "unknown", worker_id: evidence.worker_id, native_session_id: evidence.native_session_id }; } });
  };
  try { await runHostDaemon({ state_dir: stateDir, interval_ms: interval, once: process.argv.includes("--once"), signal: controller.signal, inspect }); }
  finally { await Promise.all(Object.values(ports).map(port => port.close().catch(() => {}))); }
}
