#!/usr/bin/env node
import { FileCheckpointStore } from "../worker-neutral/supervisor-runtime/checkpoint-store.mjs";
import { hostStatus } from "../worker-neutral/supervisor-runtime/host-service.mjs";

const path = process.argv[2];
if (!path) { process.stderr.write("usage: supervisor-host-status <checkpoint>\n"); process.exitCode = 2; }
else { const state = await new FileCheckpointStore(path).load(); if (!state) { process.stderr.write("checkpoint not found\n"); process.exitCode = 1; } else process.stdout.write(`${JSON.stringify(hostStatus(state))}\n`); }
