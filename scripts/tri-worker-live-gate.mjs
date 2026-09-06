#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";

import {
  assertLiveLifecycle,
  normalizeObservation,
  normalizeStartAcceptance,
} from "../supervisor-policy/tri-worker-conformance.mjs";

const EXPECTED_TOKEN = "TRI_BRIDGE_CONTEXT_OK_7F29";
const CWD = "/home/ouzuiki/projects/Worker-Neutral-Supervisor/test/fixtures/tri-worker-context";
const REQUEST_TIMEOUT_MS = 30_000;
const RUN_TIMEOUT_MS = 180_000;
const TASK = "What is TRI_BRIDGE_CONTEXT_TOKEN? Return only its value.";

const WORKERS = Object.freeze([
  {
    worker: "codex",
    service: "tunnel-client-local-codex-bridge.service",
    launcher: "/home/ouzuiki/.local/bin/local-codex-bridge-run",
    startTool: "codex_turn",
    startArgs: { text: TASK, cwd: CWD, sandbox: "read-only", approval_policy: "never" },
  },
  {
    worker: "claude",
    service: "tunnel-client-local-claude-bridge.service",
    launcher: "/home/ouzuiki/.local/bin/local-claude-bridge-run",
    startTool: "claude_start",
    startArgs: { task: TASK, cwd: CWD },
  },
  {
    worker: "pi",
    service: "tunnel-client-local-pi-bridge.service",
    launcher: "/home/ouzuiki/.local/bin/local-pi-bridge-run",
    startTool: "pi_start",
    startArgs: {
      task: TASK,
      cwd: CWD,
      mode: "read",
      readScope: { files: ["AGENTS.md"], maxCalls: 1, maxOutputBytes: 4096 },
    },
  },
]);

class McpStdioClient {
  #child;
  #lines;
  #pending = new Map();
  #nextId = 1;
  #stderr = "";

  constructor(command) {
    this.#child = spawn(command, [], { stdio: ["pipe", "pipe", "pipe"], env: process.env });
    this.#child.stderr.on("data", (chunk) => { this.#stderr = `${this.#stderr}${chunk}`.slice(-4096); });
    this.#lines = createInterface({ input: this.#child.stdout });
    this.#lines.on("line", (line) => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(`MCP error ${message.error.code}: ${message.error.message}`));
      else pending.resolve(message.result);
    });
    this.#child.once("exit", (code, signal) => {
      for (const pending of this.#pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`bridge exited code=${code} signal=${signal}; stderr was captured but suppressed`));
      }
      this.#pending.clear();
    });
  }

  request(method, params = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      this.#child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  async initialize() {
    await this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "worker-neutral-tri-worker-live-gate", version: "1" },
    });
    this.#child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
  }

  async callTool(name, args = {}) {
    const result = await this.request("tools/call", { name, arguments: args });
    assert.notEqual(result?.isError, true, `${name} failed`);
    const text = result?.content?.find((part) => part.type === "text")?.text;
    assert.equal(typeof text, "string", `${name} returned no text result`);
    return JSON.parse(text);
  }

  async close() {
    if (!this.#child.stdin.destroyed && !this.#child.stdin.writableEnded) this.#child.stdin.end();
    await Promise.race([
      new Promise((resolve) => this.#child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(() => { this.#child.kill("SIGTERM"); resolve(); }, 3_000)),
    ]);
    this.#lines.close();
  }
}

function requireDeployedService(worker) {
  const check = spawnSync("systemctl", ["--user", "is-active", "--quiet", worker.service], { stdio: "ignore" });
  assert.equal(check.status, 0, `${worker.worker}: required deployed service ${worker.service} is unavailable`);
}

async function observeLifecycle(client, worker, start) {
  const deadline = Date.now() + RUN_TIMEOUT_MS;
  let observation;
  while (Date.now() < deadline) {
    if (worker.worker === "codex") {
      observation = await client.callTool("codex_observe", { thread_id: start.thread_id, cursor: 0, limit: 100, wait_ms: 2_000 });
      if (observation.terminal) return {
        observation,
        result: { terminal: true, ok: observation.terminal.status === "completed", token: observation.terminal.final_result },
      };
    } else if (worker.worker === "claude") {
      observation = await client.callTool("claude_observe", { run_id: start.run_id, cursor: 0, limit: 100, wait_ms: 2_000 });
      const native = await client.callTool("claude_result", { run_id: start.run_id });
      if (native.ready === true) return {
        observation,
        result: { terminal: true, ok: native.ok === true, token: native.final_answer },
      };
    } else {
      observation = await client.callTool("pi_observe", { cursor: 0, limit: 100 });
      const native = await client.callTool("pi_result", {});
      if (native.ready === true) return {
        observation,
        result: { terminal: true, ok: native.ok === true, token: native.text },
      };
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`${worker.worker}: live lifecycle timed out`);
}

async function runWorker(worker) {
  requireDeployedService(worker);
  const client = new McpStdioClient(worker.launcher);
  try {
    await client.initialize();
    const listed = await client.request("tools/list");
    assert.ok(listed.tools.some((tool) => tool.name === worker.startTool), `${worker.worker}: required tool unavailable`);
    const start = await client.callTool(worker.startTool, worker.startArgs);
    const startAccepted = normalizeStartAcceptance(worker.worker, start);
    assert.equal(startAccepted, true, `${worker.worker}: native start response did not prove acceptance`);
    const { observation, result } = await observeLifecycle(client, worker, start);
    return assertLiveLifecycle({
      worker: worker.worker,
      startAccepted,
      observation: normalizeObservation(worker.worker, observation),
      result,
      expectedToken: EXPECTED_TOKEN,
    });
  } finally {
    await client.close();
  }
}

const results = [];
for (const worker of WORKERS) results.push(await runWorker(worker));
process.stdout.write(`${JSON.stringify({ gate: "tri-worker-live-conformance", passed: true, workers: results })}\n`);
