# Authorized Host Effect Contract v1 (HC1-M1)

Status: frozen implementation contract for HC1-M1 through HC1-M3. It does not
authorize production cutover.

WNS/Supervisor owns the semantic decision to authorize an effect. It does so
with the existing durable `AuthorityRecord`: the record's `scope` contains the
`host_effect:sha256:<digest>` token produced by
`createAuthorizedHostEffectScope(request)`. The digest binds the complete exact
request, including effect identity, task/attempt/epoch, capability kind,
logical resource reference, and input. No second grant or approval format is
introduced, and a Worker cannot add scope to the durable authority record.

An exact v1 request is:

```json
{
  "effect_request_version": 1,
  "effect_id": "write-proof-1",
  "task_id": "task-1",
  "durable_attempt_id": "attempt-1",
  "required_authority_epoch": 3,
  "kind": "state.write",
  "resource_ref": "state:proof",
  "input": { "content": "approved" }
}
```

`resource_ref` is a logical `namespace:name`, never a path, PID, service unit,
endpoint, executable, provider, or model. The Host maps an exact authorized
`(kind, resource_ref)` pair to a deployment-owned bounded handler. `input` is a
bounded JSON object; the Host handler applies its narrower input contract.

An exact v1 result contains `effect_id`, `status`, `reason_code`, durable
`receipt` (`{ref,digest}` or null), logical `evidence_ref` or null, and a
`reconciled` boolean. Status semantics are:

- `SUCCEEDED`: the effect is durably known to have succeeded and has a receipt.
- `FAILED`: this invocation is known not to have dispatched a new effect, or a
  dispatched handler returned known non-application. This includes failures
  before acceptance, such as absent/stale authority or an invalid/unconfigured
  logical resource.
- `OUTCOME_UNKNOWN`: the effect may have applied. Callers must reconcile the
  same request/effect identity and must not issue a new effect identity or
  blindly replay the operation.

The Host must reserve the deterministic receipt in the existing checkpoint
cursor before dispatch, persist a terminal receipt through checkpoint CAS, and
reconcile duplicate identities from that same state. LPB may only adapt and
transport the exact request/result. LPB does not authorize, route semantically,
resolve logical resources, dispatch, execute, or persist effect receipts.
