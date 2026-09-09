import { constants } from "node:fs";
import { link, mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { FileCheckpointStore } from "./checkpoint-store.mjs";
import { hostStatus, reconcileAcceptedSpawn } from "./host-service.mjs";
import { runCrossWorkerRecovery, runSameWorkerRecovery } from "./recovery-host.mjs";

export const HOST_SERVICE_VERSION = 1;

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} must be a positive integer`);
  return value;
}

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  const handle = await open(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try { await handle.writeFile(`${JSON.stringify(value)}\n`); await handle.sync(); } finally { await handle.close(); }
  await rename(temp, path);
}

export class HostServiceLock {
  #path; #handle = null;
  constructor(path) { this.#path = resolve(path); }
  async acquire() {
    await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try { this.#handle = await open(this.#path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600); await this.#handle.writeFile(`${process.pid}\n`); return; }
      catch (error) {
        if (error?.code !== "EEXIST") throw error;
        let source; try { source = await readFile(this.#path, "utf8"); } catch { throw new Error(`Supervisor Host lock owner is unreadable: ${this.#path}`); }
        if (!/^[1-9][0-9]*\n$/.test(source)) throw new Error(`Supervisor Host lock owner is malformed: ${this.#path}`);
        const pid = Number(source.slice(0, -1)); if (!Number.isSafeInteger(pid)) throw new Error(`Supervisor Host lock owner is malformed: ${this.#path}`);
        try { process.kill(pid, 0); throw new Error(`Supervisor Host service is already running: ${this.#path}`); }
        catch (ownerError) {
          if (ownerError?.message?.startsWith("Supervisor Host service is already running") || ownerError?.code === "EPERM") throw new Error(`Supervisor Host lock owner liveness is not safely disprovable: ${this.#path}`);
          if (ownerError?.code !== "ESRCH") throw ownerError;
        }
        const quarantine = `${this.#path}.reclaim.${process.pid}.${attempt}`;
        try { await rename(this.#path, quarantine); } catch (renameError) { if (renameError?.code === "ENOENT") continue; throw renameError; }
        const quarantined = await readFile(quarantine, "utf8").catch(() => null);
        if (quarantined !== source) {
          try { await link(quarantine, this.#path); } catch (restoreError) { if (restoreError?.code !== "EEXIST") throw restoreError; }
          await rm(quarantine, { force: true });
          throw new Error(`Supervisor Host lock changed during stale reclaim: ${this.#path}`);
        }
        try { process.kill(pid, 0); try { await link(quarantine, this.#path); } catch (restoreError) { if (restoreError?.code !== "EEXIST") throw restoreError; } await rm(quarantine, { force: true }); throw new Error(`Supervisor Host lock owner became live during reclaim: ${this.#path}`); }
        catch (ownerError) { if (ownerError?.message?.includes("became live") || ownerError?.code === "EPERM") throw ownerError; if (ownerError?.code !== "ESRCH") throw ownerError; }
        try { this.#handle = await open(this.#path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600); await this.#handle.writeFile(`${process.pid}\n`); await rm(quarantine, { force: true }); return; }
        catch (claimError) { await rm(quarantine, { force: true }); if (claimError?.code === "EEXIST") continue; throw claimError; }
      }
    }
    throw new Error(`Supervisor Host lock could not be reclaimed: ${this.#path}`);
  }
  async release() { if (!this.#handle) return; await this.#handle.close(); this.#handle = null; await rm(this.#path, { force: true }); }
}

export async function inspectCheckpoint(path) {
  const store = new FileCheckpointStore(path);
  await store.acquire();
  try { const state = await store.load(); return state ? hostStatus(state) : null; }
  finally { await store.release(); }
}

function validateDescriptor(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("task descriptor must be an object");
  if (value.descriptor_version !== 1) throw new TypeError("task descriptor_version is unsupported");
  if (!["same_worker_recovery", "cross_worker_recovery", "reconcile_accepted_spawn"].includes(value.operation)) throw new TypeError("task descriptor operation is invalid");
  if (!Number.isSafeInteger(value.expected_checkpoint_revision) || value.expected_checkpoint_revision < 0) throw new TypeError("task descriptor expected_checkpoint_revision is invalid");
  if (typeof value.expected_native_session_id !== "string" || value.expected_native_session_id.length === 0) throw new TypeError("task descriptor expected_native_session_id is required");
  return value;
}

export async function loadTaskDescriptor(path) { return validateDescriptor(JSON.parse(await readFile(`${path}.descriptor`, "utf8"))); }

export async function processDurableTask(path, { transport, inspect_spawn } = {}) {
  const descriptor = await loadTaskDescriptor(path); const store = new FileCheckpointStore(path); await store.acquire();
  try {
    let state = await store.load(); if (!state) throw new Error("task checkpoint is missing");
    const checkpoint = state.task_checkpoint;
    if (checkpoint.revision !== descriptor.expected_checkpoint_revision || checkpoint.last_execution.native_session_id !== descriptor.expected_native_session_id) return hostStatus(state);
    const persist_state = value => store.save(value);
    if (descriptor.operation === "reconcile_accepted_spawn") await reconcileAcceptedSpawn({ host_state: state, inspect_spawn, persist_state });
    else if (descriptor.operation === "same_worker_recovery") await runSameWorkerRecovery({ host_state: state, termination_evidence: descriptor.termination_evidence, runtime_facts: descriptor.runtime_facts, policy: descriptor.policy, transport, persist_state });
    else await runCrossWorkerRecovery({ host_state: state, termination_evidence: descriptor.termination_evidence, runtime_facts: descriptor.runtime_facts, policy: descriptor.policy, transport, persist_state, task: descriptor.task, worker_state: descriptor.worker_state, routing_policy: descriptor.routing_policy });
    return hostStatus(await store.load());
  } finally { await store.release(); }
}

export async function scanHostCheckpoints(tasksDir, inspect = inspectCheckpoint) {
  let entries;
  try { entries = await readdir(tasksDir, { withFileTypes: true }); }
  catch (error) { if (error?.code === "ENOENT") return []; throw error; }
  const results = [];
  for (const entry of entries.filter(item => item.isFile() && item.name.endsWith(".json")).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(tasksDir, entry.name);
    try { results.push({ path, status: await inspect(path), error: null }); }
    catch (error) { results.push({ path, status: null, error: error?.message ?? String(error) }); }
  }
  return results;
}

export function serviceHealth({ started_at, updated_at, cycle, checkpoints }) {
  const corrupt = checkpoints.filter(item => item.error);
  const degraded = checkpoints.filter(item => item.status && item.status.healthy === false);
  return Object.freeze({ service_version: HOST_SERVICE_VERSION, alive: true, ready: true, healthy: corrupt.length === 0 && degraded.length === 0, started_at, updated_at, pid: process.pid, cycle, checkpoint_count: checkpoints.length, degraded_count: degraded.length, error_count: corrupt.length, checkpoints });
}

export async function runHostDaemon({ state_dir, interval_ms = 5_000, once = false, inspect = inspectCheckpoint, signal } = {}) {
  if (typeof state_dir !== "string" || state_dir.length === 0) throw new TypeError("state_dir is required");
  positiveInteger(interval_ms, "interval_ms");
  const root = resolve(state_dir); const tasksDir = join(root, "tasks"); const healthPath = join(root, "health.json");
  await mkdir(tasksDir, { recursive: true, mode: 0o700 });
  const lock = new HostServiceLock(join(root, "service.lock")); await lock.acquire();
  const started = new Date().toISOString(); let cycle = 0;
  try {
    do {
      cycle += 1; const checkpoints = await scanHostCheckpoints(tasksDir, inspect); const now = new Date().toISOString();
      await atomicJson(healthPath, serviceHealth({ started_at: started, updated_at: now, cycle, checkpoints }));
      if (once) break;
      await new Promise(resolveWait => { const timer = setTimeout(resolveWait, interval_ms); signal?.addEventListener("abort", () => { clearTimeout(timer); resolveWait(); }, { once: true }); });
    } while (!signal?.aborted);
  } finally { await lock.release(); }
  return { state_dir: root, health_path: healthPath, cycles: cycle };
}

export async function readServiceHealth(path) { return JSON.parse(await readFile(path, "utf8")); }
