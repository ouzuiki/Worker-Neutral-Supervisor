# PI v2 Production Pass Closeout

**Gate ID:** PI_V2_PRODUCTION_PASS
**Status:** PASS / CLOSED
**Date:** 2026-09-12
**Owner:** Supervisor / WNS

Host does not own acceptance semantics for this gate. Acceptance is Supervisor/WNS-owned end to end.

---

## 1 — SOURCE_BASELINE_PASS

**Status:** PASS

```text
repository   Local Pi Bridge
branch       pi-v2-clean-baseline
commit       c4a56ad7de50e406a3acbdad7c8429a4c5b74f95
```

Source tree is clean.

```text
node --test test/mcp-adapter.test.js   34 pass, 0 fail
npm test (full suite)                  592 pass, 1 pre-existing skip, 0 fail
git diff --check                       clean
```

---

## 2 — PRODUCTION_MODEL_ADMISSION_PASS

**Status:** PASS

Implementation:

```text
src/production-model-policy.js
mcp-adapter admission path
```

Production-approved pair is exactly one:

```text
provider = deepseek
model    = deepseek-v4-flash
```

Rules verified by deterministic regression tests:

- omitting both `provider` and `model` normalizes to the approved Flash pair;
- the exact approved pair is accepted;
- Pro, any other provider/model, or a partial provider-only / model-only combination is rejected fail-closed with `LPB_PRODUCTION_MODEL_REJECTED`;
- lower-level `PiSupervisor` / `PiRpcClient` remain provider/model-generic — admission is enforced only at the `pi_start` boundary;
- session-resume (`sessionPath`) goes through the same `pi_start` admission path, with no bypass.

---

## 3 — IMMUTABLE_DEPLOY_PASS

**Status:** PASS

```text
deployment   /home/ouzuiki/.local/share/local-pi-bridge/deployments/c4a56ad7de50e406a3acbdad7c8429a4c5b74f95-brpi-0f7fa452813c
HEAD         c4a56ad7de50e406a3acbdad7c8429a4c5b74f95 (exact)
tree hash    e258588eade202a2fd9dd727620f0f31b36e89cc (source and deploy identical)
```

`npm ci --offline` succeeded from vendored dependency cache; deployment is clean.

Filesystem is locked read-only:

```text
directories   0555
files         0444 / 0555
```

---

## 4 — LAUNCHER_CUTOVER_PASS

**Status:** PASS

```text
/home/ouzuiki/.local/bin/local-pi-bridge-run
```

Only the final exec target changed, now pointing at the c4a56ad immutable deployment above. `HOME`, `PATH`, `LPB_PI_CLI_PATH`, and `runtime.env` sourcing are unchanged. `bash -n` passes on the launcher.

---

## 5 — SERVICE_RELOAD_PASS

**Status:** PASS

Controlled reload:

```text
systemctl --user restart tunnel-client-local-pi-bridge.service
```

Observed at verification time:

```text
service               active
new MainPID           214962
mcp-server child PID  214976   (exact c4a56ad deployment path)
codex app-server PID  214984   (respawned)
```

These PIDs are evidence-at-observation only, not a durable identity contract.

---

## 6 — DIRECT_PRODUCTION_SMOKE_PASS

**Status:** PASS

The Outer Supervisor invoked `Local_Pi_Bridge.pi_start` against production after the service reload above. `pi_start` is invoked externally by the Supervisor; a Worker-internal message claiming it cannot invoke `pi_start` itself is not a contradiction.

**Explicit Flash smoke:**

```text
start      accepted
terminal   true
ok         true
repo root  /work
HEAD       c4a56ad7de50e406a3acbdad7c8429a4c5b74f95
tree       clean
package    local-pi-bridge 0.0.1
```

**Stronger default-model live smoke** (provider/model intentionally omitted from the call):

```text
event stream cursor 5      provider=deepseek, model=deepseek-v4-flash
message_end / turn_end     model=deepseek-v4-flash, responseModel=deepseek-flash
terminal                   true
ok                         true
HEAD                       c4a56ad7de50e406a3acbdad7c8429a4c5b74f95
package                    local-pi-bridge
```

This proves the former fail-open omitted-args path now normalizes to Flash in production.

No live Pro negative call was made — that is not claimed here. Pro rejection evidence is the deterministic regression tests in section 2 plus the deployed admission code; a live Pro call was neither required nor performed.

---

## Final decision

```text
PI_V2_PRODUCTION_PASS   PASS / CLOSED
```

### Downstream state

```text
HOST_V2_PI_V2_INTEGRATION_PASS   eligible, NOT PASS
SHD4_LIVE_GATE                   blocked until Host <-> Pi integration passes
```

No Host or SHD-4 semantics are changed by this closeout.
