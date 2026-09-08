import { validateTaskCheckpoint } from "./task-continuation.mjs";

export const TERMINATION_SIGNALS = Object.freeze([
  "normal_completion",
  "interrupted",
  "session_timeout",
  "runtime_timeout",
  "context_exhausted",
  "transient_provider_error",
  "model_stall",
  "tool_runtime_failure",
  "safety_block",
  "terminal_task_failure",
  "unknown",
]);

export const TERMINATION_CLASSIFICATIONS = Object.freeze({
  TERMINAL: "terminal",
  CONTINUE: "continue_next_phase",
  RESUMABLE: "resumable",
  RETRY_CANDIDATE: "retry_same_worker_candidate",
  RECOVERY_CANDIDATE: "retry_or_reroute_candidate",
  HUMAN_REQUIRED: "human_required",
  REVIEW_REQUIRED: "review_required",
});

export const TERMINATION_DISPOSITIONS = Object.freeze({
  STOP: "stop",
  CONTINUE_NEXT_PHASE: "continue_next_phase",
  RESUME_FROM_CHECKPOINT: "resume_from_checkpoint",
  CONSIDER_SAME_WORKER_RETRY: "consider_same_worker_retry",
  CONSIDER_RETRY_OR_REROUTE: "consider_retry_or_reroute",
  HUMAN_REQUIRED: "human_required",
  REVIEW_REQUIRED: "review_required",
  ESCALATE_FAILED: "escalate_failed",
});

export const TERMINATION_REASONS = Object.freeze({
  TASK_COMPLETED: "task_already_completed",
  TASK_CANCELLED: "task_already_cancelled",
  APPROVAL_PENDING: "approval_pending",
  APPROVAL_REJECTED: "approval_rejected",
  SAFETY_BLOCK: "safety_block",
  CONTRADICTORY_EVIDENCE: "contradictory_termination_evidence",
  UNKNOWN_EVIDENCE: "termination_evidence_unknown",
  NORMAL_COMPLETION_OPEN_TASK: "normal_completion_open_task",
  SESSION_INTERRUPTED: "session_interrupted",
  SESSION_TIMEOUT: "session_timeout",
  RUNTIME_TIMEOUT: "runtime_timeout",
  CONTEXT_EXHAUSTED: "context_exhausted",
  TRANSIENT_PROVIDER_ERROR: "transient_provider_error",
  MODEL_STALL: "model_stall",
  TOOL_RUNTIME_FAILURE: "tool_runtime_failure",
  TERMINAL_TASK_FAILURE: "terminal_task_failure",
});

const SIGNAL_SET = new Set(TERMINATION_SIGNALS);

function normalizeEvidence(evidence) {
  if (evidence === null || typeof evidence !== "object" || Array.isArray(evidence) || Object.getPrototypeOf(evidence) !== Object.prototype) {
    throw new TypeError("termination_evidence must be a plain object");
  }
  for (const key of Object.keys(evidence)) {
    if (key !== "signals") throw new TypeError(`termination_evidence has an unknown key: ${key}`);
  }
  if (!Object.hasOwn(evidence, "signals") || !Array.isArray(evidence.signals)) {
    throw new TypeError("termination_evidence.signals must be an array");
  }
  const signals = evidence.signals.map((signal, index) => {
    if (!SIGNAL_SET.has(signal)) throw new TypeError(`termination_evidence.signals[${index}] has an invalid value`);
    return signal;
  });
  if (new Set(signals).size !== signals.length) throw new TypeError("termination_evidence.signals must not contain duplicates");
  return signals;
}

function result(classification, reasonCode, disposition, sameWorker, reroute, automaticResume) {
  return Object.freeze({
    classification,
    reason_code: reasonCode,
    disposition,
    same_worker_retry_eligible: sameWorker,
    cross_worker_reroute_eligible: reroute,
    automatic_resume_eligible: automaticResume,
  });
}

