// Supervisor-owned per-execution liveness state (Liveness v0 / WL1).
//
// Pure reducer over the existing semantic_progress contract. Productive progress
// advances the epoch once per distinct productive marker and resets state local
// to the prior stall episode. Reasoning and blocked observations never advance it.

import {
  WATCHDOG_SEMANTIC_STATES,
  normalizeSemanticProgress,
} from "./reasoning-watchdog.mjs";

function episodeState(softSteerIssued = false) {
  return Object.freeze({ soft_steer_issued: softSteerIssued });
}

function freezeState({ progress_epoch, last_productive_marker, last_semantic_state, episode }) {
  return Object.freeze({
    progress_epoch,
    last_productive_marker:
      last_productive_marker === null
        ? null
        : Object.freeze({ ...last_productive_marker }),
    last_semantic_state,
    episode,
  });
}

export function createLivenessState() {
  return freezeState({
    progress_epoch: 0,
    last_productive_marker: null,
    last_semantic_state: null,
    episode: episodeState(),
  });
}

function requireState(state) {
  if (state === null || typeof state !== "object" || Array.isArray(state)) {
    throw new TypeError("state must be a liveness state object");
  }
  if (!Number.isInteger(state.progress_epoch) || state.progress_epoch < 0) {
    throw new TypeError("state.progress_epoch must be a non-negative integer");
  }
  if (state.episode === null || typeof state.episode !== "object") {
    throw new TypeError("state.episode must be an object");
  }
  if (typeof state.episode.soft_steer_issued !== "boolean") {
    throw new TypeError("state.episode.soft_steer_issued must be a boolean");
  }
  return state;
}

function productiveMarker(progress) {
  return Object.freeze({
    last_productive_at: progress.last_productive_at,
    last_productive_cursor: progress.last_productive_cursor,
  });
}

function sameMarker(left, right) {
  return (
    left !== null &&
    left.last_productive_at === right.last_productive_at &&
    left.last_productive_cursor === right.last_productive_cursor
  );
}

export function observeLiveness(state, semantic_progress) {
  const current = requireState(state);
  const progress = normalizeSemanticProgress(semantic_progress);
  const isProductive = progress.semantic_state === WATCHDOG_SEMANTIC_STATES.PRODUCTIVE;
  const marker = isProductive ? productiveMarker(progress) : current.last_productive_marker;
  const markerAvailable =
    isProductive &&
    (marker.last_productive_at !== null || marker.last_productive_cursor !== null);
  const beginsEpoch =
    isProductive &&
    (markerAvailable
      ? !sameMarker(current.last_productive_marker, marker)
      : current.last_semantic_state !== WATCHDOG_SEMANTIC_STATES.PRODUCTIVE);

  return freezeState({
    progress_epoch: current.progress_epoch + (beginsEpoch ? 1 : 0),
    last_productive_marker: marker,
    last_semantic_state: progress.semantic_state,
    episode: beginsEpoch ? episodeState() : current.episode,
  });
}

export function markSoftSteerIssued(state) {
  const current = requireState(state);
  return freezeState({
    ...current,
    episode: episodeState(true),
  });
}
