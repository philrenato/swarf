# Void Constraints V2 Plan (Planegcs-First, Fallback as Safety Net)

## Goal

Move sketch solving to a clean planegcs-first architecture, remove dual-solver behavioral drift, and improve drag/tangent stability.

## Current Findings

1. Constraint solving is currently dual-mode by default:
   - `enforceWithPlanegcs()` runs, then a fallback settle pass is still applied.
   - This can reintroduce different motion/priority behavior after planegcs already converged.

2. Drag interactions frequently force fallback:
   - During drag, `useFallback: tangentDriven || !pointDrag` is used in pointer drag paths.
   - This bypasses planegcs exactly where stable incremental behavior matters most.

3. Tangent constraints are not mapped into planegcs in the current mapper:
   - `toPlanegcsConstraint()` covers many constraints but not sketch `tangent`.
   - Tangency currently depends on fallback heuristics (`constraints_tangent.js`).

4. The planegcs wrapper already supports temporary constraints:
   - Constraint objects with `temporary: true` are supported by the wrapper path.
   - This enables proper drag-driving constraints with lower priority solving semantics.

5. `angle_via_point` is available in the solver bindings:
   - Suitable for robust endpoint tangency encoding (angle = 0 at shared endpoint).
   - This aligns with FreeCAD guidance for improved stability vs direct tangent formulations in corner cases.

## Root Cause Summary

1. Two solvers are actively shaping geometry during interaction.
2. Drag logic has explicit fallback preference in key paths.
3. Tangency is solved outside planegcs, creating inconsistent convergence and corner-case instability.

## Target Architecture

1. Planegcs is the primary and default solver for all live interaction and final settle.
2. Fallback solver is retained only as failure recovery.
3. Drag uses temporary constraints in planegcs:
   - Temporary point-to-point/point-to-line style guidance constraints to cursor/ghost references.
   - No permanent topology mutation from drag constraints.
4. Tangency uses planegcs-native representation:
   - Shared-endpoint tangent: `angle_via_point` with angle = 0.
   - Non-shared cases: use direct tangent primitives where stable (`tangent_la`, `tangent_aa`, etc.), with endpoint-angle fallback where needed.

## Phased Execution

## Phase 1: Instrumentation and Guardrails

1. Add solver telemetry per enforce call:
   - planegcs used, fallback used, solve status, elapsed time.
2. Add debug toggle to display active temporary constraints during drag.
3. Add deterministic logs for tangent constraint path selection.

Exit Criteria:
1. We can observe when and why fallback is invoked.

## Phase 2: Temporary Drag Constraints

1. Add drag-time temporary constraints (`temporary: true`) in planegcs solve graph.
2. Remove drag-path forced fallback defaults.
3. Keep fallback only if planegcs solve fails or returns non-converged status.

Exit Criteria:
1. Drag no longer “snaps back” from dual-pass disagreement.
2. Solver path during normal drag is planegcs-only.

## Phase 3: Tangent Migration

1. Implement tangent mapping in `toPlanegcsConstraint()`:
   - line-arc, arc-arc, line-circle as available.
2. For shared-endpoint tangent pairs, map to `angle_via_point` (angle=0).
3. Keep old tangent fallback path behind a temporary feature flag for rollback.

Exit Criteria:
1. Tangent drag corner cases no longer require tangent-specific fallback aggressiveness.
2. Shared-endpoint tangent cases are stable under repeated edits/drag.

## Phase 4: Remove Default Dual Settle

1. Remove unconditional fallback settle after successful planegcs solve.
2. Fallback runs only on explicit planegcs failure paths.
3. Keep compatibility switch (`constraints_v2_force_fallback`) for emergency rollback.

Exit Criteria:
1. Single primary solver behavior in normal operation.
2. Fewer constraint jitter/regressions from solver disagreement.

## Phase 5: Cleanup

1. Simplify pointer drag enforcement call sites.
2. Remove tangent-specific fallback tuning knobs that become obsolete.
3. Document canonical constraint mapping table and temporary-constraint rules.

Exit Criteria:
1. Constraint code paths are materially simpler and easier to reason about.

## Proposed Code Touchpoints

1. `src/void/sketch/constraints.js`
   - Add temporary constraint plumbing and tangent mapping in `toPlanegcsConstraint()`.
   - Remove unconditional fallback settle on success.

2. `src/void/sketch/pointer.js`
   - Replace drag-time fallback preference with planegcs temporary constraints.

3. `src/void/sketch/constraints_actions.js`
   - Ensure apply/edit flows use planegcs-first, fallback-on-failure behavior.

4. `src/void/sketch/constraints_tangent.js`
   - Transition from primary solver role to compatibility fallback only.

5. `src/void/solver/sketch/gcs_wrapper.js`
   - Confirm temporary constraint lifecycle handling and cleanup.

## Risks and Mitigations

1. Risk: Regression in legacy sketches tuned around fallback behavior.
   - Mitigation: feature flag + staged rollout + telemetry.

2. Risk: Performance regressions during drag with added temporary constraints.
   - Mitigation: limit temporary constraint count to active dragged subset; cap iterations.

3. Risk: Incorrect tangent mapping for mixed entity types.
   - Mitigation: explicit mapping matrix tests per constraint subtype.

## Validation Plan

1. Unit tests:
   - Tangent mapping (shared endpoint and non-shared).
   - Temporary constraint injection/removal lifecycle.
   - Planegcs success path without fallback pass.

2. Interaction tests:
   - Drag with dimensions, coincident, perpendicular, and tangent combos.
   - Repeated drag/release cycles without geometric drift.
   - Circular/grid/polygon pattern interactions under drag.

3. Regression scenarios:
   - Known tangent corner cases.
   - Previously flaky dual-solver “snap back” sketches.

## Recommendation

Start with Phase 2 (temporary drag constraints + fallback-on-failure only for drag) before full tangent migration. This yields immediate UX improvement and reduces dual-solver interference while keeping rollback safety.
