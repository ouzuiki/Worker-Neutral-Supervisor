# AP-1: Durable Authority Provenance v1

Status: gate AP-1, contract v1, policy-only (no Host mechanical runtime in this change).

## Problem

A fresh session (new chat, new worker, restarted Host) has no access to the
original chat transcript that carried a Human's authorization. Without a
durable record, a Supervisor evaluating that fresh session can only see that
"no authorization text is present" and must default to `human_required`, even
when a still-valid authorization already exists. This contract makes
authority a durable, structured record instead of a fact derived from chat
visibility.

## Ownership boundary

- **Worker-Neutral-Supervisor (this repo) owns meaning**: the record schema,
  and the deterministic evaluator that decides `authorized` vs
  `human_required` and why.
- **Supervisor Host (future, separate repo) owns mechanics only**: it will
  persist `AuthorityRecord` objects, structurally validate them against this
  schema, fence writes (e.g. reject records with a stale `authority_epoch`),
  and project them to workers. The Host does not *derive* authority
  semantics — it never computes `authorized` vs `human_required` itself, and
  it must call the WNS-owned evaluator/projection helper for that decision.
  The Host *may* mechanically enforce and route on the exact WNS-produced
  `evaluation` result it receives back (e.g. `authorized` → attach the
  projection and proceed with continuation; `human_required` → stop and
  escalate, using the returned `reason_code`). That is mechanical dispatch on
  an already-computed decision, not semantic ownership: the Host never
  invents, overrides, or re-derives the decision itself.
- This contract is intentionally separate from the frozen `DurableCursor`-style
  continuation/checkpoint contracts (e.g. `contract.v0.json`'s
  `durable_task_continuation` block). Authority is not added to those
  in-place; it is its own versioned object referenced by ID.

## AuthorityRecord shape

```json
{
  "authority_version": 1,
  "authority_id": "authority:<opaque>",
  "task_id": "task-1",
  "durable_attempt_id": "attempt-1",
  "authority_epoch": 1,
  "scope": ["execute_gate", "spawn_worker"],
  "status": "active",
  "granted_at": "2026-09-11T00:00:00.000Z",
  "expires_at": null,
  "revoked_at": null,
  "provenance": {
    "receipt_ref": "receipt:chat-2026-09-11-abc",
    "granted_by": "human"
  }
}
```

Fields:

- `authority_version` — fixed `1` for this contract.
- `authority_id` — opaque durable identifier for the record.
- `task_id` / `durable_attempt_id` — the task and durable attempt this
  authority is bound to. A record only authorizes evaluation requests bound
  to the same pair.
- `authority_epoch` — a monotonic integer bumped whenever authority is
  re-granted for the same task/attempt (e.g. after a revoke-and-regrant). A
  request must state the epoch it requires; a record from an older epoch does
  not satisfy a request for a newer one, and vice versa.
- `scope` — array of scope tokens the record grants. Never empty.
- `status` — one of `active`, `revoked`, `expired`. This is a record-level
  hint; the evaluator independently re-checks `expires_at`/`revoked_at`
  against the evaluation time rather than trusting `status` alone.
- `granted_at`, `expires_at`, `revoked_at` — ISO-8601 timestamps or `null`.
- `provenance.receipt_ref` — a pointer to where the original grant is
  recorded (e.g. a receipt or transcript locator). This is a reference, not a
  copy: the evaluator never requires the referenced text to be present or
  re-supplied in the fresh session.
- `provenance.granted_by` — one of `human`, `policy`. Present for audit only;
  the evaluator does not condition its decision on this field.

## EvaluationRequest shape

```json
{
  "task_id": "task-1",
  "durable_attempt_id": "attempt-1",
  "required_authority_epoch": 1,
  "requested_scope": ["execute_gate"],
  "evaluated_at": "2026-09-11T00:05:00.000Z"
}
```

## Validation

Both objects are validated against their exact key set (missing or extra
keys reject). String fields must be trimmed and non-empty; `scope` and
`requested_scope` must be non-empty arrays of unique trimmed tokens;
`authority_epoch` and `required_authority_epoch` must be positive safe
integers; `granted_at` and `evaluated_at` are required canonical ISO-8601
timestamps (`Date#toISOString()` form), and `expires_at`/`revoked_at` are
either `null` or a canonical ISO-8601 timestamp.

## Core invariant

Absence of the original Human authorization *text* in the current session
MUST NOT, by itself, invalidate a still-valid `AuthorityRecord`. The evaluator
only ever inspects the structured record and the request; it never looks for
or requires chat transcript content.

## Decision and reason codes

`evaluateDurableAuthority(record, request)` returns `authorized` when, and
only when, all of the following hold; otherwise it returns `human_required`
with the first applicable reason code, checked in this order:

1. `authority_absent` — `record` is `null`/`undefined`.
2. `task_mismatch` — `record.task_id !== request.task_id`.
3. `attempt_mismatch` — `record.durable_attempt_id !== request.durable_attempt_id`.
4. `epoch_mismatch` — `record.authority_epoch !== request.required_authority_epoch`.
5. `authority_revoked` — `record.status === "revoked"` or `record.revoked_at` is non-null and `<= evaluated_at`.
6. `authority_expired` — `record.status === "expired"`, or `record.expires_at` is non-null and `<= evaluated_at`.
7. `scope_exceeded` — `request.requested_scope` contains any token not present in `record.scope`.

There is no separate "invalid status" code: `status` is constrained to
`active | revoked | expired` at the schema level, and the two non-active
values are exactly the `authority_revoked` and `authority_expired` cases
above, so every reachable status is already covered.

If none apply, the result is `authorized` with reason code `authority_valid`.

The evaluator is a pure function: same inputs always produce the same
output, it does not mutate its arguments, and it has no I/O.

## `createAuthorityProjection(record, request)`

`createAuthorityProjection` is the single WNS-owned entry point a mechanical
Host may call to obtain the authoritative policy result for a fresh-session
continuation. It validates both inputs (throwing on any structural
violation, exactly as `evaluateDurableAuthority` does), evaluates them, and
returns a deep-frozen, copy-safe object with exactly these keys:

```json
{
  "projection_version": 1,
  "record": { "...": "validated AuthorityRecord, or null" },
  "request": { "...": "validated EvaluationRequest" },
  "evaluation": { "decision": "authorized|human_required", "reason_code": "..." }
}
```

There is no transcript field anywhere in this shape, and none may be added:
the whole point of the projection is that it is sufficient on its own,
without the original chat text. `record` and `request` are the *exact*
validated values (deep copies, not aliases of the caller's inputs), so a
Host or downstream consumer cannot observe or induce mutation through this
object. A Host may forward this projection verbatim to a fresh
worker/session; it must not synthesize an equivalent object itself, and it
must not alter `evaluation` — the decision is computed by WNS policy code
only.

`validateAuthorityRecord(record)` and `validateEvaluationRequest(request)`
are also exported as standalone structural validators (each returning a
deep-frozen copy, or `null` for a `null` record) for callers that need to
validate a record or request independently of a full evaluation.

## Minimal scope token

This gate defines exactly one generic, worker-neutral scope token,
`RESUME_TASK_SCOPE` (`"resume_task"`), for binding evaluation to the
recovery/continuation action. No broader permission taxonomy is introduced
here; additional scope tokens are out of scope for AP-1 and must be added
deliberately, with their own contract update, if a future gate needs them.
