import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { McpStdioPort } from "./mcp-stdio-port.mjs";

test("LSH-2 close observes an already-clean child exit without waiting for timeout", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-close-")); const launcher = join(dir, "fixture");
  await writeFile(launcher, "#!/bin/sh\nexit 0\n"); await chmod(launcher, 0o700);
  const port = new McpStdioPort(launcher, { request_timeout_ms: 100 });
  await assert.rejects(() => port.initialize(), (error) => error?.code === "EPIPE" || /exited before response/.test(error?.message));
  const before = Date.now(); await port.close(); assert.ok(Date.now() - before < 500, "close must reuse the settled exit promise");
});

test("LSH-6 tool failures preserve the bridge blocker text", async () => {
  const dir = await mkdtemp(join(process.cwd(), ".mcp-tool-error-")); const launcher = join(dir, "fixture.cjs");
  await writeFile(launcher, `#!/usr/bin/env node
const { createInterface } = require("node:readline");
(async () => { for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  const result = request.method === "tools/call"
    ? { isError: true, content: [{ type: "text", text: "Quota exhausted until tomorrow" }] }
    : request.method === "tools/list" ? { tools: [] } : {};
  if (request.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\\n");
} })();
`); await chmod(launcher, 0o700);
  const port = new McpStdioPort(launcher, { request_timeout_ms: 1_000 });
  try { await port.initialize(); await assert.rejects(() => port.callTool("pi_start", {}), /pi_start failed: Quota exhausted until tomorrow/); }
  finally { await port.close(); await rm(dir, { recursive: true, force: true }); }
});
