import { constants } from "node:fs";
import { link, mkdir, open, readFile, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { digestHostPayload } from "./host-state.mjs";

export const SHD4_TEST_PROFILE = "shd4-v1-disposable-benign-non-mutating";

function exactText(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) throw new TypeError(`${label} must be a non-empty trimmed string`);
  return value;
}

async function atomicCreateExclusive(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  const handle = await open(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try { await handle.writeFile(`${JSON.stringify(value)}\n`); await handle.sync(); } finally { await handle.close(); }
  try { await link(temp, path); } catch (error) { if (error?.code === "EEXIST") throw new Error(`SHD-4 barrier attempt already exists: ${path}`); throw error; }
  finally { await rm(temp, { force: true }); }
  const directory = await open(dirname(path), constants.O_RDONLY); try { await directory.sync(); } finally { await directory.close(); }
}

export function validateShd4BarrierDescriptor(value) {
  if (value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("shd4_test_barrier must be an object");
  const keys = Object.keys(value).sort();
  if (JSON.stringify(keys) !== JSON.stringify(["attempt_id", "disposable", "mutation_effect", "profile", "token", "turn_id"].sort())) throw new TypeError("shd4_test_barrier has invalid fields");
  if (value.profile !== SHD4_TEST_PROFILE || value.disposable !== true || value.mutation_effect !== "none") throw new TypeError("shd4_test_barrier profile is not eligible");
  const attemptId = exactText(value.attempt_id, "attempt_id");
  if (attemptId === "." || attemptId === ".." || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(attemptId)) throw new TypeError("attempt_id is not a safe bounded identifier");
  return Object.freeze({ profile: value.profile, disposable: true, mutation_effect: "none", attempt_id: attemptId, token: exactText(value.token, "token"), turn_id: value.turn_id === null ? null : exactText(value.turn_id, "turn_id") });
}

export function createShd4PreKillBarrier({ enabled = false, root, descriptor, checkpoint_path, process_identity = process.pid, poll_ms = 25 } = {}) {
  if (!enabled) return null;
  const profile = validateShd4BarrierDescriptor(descriptor?.shd4_test_barrier);
  if (!profile) throw new TypeError("explicit SHD-4 test barrier descriptor is required");
  if (typeof root !== "string" || root.length === 0) throw new TypeError("SHD-4 barrier root is required");
  if (!Number.isSafeInteger(poll_ms) || poll_ms < 1) throw new TypeError("poll_ms is invalid");
  const barrierRoot = resolve(root); const reservationPath = join(barrierRoot, `${profile.attempt_id}.reserved.json`); const armPath = join(barrierRoot, `${profile.attempt_id}.armed.json`); const controlPath = join(barrierRoot, `${profile.attempt_id}.control.json`);
  let reservation = null; let used = false;
  const reserve = async ({ plan }) => {
    if (reservation || used) throw new Error("SHD-4 test barrier is one-shot");
    for (const [path, label] of [[armPath, "arm"], [controlPath, "control"]]) {
      try { await readFile(path); throw new Error(`SHD-4 barrier ${label} already exists before reservation`); } catch (error) { if (error?.code !== "ENOENT") throw error; }
    }
    reservation = Object.freeze({ barrier_version: 1, status: "reserved", attempt_id: profile.attempt_id, task_id: plan.task_id, claim_key: plan.claim_key, process_identity });
    await atomicCreateExclusive(reservationPath, reservation);
  };
  const afterSpawn = async ({ state, plan, spawn, reload }) => {
    if (!reservation || used) throw new Error("SHD-4 test barrier is not uniquely reserved"); used = true;
    const storedReservation = JSON.parse(await readFile(reservationPath, "utf8"));
    if (JSON.stringify(storedReservation) !== JSON.stringify(reservation) || reservation.task_id !== plan.task_id || reservation.claim_key !== plan.claim_key) throw new Error("SHD-4 barrier reservation identity mismatch");
    const durable = await reload();
    const evidence = durable?.active_action?.spawn_evidence;
    if (durable?.phase !== "awaiting_ack" || durable.sequence !== state.sequence || durable.task_checkpoint.task.id !== plan.task_id || durable.active_action?.claim_key !== plan.claim_key || evidence?.worker_id !== spawn.worker_id || evidence?.native_session_id !== spawn.native_session_id) throw new Error("SHD-4 barrier durable identity verification failed");
    try { await readFile(controlPath); throw new Error("SHD-4 barrier control already exists before arming"); } catch (error) { if (error?.code !== "ENOENT") throw error; }
    const record = Object.freeze({ barrier_version: 1, status: "armed", attempt_id: profile.attempt_id, task_id: plan.task_id, claim_key: plan.claim_key, worker_id: spawn.worker_id, native_session_id: spawn.native_session_id, turn_id: profile.turn_id, checkpoint_path: resolve(checkpoint_path), checkpoint_revision: durable.task_checkpoint.revision, checkpoint_sequence: durable.sequence, checkpoint_digest: digestHostPayload(durable), process_identity });
    await atomicCreateExclusive(armPath, record);
    for (;;) {
      let control;
      try { control = JSON.parse(await readFile(controlPath, "utf8")); }
      catch (error) { if (error?.code === "ENOENT") { await new Promise(resolveWait => setTimeout(resolveWait, poll_ms)); continue; } if (error instanceof SyntaxError) throw new Error("SHD-4 barrier control is malformed"); throw error; }
      if (control?.attempt_id !== profile.attempt_id || control?.token !== profile.token || !["release", "abort"].includes(control?.action)) throw new Error("SHD-4 barrier control identity mismatch");
      return Object.freeze({ action: control.action, record });
    }
  };
  return Object.freeze({ reserve, afterSpawn });
}
