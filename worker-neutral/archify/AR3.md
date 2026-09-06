# AR3 — Artifact Production Contract v0

AR3 does not add code. It formalizes, as a machine-readable contract
(`artifact-production-contract.v0.json`), the state machine that AR1's
wrapper (`scripts/archify-safe.mjs`) already implements, and records what
AR2 actually observed (`ar2-smoke-evidence.v0.json`). AR3 is worker-neutral
by construction: it defines states and required evidence fields, not any
worker-specific execution path.

## Production state machine (compact)

| Stage | Gate | Fails closed on | Evidence produced |
|---|---|---|---|
| Runtime gate (A) | exact pin, owner-installed, doctor verified | unavailable / version mismatch / unverified identity | `archify.identityStatus`, `archify.detectedVersion` |
| Input evidence (B) | spec is hashed, not embedded | — | `spec.sha256`, `spec.bytes` |
| Output confinement (C) | `.html` only, inside dedicated artifact root, safe relative name, same-dir candidate | absolute name, `..`, symlink escape, non-html, unsafe final target | `finalRelativePath` |
| Promotion gate (D) | child exit 0 + candidate is regular/non-symlink/non-empty/basic-HTML | any of the above unmet | atomic rename only, no unlink-first |
| Receipt (E) | all required fields present | — | full receipt object |
| Claim semantics (F) | deliver success ≠ schema/browser/perceptual/human validation | inferred upgrade of a claim | `claims.*` stay at their evidenced value |
| Portability (G) | per-lane `{pass\|hold\|fail}`, holds ≠ failures | weakening a safety boundary to force PASS | lane status map |

A delivery either completes the whole chain and is promoted, or it fails
at some gate and the previous last-known-good final output is left
untouched. There is no partial/degraded success state.

## AR2 observed outcome

AR2 is now PASS: all three lanes (Claude, Codex, Pi) have real
safe-deliver evidence through the one shared wrapper. It was originally
`closed_with_holds` (Pi held on `harness_capability`); that hold is now
resolved history, not a live gap. See `ar2-smoke-evidence.v0.json` for the
exact recorded evidence:

- **Claude**: `pass` — real `deliver` against the upstream example spec
  (`archify/examples/web-app.architecture.json`), promoted to
  `.artifacts/archify/claude.html` under `/tmp/archify-ar2-claude`, full
  receipt captured (hashes, exit code, `validation.basicArtifact=passed`).
  Write confinement was observed to stay under the target's
  `.artifacts/archify`.
- **Pi**: `pass` (prior `hold` / `harness_capability`, now resolved) —
  historically, Pi's LPB `mutationScope` was exact-file-Set membership
  only (no directory-prefix/glob), and with `mutationScope` active shell
  tools were categorically blocked
  (`LPB_MUTATION_SCOPE_UNSUPPORTED_TOOL`) while read mode exposed no
  shell/execution tool at all, so a transactional CLI writer with an
  unpredictable same-directory candidate filename could not be expressed.
  That hold was resolved by a generic LPB runtime-profile plus a safe
  managed Bash/transaction capability, together with the exact-file
  missing-parent transaction verifier fix — no Pi-specific or
  Archify-specific bypass, and no broader unscoped shell approval. Pi then
  ran the exact single wrapper command
  `node scripts/archify-safe.mjs deliver --cwd . --runtime /lpb-runtime/archify/bin/archify.mjs --type architecture --spec /lpb-runtime/archify/examples/web-app.architecture.json --name pi.html`;
  the LPB transaction terminated
  `{ ok: true, status: "promoted", appliedPaths: [".artifacts", ".artifacts/archify", ".artifacts/archify/pi.html"] }`,
  gitSafety's final pass had `newDirtyPaths` of only
  `.artifacts/archify/pi.html` and `unexpectedPaths` empty, and the
  receipt records wrapper/profile/receipt version `1.0.0`, the verified
  `v2.16.0` runtime identity (detected `2.16.0`), child exit code `0`,
  matching spec/artifact hashes and byte counts, and
  `validation.basicArtifact=passed`. Independent read-only verification
  confirmed the same hash/bytes, a regular non-symlink file, and only the
  untracked file `.artifacts/archify/pi.html`.
- **Codex**: `pass` — real `deliver` against the same upstream example
  spec, promoted to `.artifacts/archify/codex.html` under
  `/tmp/archify-ar2-codex`. The receipt records wrapper/profile/receipt
  version `1.0.0`, the verified `v2.16.0` runtime identity, child exit code
  `0`, and `validation.basicArtifact=passed`. Independent `sha256` and
  `wc` checks matched the receipt, the target tree contained only the final
  artifact, and the repository was clean before these evidence edits.

Net: all three lanes (Claude, Codex, Pi) now have independently
verifiable artifact deliveries through the one shared wrapper, so
three-worker portability of the wrapper and the `v2.16.0` runtime pin is
established. Runtime/browser, perceptual, and human claims remain
`not_performed` / `not_separately_verified` and are not upgraded by this.

## Capability gap — resolved (history)

The original Pi hold pointed at a real, general gap: LPB had no
worker-neutral way to safely admit a transactional command-line writer
that produces an unpredictable same-directory candidate path under
directory-scoped (as opposed to exact-file-Set) mutation control. That
gap was closed at the LPB capability-model level — a generic LPB
runtime-profile plus a safe managed Bash/transaction capability, together
with the exact-file missing-parent transaction verifier fix — evaluated
on its own merits for any tool that needs it, not just Archify. No
Archify-specific or Pi-specific bypass or extension was introduced, and
the gap was never treated as an AR3 blocker.
