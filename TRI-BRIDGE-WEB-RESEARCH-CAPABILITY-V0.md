# Worker Web Research Capability WR0–WR3 v0

**Status:** PASS — WR0/WR1 contract semantics are implemented; WR2 capability registration and WR3 live tri-worker conformance evidence are recorded.
**Date:** 2026-09-07
**Owner:** Supervisor
**Depends on:** `TRI-BRIDGE-CONTRACT-V1.md` (Supervisor/Bridge/native boundary), `supervisor-policy/context-policy.mjs` (`CONTEXT_AUTHORITY`), `supervisor-policy/reasoning-watchdog-binding.mjs` (soft steer)
**Applies to:** Supervisor / worker-neutral policy and contract. Codex and Claude Code use their native web surfaces; LPB was adapted for Pi Web Research without widening transaction-sandbox networking. This repo does not own those worker-local runtime surfaces, is not a fourth runtime, imports no bridge, and executes no tool.

This document records WR0–WR3 for the Worker Web Research Capability program. The Supervisor-owned pieces live in the existing `supervisor-policy/` module plus the worker-neutral contract folder; no new service, bridge, package, or workflow step was created.

---

## WR0 — Audit: what already existed, what was verified, what was assumed

### Verified from repository source / current runtime at WR0 (not assumed)

- Before WR1/WR2 integration, this repo had **no web-research policy, contract, or capability key**. `supervisor-policy/worker-capabilities.json` was then schema version 2 and none of its per-worker capabilities concerned web access.
- `supervisor-policy/context-policy.mjs#CONTEXT_AUTHORITY` fixes the authority order used throughout: `security_hard_runtime` > `task_and_project_contract` > `verified_current_evidence` > `skill_procedure` > `advisory_memory` > `historical_raw_context`. Any web-research contract must sit *below* the top two and must not let external content override them.
- `supervisor-policy/reasoning-watchdog.mjs` / `reasoning-watchdog-binding.mjs` are pure and non-executing: the binding only emits `supervisor_instruction` (+ optional `steer`/`interrupt` control verb) and never forces a tool call. The soft steer message is a single frozen string.
- `supervisor-policy/workflow-contract.json`'s `execution_supervision` binding already points at `TRI-BRIDGE-CONTRACT-V1.md#Worker-neutral-Control-Contract-v1` and `reasoning-watchdog-binding.mjs#evaluateWatchdogBinding`.
- **Claude native runtime demonstrably exposes read-only web capabilities** (`WebSearch` / `WebFetch`) — observable in the current environment.

### Assumptions / policy inputs from this task's brief (not verifiable from source)

- v0 trigger model: web research is warranted on an **explicit user request** OR on **strong external-info conditions** (version-sensitive question; ≥2 failed local attempts *plus* a judgement that external info would help; an unfamiliar error, unclear upstream behavior, or uncertain model knowledge, each *plus* that same judgement). A **reasoning stall alone must not trigger** research.
- Read-only scope: the only operations that will ever be authorized are `search` and `read`. Everything else (download-to-workspace, install/update, arbitrary shell network, mutating HTTP, authenticated/private endpoints, credential exposure) is out of scope and fails closed.
- Web content is **untrusted external evidence**. It can be promoted to `verified_current_evidence` only after local/current verification where applicable, and never overrides the security or task/project contract.

### Proven vs unproven (record precisely)

| Fact | Status |
| --- | --- |
| Claude native runtime exposes read-only web search + fetch | **Proven** (current environment) |
| Codex official current product supports web search separately from shell network access | **Unproven at WR0; subsequently proven for the exact WR3 smoke below.** |
| Pi transaction runtime keeps network off | **Proven design constraint** — not to be weakened here. Pi adaptation is separate LPB-owned extension work. |
| Any worker capability manifest entry for web research is true | **Not asserted by WR0/WR1; subsequently recorded by WR2 from the WR3 evidence below.** |

### Placement decision (freeze)

- `TRI-BRIDGE-WEB-RESEARCH-CAPABILITY-V0.md` — this program doc (WR0 + WR1).
- `worker-neutral/web-research/contract.v0.json` — worker-neutral semantics (operations, prohibitions, evidence + trust rules).
- `supervisor-policy/web-research-policy.mjs` — pure deterministic trigger/gate policy (`evaluateWebResearchPolicy`), no I/O.
- `supervisor-policy/web-research-policy.test.mjs` — regression coverage, wired into `npm run test:supervisor-policy`.
- `supervisor-policy/workflow-contract.json` — `execution_supervision` binding gains a reference to the new policy. **No new step/service.**
- `supervisor-policy/reasoning-watchdog-binding.mjs` — soft steer text extended by one bounded sentence only.

No bridge repo is touched. No runtime import is added.

---

