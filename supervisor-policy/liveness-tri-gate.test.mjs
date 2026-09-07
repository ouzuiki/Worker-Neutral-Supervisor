import assert from "node:assert/strict";
import test from "node:test";

import {
  TRI_GATE_ID,
  TRI_GATE_WORKERS,
  evaluateTriWorkerLivenessGate,
} from "./liveness-tri-gate.mjs";
import { createLivenessState, markSoftSteerIssued } from "./liveness-state.mjs";
import {
  RECOVERY_ACTIONS,
  createRecoveryState,
  markRecoveryInterruptIssued,
  recordRecoveryAttempt,
} from "./liveness-recovery.mjs";

const progress = (semantic_state, overrides = {}) => ({
  semantic_state,
  last_productive_at: null,
  last_productive_cursor: null,
  thinking_tokens_since_productive: 0,
  ...overrides,
});

// A fully-resolved reconciliation projection so the stall_confirmed path can
// reach the reroute delegate deterministically.
const resolvedEvidence = Object.freeze({
  mutation_ack: "accepted",
  native_state: "terminal",
  interrupt_outcome: "known",
  reconciliation: "safe_to_restart",
  reroute_available: true,
});

const confirmedStallObservation = Object.freeze({
  liveness_state: markSoftSteerIssued(createLivenessState()),
  semantic_progress: progress("reasoning_only", { thinking_tokens_since_productive: 8000 }),
  elapsed_since_productive_ms: 95000,
});

test("healthy productive observation yields one equivalent judgment across codex/claude/pi", () => {
  const result = evaluateTriWorkerLivenessGate({
    observation: {
      liveness_state: createLivenessState(),
      semantic_progress: progress("productive"),
      elapsed_since_productive_ms: 0,
    },
  });
  assert.equal(result.gate, TRI_GATE_ID);
  assert.deepEqual(result.workers, ["codex", "claude", "pi"]);
  assert.equal(result.equivalent, true);
  assert.equal(result.common_judgment_equivalent, true);
  assert.equal(result.liveness, "healthy");
  assert.equal(result.recovery_action, RECOVERY_ACTIONS.CONTINUE_OBSERVING);
  assert.equal(result.progress_epoch, 1);
  assert.equal(result.reroute, null);
});

test("INV2: blocked is never a stall and never triggers retry/reroute for any worker", () => {
  const result = evaluateTriWorkerLivenessGate({
    observation: {
      liveness_state: createLivenessState(),
      semantic_progress: progress("blocked"),
      elapsed_since_productive_ms: 600000,
    },
  });
  assert.equal(result.liveness, "blocked");
  assert.equal(result.recovery_action, RECOVERY_ACTIONS.AWAIT_BLOCKED_RESOLUTION);
  assert.equal(result.reroute, null);
  assert.notEqual(result.recovery_action, RECOVERY_ACTIONS.RETRY_FRESH_RUN);
  assert.notEqual(result.recovery_action, RECOVERY_ACTIONS.REROUTE);
  assert.equal(result.equivalent, true);
});

test("INV3: UNKNOWN mutation acknowledgement stays reconcile-before-retry/reroute", () => {
  const result = evaluateTriWorkerLivenessGate({
    observation: confirmedStallObservation,
    recovery_state: markRecoveryInterruptIssued(recordRecoveryAttempt(createRecoveryState(0))),
    recovery_evidence: { ...resolvedEvidence, mutation_ack: "unknown" },
  });
  assert.equal(result.liveness, "stall_confirmed");
  assert.equal(result.recovery_action, RECOVERY_ACTIONS.RECONCILE);
  assert.equal(result.recovery_reason, "mutation_ack_unknown");
  assert.equal(result.reroute, null);
  assert.equal(result.equivalent, true);
});

test("INV4: a productive epoch reset clears the same-epoch recovery budget once", () => {
  // Old recovery state carries a spent attempt in epoch 0; the productive
  // observation advances the WL1 epoch to 1, so WL3 rebases the budget and the
  // spent attempt is dropped.
  const spent = markRecoveryInterruptIssued(recordRecoveryAttempt(createRecoveryState(0)));
  assert.equal(spent.recovery_attempts, 1);
  const result = evaluateTriWorkerLivenessGate({
    observation: {
      liveness_state: createLivenessState(),
      semantic_progress: progress("productive"),
    },
    recovery_state: spent,
  });
  assert.equal(result.progress_epoch, 1);
  assert.equal(result.recovery_attempts_spent, 0);
  assert.equal(result.recovery_action, RECOVERY_ACTIONS.CONTINUE_OBSERVING);
});

