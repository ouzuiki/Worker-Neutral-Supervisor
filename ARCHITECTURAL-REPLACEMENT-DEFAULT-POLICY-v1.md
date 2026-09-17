# Architectural Replacement Default Policy v1

Status: **FROZEN v1**

Freeze date: 2026-09-17

## 1. Purpose

This policy prevents repeated high-cost renovation of infrastructure whose original architectural premise has already changed.

The default rule is:

> **When a component's core role changes, prefer replacement over renovation.**

A legacy implementation may remain frozen for rollback/reference while a minimal replacement is built, proven, cut over, and then archived. Existing investment, code volume, or prior engineering cost is sunk cost and MUST NOT by itself justify continued renovation.

## 2. Scope

This policy applies to Worker, Bridge, Host, Supervisor, routing, control-plane, execution-runtime, and related automation infrastructure governed by this repository.

It is a decision rule for architectural change, not a mandate to rewrite ordinary defects.

## 3. Replacement-default triggers

A proposed change MUST default to **replacement** when any of the following is true:

1. **Two or more core architectural dimensions change materially:**
   - role / responsibility;
   - authority / permission model;
   - lifecycle / ownership model;
   - primary data flow / control flow.
2. More than roughly half of the existing capability surface would need to be removed, bypassed, permanently disabled, or proven unreachable in the target architecture.
3. The work required to prove that legacy capabilities are inert is comparable to or greater than the work required to implement the minimal target system directly.
4. The target system is substantially smaller than the legacy system because the legacy system was built for a responsibility the target no longer has.
5. Renovation would require carrying forward compatibility layers, safety machinery, lifecycle semantics, or authority controls that exist only because of the retired role.

These are architectural triggers, not numeric scoring rules. The intent is to detect a changed premise early rather than optimize the old premise indefinitely.

## 4. Renovation is preferred only when the premise is stable

Renovation remains the default for ordinary maintenance when the following remain materially stable:

- the component still has the same core role;
- its authority model is unchanged;
- its lifecycle/ownership model is unchanged;
- its primary data/control flow is unchanged;
- most existing capability remains part of the desired target;
- the main problem is defect, reliability, performance, ergonomics, or bounded interface evolution rather than role replacement.

Typical examples: bug fixes, reliability hardening, bounded protocol upgrades, performance work, narrow compatibility fixes, or strengthening an unchanged safety boundary.

## 5. Mandatory comparison before major renovation

Before approving a substantial renovation, compare at least these two paths from the current state:

### Renovation path

Count the remaining cost of:

- code modification;
- compatibility preservation;
- migration logic;
- regression testing;
- production cutover;
- rollback support;
- proving retired capabilities cannot still execute;
- removing or maintaining legacy tests/docs/configuration;
- ongoing complexity retained after completion.

### Replacement path

Count the remaining cost of:

- minimal new implementation;
- extracting or reimplementing only necessary proven primitives;
- integration with the existing neutral boundary;
- confidence/shadow gate where needed;
- cutover;
- freezing and archiving the legacy implementation.

**Prior cost already spent on the legacy implementation is excluded from this comparison.**

If replacement is materially simpler or has a materially smaller proof burden, replacement is the default decision.

## 6. Standard replacement pattern

When replacement is selected, use this sequence unless a narrower safe sequence is justified:

1. **FREEZE OLD** — stop feature expansion; allow only safety/correctness work required to keep the legacy path stable during migration.
2. **BUILD MINIMAL NEW** — implement the target role without inheriting obsolete architecture.
3. **REUSE PRIMITIVES, NOT ARCHITECTURE** — copy/extract/reimplement only primitives that still have a target-role justification; do not import the legacy subsystem wholesale merely to save short-term work.
4. **PROVE NEW PATH** — run the smallest confidence/integration gate needed to prove the new role and boundary.
5. **CUT OVER** — switch the authoritative production path to the replacement.
6. **ARCHIVE OLD** — disable production admission/use and retain only as rollback/reference for the agreed window.
7. **CLOSE RESIDUALS** — remove obsolete wiring after cutover; do not spend large effort making the retired system aesthetically resemble the new one.

## 7. Proof-burden rule

Deletion is not automatically cheaper than replacement.

If deleting a legacy capability requires extensive proof that no caller, service, compatibility path, test harness, or runtime state still depends on it, that **proof burden is part of renovation cost**.

A replacement that never contains the obsolete capability can be safer and cheaper because absence is structural rather than behavioral.

Prefer:

> "the new system has no mutation primitive"

 over:

> "the old mutation primitive still exists, but we proved every path currently avoids it."

when the target role no longer needs mutation at all.

## 8. Safety rule during replacement

Replacement does not authorize premature removal of safety controls from an active legacy path.

Until cutover removes the old authority/path, its required containment, approval, reconciliation, verification, and fail-closed mechanisms remain intact.

The correct sequence is **remove authority/path first, then retire its safety machinery**.

## 9. Exception rule

A replacement-default trigger may be overridden only by an explicit human decision that records why renovation is still preferable from the current state.

Valid reasons may include unusually high migration risk, an external compatibility obligation, inability to run old/new in parallel, or a genuinely small retained-delta despite a conceptual role shift.

"We already spent a lot on the old implementation" is not a valid reason by itself.

## 10. Pi lesson captured by this policy

The Local Pi Bridge history is the motivating example: infrastructure repeatedly accumulated execution containment, transaction, sandbox, promotion, closure, and compatibility machinery while Pi's intended role later shifted from production Worker to semantic Supervisor.

Once the role, authority model, lifecycle, and data flow changed together, continued renovation imposed a larger deletion/proof burden than a minimal Supervisor-specific replacement would have required.

This policy exists so that future work recognizes that transition earlier.

## 11. Frozen decision shorthand

For future architecture reviews, use this shorthand:

- **Same premise, defective implementation → RENOVATE.**
- **Same role, bounded interface/reliability change → RENOVATE.**
- **Changed role + changed authority/lifecycle/data flow → REPLACE by default.**
- **More than half the system becomes legacy → REPLACE by default.**
- **Proving old capability is dead costs as much as building the minimal target → REPLACE.**
- **Sunk cost → IGNORE for forward architectural choice.**

Any proposal that chooses renovation despite a replacement-default trigger must state the explicit exception rationale before implementation begins.