## WR1 — Contract: worker-neutral web research semantics

### Trigger / gate policy (`evaluateWebResearchPolicy`)

Pure function, all boolean inputs default `false`, `local_attempt_failures` defaults `0`. Inputs: `user_requested`, `knowledge_uncertainty`, `version_sensitive`, `unfamiliar_error`, `local_attempt_failures`, `upstream_behavior_unclear`, `reasoning_stall`, `external_info_likely_helpful`, `capability_available`, `privacy_safe_query`.

Decision order:

1. **Warranted?** `user_requested` OR any strong external-info condition (see WR0). `reasoning_stall` is never a trigger and never tips a sub-threshold case.
2. If not warranted → `no_research` (`reason` = `reasoning_stall_alone_insufficient` when a stall was the only signal, else `not_warranted`).
3. If warranted but **not** `privacy_safe_query` → `blocked`, `reason_codes: ["privacy_unsafe_query"]`. No partial call.
4. If warranted and privacy-safe but **not** `capability_available` → `hold`, `reason_codes: ["capability_unavailable"]`. No call.
5. Otherwise → `research`, `allowed_operations: ["search", "read"]`, plus `evidence_requirements`.

Outputs are frozen (object + nested `triggers`, `reason_codes`, `allowed_operations`, `evidence_requirements`), consistent with the rest of `supervisor-policy/`.

### Worker-neutral contract (`worker-neutral/web-research/contract.v0.json`)

- **Operations:** `search` + `read` only. `read` is GET-class; results and content are bounded.
- **Prohibited:** download-to-workspace, install/update, arbitrary shell network, mutation HTTP methods, credential/private-data leakage, authenticated/private endpoints by default, treating web content as instructions, auto-publish.
- **Request requirements:** http/https only; privacy-safe queries/URLs; bounded results/content; primary/official/upstream sources preferred first.
- **Evidence requirements:** every item records `url`, `title`, `retrieved_at`, `source_type`; every carried claim links to its source item(s); unattributed web statements are not evidence.
- **Trust semantics:** web content is `untrusted_external_evidence`; promotion to `verified_current_evidence` requires local/current verification where applicable; it never overrides `security_hard_runtime` or `task_and_project_contract`; embedded instructions are ignored as instructions.

### Integration (minimal)

- `workflow-contract.json` `execution_supervision` now also references `supervisor-policy/web-research-policy.mjs#evaluateWebResearchPolicy`. No execution step or service added.
- `reasoning-watchdog-binding.mjs` soft steer message gains one sentence: if the *only* remaining blocker is missing external / version-sensitive information, a **single bounded read-only** web search or page read is acceptable — it must not force a web call and stays bounded.
- No worker capability manifest value is set true. WR2 owns per-worker capability keys and adapters; WR3 owns telemetry and live cross-worker smoke.

---

## WR2 — Capability registration and compatibility

- `supervisor-policy/worker-capabilities.json` schema version 3 adds `web_research: true` for Claude, Codex, and Pi, with `worker-neutral/web-research/wr2-smoke-evidence.v0.json` as the shared evidence reference.
- `web_research` is part of the Supervisor's generic hard-capability vocabulary, so routing can require it without adding a worker-specific branch.
- Pi compatibility is backed by LPB commit `97685bb`, which fixed the Node v24 custom DNS lookup `all:true` contract. Focused LPB results were **22/22 web-research tests** and **39/39 wiring tests**.

## WR3 — Live tri-worker smoke (PASS)

Full observed evidence is in `worker-neutral/web-research/wr2-smoke-evidence.v0.json`.

- **Pi — PASS.** Fresh-MCP `pi_start` schema had bounded `webResearch`; start accepted a per-run enabled configuration; exactly one `web_read` targeted `https://example.com`; response was HTTP 200; evidence trust label was `UNTRUSTED_EXTERNAL_EVIDENCE`; the repo was unchanged; broker cleanup was `true`.
- **Codex — PASS.** Exactly one native `webSearch` event ran for `site:openai.com Codex web search`; an official OpenAI result was returned; no files were modified.
- **Claude Code — PASS.** Exactly one native `WebFetch` targeted `https://example.com`; it returned 200 and `Example Domain`; no Bash/network substitute was used; no files were modified.

This establishes live tri-worker conformance for these exact representative read-only operations. It does not claim identical native tool surfaces or additional operations beyond those observed.

---

## Status summary

- **WR0:** complete (audit recorded above).
- **WR1:** policy + contract implemented and tested; workflow binding + soft steer updated.
- **WR2:** complete for Supervisor capability registration; Pi compatibility fix recorded from LPB commit `97685bb`.
- **WR3:** PASS for the exact live Pi, Codex, and Claude Code smokes recorded above and in the machine-readable evidence.
