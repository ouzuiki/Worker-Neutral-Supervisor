import { constants } from "node:fs";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { digestHostPayload, validateHostState } from "./host-state.mjs";

export class CorruptCheckpointError extends Error { constructor(message) { super(message); this.name = "CorruptCheckpointError"; } }
export class ConcurrentHostError extends Error { constructor(message) { super(message); this.name = "ConcurrentHostError"; } }

export class FileCheckpointStore {
  #path; #lockPath; #lock = null;
  constructor(path) { if (typeof path !== "string" || path.length === 0) throw new TypeError("checkpoint path is required"); this.#path = resolve(path); this.#lockPath = `${this.#path}.lock`; }
  get path() { return this.#path; }
  async acquire() {
    await mkdir(dirname(this.#path), { recursive: true });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try { this.#lock = await open(this.#lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600); await this.#lock.writeFile(`${process.pid}\n`); return; }
      catch (error) {
        if (error?.code !== "EEXIST") throw error;
        let pid; try { pid = Number.parseInt((await readFile(this.#lockPath, "utf8")).trim(), 10); } catch { throw new ConcurrentHostError(`checkpoint lock owner is unreadable: ${this.#path}`); }
        if (!Number.isSafeInteger(pid) || pid < 1) throw new ConcurrentHostError(`checkpoint lock owner is invalid: ${this.#path}`);
        try { process.kill(pid, 0); throw new ConcurrentHostError(`checkpoint is already claimed: ${this.#path}`); }
        catch (ownerError) { if (ownerError instanceof ConcurrentHostError || ownerError?.code === "EPERM") throw ownerError; if (ownerError?.code !== "ESRCH") throw ownerError; }
        await rm(this.#lockPath, { force: true });
      }
    }
    throw new ConcurrentHostError(`checkpoint lock could not be reclaimed: ${this.#path}`);
  }
  async release() { if (this.#lock) { await this.#lock.close(); this.#lock = null; await rm(this.#lockPath, { force: true }); } }
  async load() {
    let source; try { source = await readFile(this.#path, "utf8"); } catch (error) { if (error?.code === "ENOENT") return null; throw error; }
    try {
      const envelope = JSON.parse(source);
      if (envelope?.format !== "supervisor-host-checkpoint-v1" || typeof envelope.digest !== "string") throw new Error("invalid envelope");
      if (digestHostPayload(envelope.payload) !== envelope.digest) throw new Error("digest mismatch");
      return validateHostState(envelope.payload);
    } catch (error) { throw new CorruptCheckpointError(`checkpoint cannot be restored: ${error.message}`); }
  }
  async save(state) {
    const payload = validateHostState(state); const envelope = { format: "supervisor-host-checkpoint-v1", digest: digestHostPayload(payload), payload };
    await mkdir(dirname(this.#path), { recursive: true });
    const temp = join(dirname(this.#path), `.${basename(this.#path)}.${process.pid}.${payload.sequence}.tmp`);
    const handle = await open(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    try { await handle.writeFile(`${JSON.stringify(envelope)}\n`); await handle.sync(); } finally { await handle.close(); }
    await rename(temp, this.#path);
    const directory = await open(dirname(this.#path), constants.O_RDONLY); try { await directory.sync(); } finally { await directory.close(); }
  }
}