const SINGLE_SIGNAL_RESULTS = Object.freeze({
  normal_completion: result(TERMINATION_CLASSIFICATIONS.CONTINUE, TERMINATION_REASONS.NORMAL_COMPLETION_OPEN_TASK, TERMINATION_DISPOSITIONS.CONTINUE_NEXT_PHASE, false, false, false),
  interrupted: result(TERMINATION_CLASSIFICATIONS.RESUMABLE, TERMINATION_REASONS.SESSION_INTERRUPTED, TERMINATION_DISPOSITIONS.RESUME_FROM_CHECKPOINT, false, false, true),
  session_timeout: result(TERMINATION_CLASSIFICATIONS.RESUMABLE, TERMINATION_REASONS.SESSION_TIMEOUT, TERMINATION_DISPOSITIONS.RESUME_FROM_CHECKPOINT, true, false, true),
  runtime_timeout: result(TERMINATION_CLASSIFICATIONS.RESUMABLE, TERMINATION_REASONS.RUNTIME_TIMEOUT, TERMINATION_DISPOSITIONS.RESUME_FROM_CHECKPOINT, true, false, true),
  context_exhausted: result(TERMINATION_CLASSIFICATIONS.RESUMABLE, TERMINATION_REASONS.CONTEXT_EXHAUSTED, TERMINATION_DISPOSITIONS.RESUME_FROM_CHECKPOINT, true, false, true),
  transient_provider_error: result(TERMINATION_CLASSIFICATIONS.RETRY_CANDIDATE, TERMINATION_REASONS.TRANSIENT_PROVIDER_ERROR, TERMINATION_DISPOSITIONS.CONSIDER_SAME_WORKER_RETRY, true, false, false),
  model_stall: result(TERMINATION_CLASSIFICATIONS.RETRY_CANDIDATE, TERMINATION_REASONS.MODEL_STALL, TERMINATION_DISPOSITIONS.CONSIDER_SAME_WORKER_RETRY, true, false, false),
  tool_runtime_failure: result(TERMINATION_CLASSIFICATIONS.RECOVERY_CANDIDATE, TERMINATION_REASONS.TOOL_RUNTIME_FAILURE, TERMINATION_DISPOSITIONS.CONSIDER_RETRY_OR_REROUTE, true, true, false),
  terminal_task_failure: result(TERMINATION_CLASSIFICATIONS.TERMINAL, TERMINATION_REASONS.TERMINAL_TASK_FAILURE, TERMINATION_DISPOSITIONS.ESCALATE_FAILED, false, false, false),
});

/** Pure ASR-2 classification only. It never performs the returned disposition. */
export function classifySessionTermination({ checkpoint, termination_evidence } = {}) {
  const state = validateTaskCheckpoint(checkpoint);
  const signals = normalizeEvidence(termination_evidence);

  if (state.task.status === "completed") return result(TERMINATION_CLASSIFICATIONS.TERMINAL, TERMINATION_REASONS.TASK_COMPLETED, TERMINATION_DISPOSITIONS.STOP, false, false, false);
  if (state.task.status === "cancelled") return result(TERMINATION_CLASSIFICATIONS.TERMINAL, TERMINATION_REASONS.TASK_CANCELLED, TERMINATION_DISPOSITIONS.STOP, false, false, false);

  if (state.constraints.approval.status === "pending") return result(TERMINATION_CLASSIFICATIONS.HUMAN_REQUIRED, TERMINATION_REASONS.APPROVAL_PENDING, TERMINATION_DISPOSITIONS.HUMAN_REQUIRED, false, false, false);
  if (state.constraints.approval.status === "rejected") return result(TERMINATION_CLASSIFICATIONS.HUMAN_REQUIRED, TERMINATION_REASONS.APPROVAL_REJECTED, TERMINATION_DISPOSITIONS.HUMAN_REQUIRED, false, false, false);
  if (signals.includes("safety_block")) return result(TERMINATION_CLASSIFICATIONS.HUMAN_REQUIRED, TERMINATION_REASONS.SAFETY_BLOCK, TERMINATION_DISPOSITIONS.HUMAN_REQUIRED, false, false, false);

  if (signals.length !== 1) return result(TERMINATION_CLASSIFICATIONS.REVIEW_REQUIRED, TERMINATION_REASONS.CONTRADICTORY_EVIDENCE, TERMINATION_DISPOSITIONS.REVIEW_REQUIRED, false, false, false);
  if (signals[0] === "unknown") return result(TERMINATION_CLASSIFICATIONS.REVIEW_REQUIRED, TERMINATION_REASONS.UNKNOWN_EVIDENCE, TERMINATION_DISPOSITIONS.REVIEW_REQUIRED, false, false, false);
  return SINGLE_SIGNAL_RESULTS[signals[0]];
}
