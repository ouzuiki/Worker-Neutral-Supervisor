// Tri-worker Deterministic Liveness Gate (WL8).
//
// Proves that Codex, Claude, and Pi receive equivalent liveness/recovery
// judgments when fed equivalent common (normalized) observations. This is a
// pure, offline conformance check: it delegates every threshold/routing
// decision to the existing common-contract modules (WL2 verdict, WL3 recovery,
// and the existing `selectWorker` reroute delegate) and never invokes a Bridge
// runtime, network, shell, or worker-specific adapter.
//
// Worker identity legitimately enters exactly one place: when WL3 recommends a
// reroute, the existing routing policy is asked once per worker with that
// worker marked failed, so the fixture can prove the failed worker is excluded
// and that fallback does not depend on any Bridge-native event shape.

import { evaluateLivenessVerdict } from "./liveness-verdict.mjs";
import {
  DEFAULT_RECOVERY_CONFIG,
  RECOVERY_ACTIONS,
  createRecoveryState,
  evaluateRecoveryPolicy,
} from "./liveness-recovery.mjs";
import { selectWorker } from "./policy.mjs";

export const TRI_GATE_WORKERS = Object.freeze(["codex", "claude", "pi"]);
export const TRI_GATE_ID = "WL8_tri_worker_deterministic";

function stripNonCommon(observation) {
  // The gate consumes only common-contract fields. Bridge-native envelope keys
  // (native_events, raw prompt/path/error payloads, transport metadata) are
  // dropped here so the fixture cannot smuggle worker-specific shape into the
  // judgment. Required common inputs are fail-closed: the gate never invents a
  // liveness state or semantic progress on the caller's behalf, because a
  // silently-defaulted state would make the equivalence claim vacuous.
  if (observation === null || typeof observation !== "object" || Array.isArray(observation)) {
    throw new TypeError("observation must be a common normalized observation object");
  }
  if (
    observation.liveness_state === null ||
    typeof observation.liveness_state !== "object" ||
    Array.isArray(observation.liveness_state)
  ) {
    throw new TypeError("observation.liveness_state is required (use createLivenessState())");
  }
  if (
    observation.semantic_progress === null ||
    typeof observation.semantic_progress !== "object" ||
    Array.isArray(observation.semantic_progress)
  ) {
    throw new TypeError("observation.semantic_progress is required");
  }
  return Object.freeze({
    liveness_state: observation.liveness_state,
    semantic_progress: observation.semantic_progress,
    elapsed_since_productive_ms: observation.elapsed_since_productive_ms ?? 0,
  });
}

function equalAcross(values) {
  return values.every((value) => value === values[0]);
}

/**
 * @param {object} input
 * @param {object} input.observation common normalized observation shared by all
 *   three workers: { liveness_state?, semantic_progress, elapsed_since_productive_ms? }
 * @param {object} [input.watchdog_config] optional budget overrides forwarded to WL2
 * @param {object} [input.recovery_state] shared WL3 recovery state (default: fresh)
 * @param {object} [input.recovery_evidence] shared WL3 evidence projection
 * @param {object} [input.recovery_config] shared WL3 config (no new thresholds)
 * @param {object} [input.reroute_task] task shape passed to `selectWorker` when
 *   WL3 recommends a reroute; only its common capability requirements matter
 * @param {object} [input.reroute_worker_state] non-failure worker state passed
 *   to `selectWorker` (failed worker is injected per-iteration)
 * @returns {object} bounded deterministic gate result
 */
export function evaluateTriWorkerLivenessGate({
  observation,
  watchdog_config,
  recovery_state,
  recovery_evidence = {},
  recovery_config = DEFAULT_RECOVERY_CONFIG,
  reroute_task = {},
  reroute_worker_state = {},
} = {}) {
  const common = stripNonCommon(observation);
  const sharedRecoveryState = recovery_state ?? createRecoveryState(0);

  const perWorker = TRI_GATE_WORKERS.map(() => {
    const verdict = evaluateLivenessVerdict({
      liveness_state: common.liveness_state,
      semantic_progress: common.semantic_progress,
      elapsed_since_productive_ms: common.elapsed_since_productive_ms,
      ...(watchdog_config === undefined ? {} : { config: watchdog_config }),
    });
    const recovery = evaluateRecoveryPolicy({
      liveness_verdict: verdict,
      recovery_state: sharedRecoveryState,
      evidence: recovery_evidence,
      config: recovery_config,
    });
    return { verdict, recovery };
  });

  const liveness = perWorker.map((entry) => entry.verdict.liveness);
  const progressEpoch = perWorker.map((entry) => entry.verdict.progress_epoch);
  const recoveryAction = perWorker.map((entry) => entry.recovery.recommended_action);
  const recoveryReason = perWorker.map((entry) => entry.recovery.reason);
  const recoveryAttempts = perWorker.map((entry) => entry.recovery.recovery_state.recovery_attempts);

  const commonJudgmentEquivalent =
    equalAcross(liveness) &&
    equalAcross(progressEpoch) &&
    equalAcross(recoveryAction) &&
    equalAcross(recoveryReason) &&
    equalAcross(recoveryAttempts);

  let reroute = null;
  if (recoveryAction[0] === RECOVERY_ACTIONS.REROUTE) {
    reroute = {};
    for (const worker of TRI_GATE_WORKERS) {
      const failed = Array.isArray(reroute_worker_state.failed_workers)
        ? reroute_worker_state.failed_workers
        : [];
      const selection = selectWorker({
        task: reroute_task,
        state: { ...reroute_worker_state, failed_workers: [...new Set([...failed, worker])] },
      });
      reroute[worker] = Object.freeze({
        excluded: worker,
        action: selection.action,
        worker: selection.worker,
        fallback_chain: Object.freeze([...selection.fallback_chain]),
        failed_worker_absent:
          selection.worker !== worker && !selection.fallback_chain.includes(worker),
      });
    }
    reroute = Object.freeze(reroute);
  }

  const rerouteFailedWorkerAlwaysExcluded =
    reroute === null || TRI_GATE_WORKERS.every((worker) => reroute[worker].failed_worker_absent);

  return Object.freeze({
    gate: TRI_GATE_ID,
    workers: TRI_GATE_WORKERS,
    equivalent: commonJudgmentEquivalent && rerouteFailedWorkerAlwaysExcluded,
    common_judgment_equivalent: commonJudgmentEquivalent,
    liveness: liveness[0],
    progress_epoch: progressEpoch[0],
    recovery_attempts_spent: recoveryAttempts[0],
    recovery_action: recoveryAction[0],
    recovery_reason: recoveryReason[0],
    reroute,
    reroute_failed_worker_excluded: rerouteFailedWorkerAlwaysExcluded,
  });
}
