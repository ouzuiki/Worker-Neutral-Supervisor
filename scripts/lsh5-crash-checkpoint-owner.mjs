#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { FileCheckpointStore } from "../worker-neutral/supervisor-runtime/checkpoint-store.mjs";

const [checkpointPath, statePath] = process.argv.slice(2);
if (!checkpointPath || !statePath) throw new Error("checkpoint and state paths are required");
const state = JSON.parse(await readFile(statePath, "utf8")); const store = new FileCheckpointStore(checkpointPath);
await store.acquire(); await store.save(state);
process.stdout.write(`${JSON.stringify({ checkpoint_written: true, owner_pid: process.pid, simulated_crash_exit_code: 91 })}\n`, () => process.exit(91));
