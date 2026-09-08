import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export class McpStdioPort {
  #child; #lines; #pending = new Map(); #nextId = 1; #exit;
  constructor(command, { request_timeout_ms = 30_000 } = {}) {
    if (typeof command !== "string" || command.length === 0) throw new TypeError("bridge launcher is required");
    this.request_timeout_ms = request_timeout_ms;
    this.#child = spawn(command, [], { stdio: ["pipe", "pipe", "pipe"], env: process.env });
    this.#exit = new Promise((resolve) => {
      this.#child.once("exit", (code, signal) => resolve({ code, signal }));
      this.#child.once("error", (error) => resolve({ error }));
    });
    this.#child.stderr.resume();
    this.#child.stdin.on("error", (error) => { for (const pending of this.#pending.values()) { clearTimeout(pending.timer); pending.reject(error); } this.#pending.clear(); });
    this.#lines = createInterface({ input: this.#child.stdout });
    this.#lines.on("line", (line) => { let message; try { message = JSON.parse(line); } catch { return; } const pending = this.#pending.get(message.id); if (!pending) return; this.#pending.delete(message.id); clearTimeout(pending.timer); if (message.error) pending.reject(new Error(`MCP ${message.error.code}: ${message.error.message}`)); else pending.resolve(message.result); });
    this.#child.once("exit", (code, signal) => { for (const pending of this.#pending.values()) { clearTimeout(pending.timer); pending.reject(new Error(`bridge exited before response code=${code} signal=${signal}`)); } this.#pending.clear(); });
    this.#child.once("error", (error) => { for (const pending of this.#pending.values()) { clearTimeout(pending.timer); pending.reject(error); } this.#pending.clear(); });
  }
  request(method, params = {}) { const id = this.#nextId++; return new Promise((resolve, reject) => { const timer = setTimeout(() => { this.#pending.delete(id); reject(new Error(`timeout waiting for ${method}`)); }, this.request_timeout_ms); this.#pending.set(id, { resolve, reject, timer }); this.#child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`, (error) => { if (error && this.#pending.delete(id)) { clearTimeout(timer); reject(error); } }); }); }
  async initialize() { await this.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "worker-neutral-supervisor-host", version: "1" } }); this.#child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`); }
  async listTools() { return (await this.request("tools/list")).tools; }
  async callTool(name, args = {}) { const result = await this.request("tools/call", { name, arguments: args }); const part = result?.content?.find((item) => item.type === "text"); if (result?.isError) throw new Error(`${name} failed${typeof part?.text === "string" && part.text.length > 0 ? `: ${part.text}` : ""}`); if (typeof part?.text !== "string") throw new Error(`${name} returned no JSON text`); return JSON.parse(part.text); }
  async close() {
    const exited = this.#exit;
    if (!this.#child.stdin.destroyed && !this.#child.stdin.writableEnded) this.#child.stdin.end();
    let timer; await Promise.race([exited, new Promise((resolve) => { timer = setTimeout(() => { this.#child.kill("SIGTERM"); resolve(); }, 3_000); })]);
    clearTimeout(timer); this.#lines.close();
  }
}

export const LOCAL_BRIDGES = Object.freeze({
  codex: { launcher: "/home/ouzuiki/.local/bin/local-codex-bridge-run", start_tool: "codex_turn", observe_tools: ["codex_observe"] },
  claude: { launcher: "/home/ouzuiki/.local/bin/local-claude-bridge-run", start_tool: "claude_start", observe_tools: ["claude_observe", "claude_result"] },
  pi: { launcher: "/home/ouzuiki/.local/bin/local-pi-bridge-run", start_tool: "pi_start", observe_tools: ["pi_observe", "pi_result"] },
});

export async function probeBridge(worker_id, config = LOCAL_BRIDGES[worker_id]) {
  if (!config) throw new TypeError("unsupported worker"); const port = new McpStdioPort(config.launcher);
  try { await port.initialize(); const tools = (await port.listTools()).map(({ name }) => name); const required = [config.start_tool, ...config.observe_tools]; const missing = required.filter((name) => !tools.includes(name)); return Object.freeze({ worker_id, launcher: config.launcher, initialized: true, available: missing.length === 0, required_tools: required, missing_tools: missing }); }
  finally { await port.close(); }
}
