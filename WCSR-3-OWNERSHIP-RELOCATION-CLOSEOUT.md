# WCSR-3 Ownership Relocation Closeout

Status: **CLOSED / PASS**  
Date: 2026-09-16

## Result

The control-plane ownership boundary is now explicit at both ends:

- WNS owns worker-neutral contracts and pure deterministic semantic policy.
- Host owns executable mechanical supervision, Bridge adapters, transport,
  endpoint resolution, observation decoding, durable checkpoint mechanics,
  reconciliation, and service lifecycle.
- Each Bridge owns its provider-native transport and native control mappings.
- Permission, authority, and repository-safety policy remain with their
  existing authoritative owners; they were not moved into prompts or Bridges.

Host already contained the current adapter registry and provider-neutral
observer, so relocation required no risky runtime copy. The older WNS runtime
copy is explicitly classified as historical qualification material pending its
ordered WCSR-5 removal. Host's pinned WNS policy projection remains the sole
intentional code projection and retains its digest/provenance verification.

## Why this matches the new model

The split prevents native worker controls from becoming Supervisor policy and
prevents WNS from acting as a second Host. Exceptional steer/interrupt remains
available at the Bridge while routine autonomous execution uses Host's minimal
start/observe/result path.

## Verification

- WCSR-2 caller/dependency classification reviewed against current source.
- WNS and Host ownership notices agree on the same one-owner boundary.
- No executable, schema, public tool, authority rule, or recovery behavior
  changed in WCSR-3.
- `git diff --check` passes in both repositories.

Remaining ordered work: WCSR-4 removes strong-intervention behavior from the
normal policy story; WCSR-5 removes the resulting dead compatibility surface.
