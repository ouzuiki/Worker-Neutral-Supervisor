import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { DEFAULT_WATCHDOG_CONFIG } from "./reasoning-watchdog.mjs";
import {
  createLivenessState,
  markSoftSteerIssued,
  observeLiveness,
} from "./liveness-state.mjs";

test("Liveness v0 artifact pins the unchanged watchdog baseline", () => {
  const contract = JSON.parse(
    readFileSync(new URL("../worker-neutral/liveness/contract.v0.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(contract.baseline.thresholds, DEFAULT_WATCHDOG_CONFIG);
  assert.equal(contract.baseline.ordering, "soft_steer_before_interrupt");
  assert.equal(contract.baseline.blocked_behavior, "await_blocked_resolution");
});

function progress(semantic_state, overrides = {}) {
  return {
    semantic_state,
    last_productive_at: "2026-09-07T00:00:00.000Z",
    last_productive_cursor: 1,
    thinking_tokens_since_productive: 0,
    ...overrides,
  };
}

test("initial execution has epoch zero and a clean episode", () => {
  const state = createLivenessState();
  assert.deepEqual(state, {
    progress_epoch: 0,
    last_productive_marker: null,
    last_semantic_state: null,
    episode: { soft_steer_issued: false },
  });
  assert.ok(Object.isFrozen(state));
  assert.ok(Object.isFrozen(state.episode));
});

test("each distinct productive marker advances the epoch and resets episode state", () => {
  const first = observeLiveness(createLivenessState(), progress("productive"));
  const steered = markSoftSteerIssued(first);
  const second = observeLiveness(
    steered,
    progress("productive", {
      last_productive_at: "2026-09-07T00:00:01.000Z",
      last_productive_cursor: 2,
    }),
  );
  assert.equal(first.progress_epoch, 1);
  assert.equal(steered.episode.soft_steer_issued, true);
  assert.equal(second.progress_epoch, 2);
  assert.equal(second.episode.soft_steer_issued, false);
});

test("repeated reasoning in one epoch does not advance or reset it", () => {
  const productive = observeLiveness(createLivenessState(), progress("productive"));
  const steered = markSoftSteerIssued(productive);
  const reasoning = progress("reasoning_only", { thinking_tokens_since_productive: 5_000 });
  const once = observeLiveness(steered, reasoning);
  const twice = observeLiveness(once, reasoning);
  assert.equal(twice.progress_epoch, 1);
  assert.equal(twice.episode.soft_steer_issued, true);
});

test("soft steer marker belongs only to its current progress epoch", () => {
  const epochOne = observeLiveness(createLivenessState(), progress("productive"));
  const steered = markSoftSteerIssued(epochOne);
  const epochTwo = observeLiveness(
    steered,
    progress("productive", { last_productive_cursor: 2 }),
  );
  assert.equal(steered.progress_epoch, 1);
  assert.equal(steered.episode.soft_steer_issued, true);
  assert.equal(epochTwo.progress_epoch, 2);
  assert.equal(epochTwo.episode.soft_steer_issued, false);
});

test("blocked observations never create a progress epoch", () => {
  const initial = createLivenessState();
  const blocked = observeLiveness(
    initial,
    progress("blocked", { last_productive_cursor: 99, thinking_tokens_since_productive: 99_999 }),
  );
  assert.equal(blocked.progress_epoch, 0);
  assert.equal(blocked.episode.soft_steer_issued, false);
});

test("productive transition without a marker advances only once", () => {
  const markerless = progress("productive", {
    last_productive_at: null,
    last_productive_cursor: null,
  });
  const first = observeLiveness(createLivenessState(), markerless);
  const repeated = observeLiveness(first, markerless);
  assert.equal(first.progress_epoch, 1);
  assert.equal(repeated.progress_epoch, 1);
});
