const MAX_ENVELOPE_CHARS = 64_000;

export function createContinuationEnvelope(plan) {
  if (!plan?.planned || !["spawn_same_worker", "spawn_cross_worker"].includes(plan.action)) throw new TypeError("executable recovery plan is required");
  const envelope = {
    envelope_version: 1,
    task: { id: plan.task_id, next_action: plan.next_action, resume_cursor: plan.resume_cursor },
    recovery: { claim_key: plan.claim_key, action: plan.action, source_worker_id: plan.source_worker_id, source_native_session_id: plan.source_native_session_id },
    workspace: plan.workspace,
    gates: plan.gates,
    constraints: plan.constraints,
    evidence_refs: plan.evidence_refs,
    receipt_refs: plan.receipt_refs,
    handoff_refs: plan.handoff_refs,
    semantic_progress: plan.semantic_progress,
    instructions: ["Continue only from task.next_action.", "Do not replay gates listed in gates.completed.", "Treat referenced evidence as locators, not copied authority.", "Stop for unresolved approval, safety block, or ambiguous mutation/effect state."],
  };
  const serialized = JSON.stringify(envelope);
  if (serialized.length > MAX_ENVELOPE_CHARS) throw new TypeError("minimum continuation envelope exceeds bound");
  return Object.freeze({ envelope, text: `SUPERVISOR_CONTINUATION_V1\n${serialized}` });
}