test("INV4: a merely healthy observation within the same epoch does not recharge the budget", () => {
  // last_semantic_state is already productive and the marker is unchanged, so
  // observeLiveness keeps epoch 0 and the spent attempt must survive.
  const sameEpochProductive = {
    progress_epoch: 0,
    last_productive_marker: null,
    last_semantic_state: "productive",
    episode: { soft_steer_issued: false },
  };
  const spent = markRecoveryInterruptIssued(recordRecoveryAttempt(createRecoveryState(0)));
  const result = evaluateTriWorkerLivenessGate({
    observation: {
      liveness_state: sameEpochProductive,
      semantic_progress: progress("productive"),
    },
    recovery_state: spent,
  });
  assert.equal(result.progress_epoch, 0);
  assert.equal(result.recovery_attempts_spent, 1);
  assert.equal(result.recovery_action, RECOVERY_ACTIONS.CONTINUE_OBSERVING);
});

test("INV7: required common inputs are fail-closed, never silently defaulted", () => {
  assert.throws(() => evaluateTriWorkerLivenessGate({}), /observation must be/);
  assert.throws(
    () => evaluateTriWorkerLivenessGate({ observation: { semantic_progress: progress("productive") } }),
    /liveness_state is required/,
  );
  assert.throws(
    () => evaluateTriWorkerLivenessGate({ observation: { liveness_state: createLivenessState() } }),
    /semantic_progress is required/,
  );
});

test("INV1: stall_suspected soft steer is identical across workers and does not reroute", () => {
  const result = evaluateTriWorkerLivenessGate({
    observation: {
      liveness_state: createLivenessState(),
      semantic_progress: progress("reasoning_only", { thinking_tokens_since_productive: 5000 }),
      elapsed_since_productive_ms: 50000,
    },
  });
  assert.equal(result.liveness, "stall_suspected");
  assert.equal(result.recovery_action, RECOVERY_ACTIONS.SOFT_STEER);
  assert.equal(result.reroute, null);
  assert.equal(result.equivalent, true);
});

test("INV5: confirmed stall with exhausted local retry delegates to selectWorker and excludes the failed worker", () => {
  const exhausted = markRecoveryInterruptIssued(recordRecoveryAttempt(createRecoveryState(0)));
  const result = evaluateTriWorkerLivenessGate({
    observation: confirmedStallObservation,
    recovery_state: exhausted,
    recovery_evidence: resolvedEvidence,
    reroute_task: {},
  });
  assert.equal(result.liveness, "stall_confirmed");
  assert.equal(result.recovery_action, RECOVERY_ACTIONS.REROUTE);
  assert.equal(result.recovery_reason, "recovery_budget_exhausted_delegate_routing");
  assert.equal(result.reroute_failed_worker_excluded, true);
  assert.equal(result.equivalent, true);
  for (const worker of TRI_GATE_WORKERS) {
    const decision = result.reroute[worker];
    assert.equal(decision.excluded, worker);
    assert.equal(decision.action, "select");
    assert.notEqual(decision.worker, worker);
    assert.equal(decision.fallback_chain.includes(worker), false);
    assert.equal(decision.failed_worker_absent, true);
  }
});

test("INV5: reroute fallback is driven only by common state, not Bridge-native event shape", () => {
  const exhausted = markRecoveryInterruptIssued(recordRecoveryAttempt(createRecoveryState(0)));
  const withNativeNoise = evaluateTriWorkerLivenessGate({
    observation: {
      ...confirmedStallObservation,
      native_events: [{ arbitrary: true }],
      raw_prompt: "should be ignored",
      transport: { socket: 7 },
    },
    recovery_state: exhausted,
    recovery_evidence: resolvedEvidence,
  });
  const clean = evaluateTriWorkerLivenessGate({
    observation: confirmedStallObservation,
    recovery_state: exhausted,
    recovery_evidence: resolvedEvidence,
  });
  assert.deepEqual(withNativeNoise, clean);
});

test("INV7: gate output is deterministic and bounded (enums, small enum arrays, one integer)", () => {
  const run = () =>
    evaluateTriWorkerLivenessGate({
      observation: confirmedStallObservation,
      recovery_state: markRecoveryInterruptIssued(recordRecoveryAttempt(createRecoveryState(0))),
      recovery_evidence: resolvedEvidence,
    });
  assert.deepEqual(run(), run());
  const serialized = JSON.stringify(run());
  assert.doesNotMatch(serialized, /\d{13}/); // no epoch-millis timestamps
  assert.ok(serialized.length < 800);
  assert.equal(Number.isInteger(run().progress_epoch), true);
});
