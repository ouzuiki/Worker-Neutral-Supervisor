import { normalizeSemanticProgress } from "../../supervisor-policy/reasoning-watchdog.mjs";

export const SUPPORTED_WORKERS = Object.freeze(["codex", "claude", "pi"]);
export const UNAVAILABLE_SEMANTIC_PROGRESS = Object.freeze({ semantic_state: "blocked", last_productive_at: null, last_productive_cursor: null, thinking_tokens_since_productive: 0 });

function object(value, label) { if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`); return value; }
function optionalText(value, label) { if (value === null || value === undefined) return null; if (typeof value !== "string" || value.length === 0) throw new TypeError(`${label} must be a non-empty string or null`); return value; }

function lifecycle(status, terminal) {
  if (terminal) {
    if (terminal.ok === true || terminal.status === "completed") return { native_state: "terminal", termination_signal: "normal_completion" };
    const reason = `${terminal.terminal_reason ?? terminal.status ?? ""}`;
    if (reason.includes("interrupt")) return { native_state: "terminal", termination_signal: "interrupted" };
    if (reason.includes("timeout")) return { native_state: "terminal", termination_signal: "runtime_timeout" };
    if (reason.includes("safety")) return { native_state: "terminal", termination_signal: "safety_block" };
    return { native_state: "terminal", termination_signal: "tool_runtime_failure" };
  }
  if (["running", "starting", "interrupting"].includes(status)) return { native_state: "active", termination_signal: null };
  return { native_state: "unknown", termination_signal: "unknown" };
}

export function normalizeBridgeObservation(worker, observation, result = null, requested_native_session_id = null) {
  if (!SUPPORTED_WORKERS.includes(worker)) throw new TypeError("unsupported worker");
  const value = object(observation, "observation");
  const pending = worker === "pi" ? value.pendingRequests : value.pending_requests;
  if (!Array.isArray(pending)) throw new TypeError("observation pending requests must be an array");
  const terminal = value.terminal ?? (result?.ready === true ? result : null);
  const status = `${value.runtime_status ?? value.status ?? value.phase ?? (terminal ? "terminal" : "unknown")}`;
  const nativeSession = worker === "codex"
    ? optionalText(value.thread_id ?? value.scope?.thread_id ?? requested_native_session_id, "observation.thread_id")
    : worker === "claude"
      ? optionalText(value.session_id ?? terminal?.session_id, "observation.session_id")
      : optionalText(value.sessionPath ?? value.session_path ?? terminal?.sessionPath, "observation.session_path");
  const runtimeAvailable = value.runtime_available !== false;
  const semanticProgressAvailable = value.semantic_progress !== undefined && value.semantic_progress !== null;
  const state = runtimeAvailable ? lifecycle(status, terminal) : { native_state: "unknown", termination_signal: "unknown" };
  return Object.freeze({
    fact_version: 1, worker_id: worker, native_session_id: nativeSession,
    native_state: state.native_state, native_status: status,
    termination_signal: state.termination_signal,
    pending_approval: pending.length > 0,
    semantic_progress: semanticProgressAvailable ? normalizeSemanticProgress(value.semantic_progress) : UNAVAILABLE_SEMANTIC_PROGRESS,
    semantic_progress_available: semanticProgressAvailable,
    watchdog_eligible: semanticProgressAvailable,
    runtime_available: runtimeAvailable,
    cursor: Number.isSafeInteger(value.next_cursor) ? value.next_cursor : Number.isSafeInteger(value.nextCursor) ? value.nextCursor : null,
    stream_id: optionalText(value.stream_id ?? value.streamId, "observation.stream_id"),
  });
}

export class BridgeLifecycleObserver {
  #port;
  constructor(port) { if (typeof port?.callTool !== "function") throw new TypeError("port.callTool is required"); this.#port = port; }
  async observe({ worker_id, native_session_id, cursor = 0 } = {}) {
    if (!SUPPORTED_WORKERS.includes(worker_id)) throw new TypeError("unsupported worker");
    let observation; let result = null;
    if (worker_id === "codex") observation = await this.#port.callTool("codex_observe", { thread_id: native_session_id, cursor, limit: 100, wait_ms: 0 });
    else if (worker_id === "claude") { observation = await this.#port.callTool("claude_observe", { run_id: native_session_id, cursor, limit: 100, wait_ms: 0 }); result = await this.#port.callTool("claude_result", { run_id: native_session_id }); }
    else { observation = await this.#port.callTool("pi_observe", { cursor, limit: 100 }); result = await this.#port.callTool("pi_result", {}); }
    return normalizeBridgeObservation(worker_id, observation, result, native_session_id);
  }
}
