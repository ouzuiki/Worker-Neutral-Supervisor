import { createContinuationEnvelope } from "./continuation-envelope.mjs";

export class BridgeSpawnTransport {
  #port; #profiles;
  constructor(port, profiles) { if (typeof port?.callTool !== "function") throw new TypeError("port.callTool is required"); this.#port = port; this.#profiles = profiles ?? {}; }
  async spawn(plan) {
    const worker = plan.action === "spawn_cross_worker" ? plan.target_worker_id : plan.source_worker_id;
    const profile = this.#profiles[worker]; if (!profile || typeof profile !== "object") throw new TypeError(`missing execution profile for ${worker}`);
    const { text } = createContinuationEnvelope(plan); let tool; let args;
    if (worker === "codex") { tool = "codex_turn"; args = { text, cwd: plan.workspace.path, sandbox: profile.sandbox, approval_policy: profile.approval_policy }; }
    else if (worker === "claude") { tool = "claude_start"; args = { task: text, cwd: plan.workspace.path, ...(profile.effort ? { effort: profile.effort } : {}) }; }
    else if (worker === "pi") { tool = "pi_start"; args = { task: text, cwd: plan.workspace.path, mode: profile.mode, ...(profile.readScope ? { readScope: profile.readScope } : {}), ...(profile.codingScope ? { codingScope: profile.codingScope } : {}) }; }
    else throw new TypeError("unsupported target worker");
    let response; try { response = await this.#port.callTool(tool, args); } catch (error) { return Object.freeze({ acknowledgement: "unknown", worker_id: worker, native_session_id: null, response_ref: null, reason: error.message }); }
    const accepted = worker === "codex" ? response?.accepted === true : response?.acknowledgement === "accepted" && response?.accepted !== false;
    if (!accepted) return Object.freeze({ acknowledgement: response?.acknowledgement === "unknown" ? "unknown" : "rejected", worker_id: worker, native_session_id: null, response_ref: null });
    const nativeSession = worker === "codex" ? response.thread_id : worker === "claude" ? response.session_id : response.sessionPath ?? response.session_path ?? null;
    if (typeof nativeSession !== "string" || nativeSession.length === 0) return Object.freeze({ acknowledgement: "unknown", worker_id: worker, native_session_id: null, response_ref: null, reason: "accepted spawn omitted native session identity" });
    return Object.freeze({ acknowledgement: "accepted", worker_id: worker, native_session_id: nativeSession, response_ref: `${worker}://${nativeSession}` });
  }
}

export class MultiBridgeSpawnTransport {
  #ports; #profiles;
  constructor(ports, profiles) { this.#ports = ports ?? {}; this.#profiles = profiles ?? {}; }
  async spawn(plan) { const worker = plan.action === "spawn_cross_worker" ? plan.target_worker_id : plan.source_worker_id; const port = this.#ports[worker]; if (!port) return Object.freeze({ acknowledgement: "rejected", worker_id: worker, native_session_id: null, response_ref: null }); return new BridgeSpawnTransport(port, this.#profiles).spawn(plan); }
}
