# Void Chamfer V2 Plan (Geometric Offset, Not Boolean Cutters)

## Goal

Replace the current chamfer implementation based on cutter solids + boolean difference with a deterministic geometric chamfer pipeline that operates directly on mesh topology and face offsets.

## Why Change

1. Current path is boolean-driven (`solid/chamfer.js`) and depends on synthetic cutter prisms.
2. Boolean chamfer is fragile near:
   - short edges
   - dense/curved topology
   - multi-edge corner interactions
   - near-coplanar/low-angle neighborhoods
3. Provenance and boundary tracking are harder when chamfer is represented as a subtract operation, rather than explicit edge-face reconstruction.
4. Debugging and deterministic replay are harder with cutter generation and manifold fallback behavior.

## Current-State Findings

1. Chamfer currently:
   - resolves selected edges
   - builds cutter meshes from adjacent triangle normals
   - performs boolean difference
   - writes resulting body as manifold output

2. Signals in current code indicate boolean-centric lifecycle:
   - `manifold_chamfer_passthrough`
   - `manifold_chamfer_ready`
   - cutter debug/failure logs

3. Edge references are already fairly good:
   - chamfer refs use canonical boundary/segment identities
   - this is strong input for a topology-based rebuild

## Target Architecture

Chamfer becomes a topology/geometry transform, not a subtractive solid operation.

1. Input:
   - selected sharp edges (from stable boundary segment refs)
   - chamfer distance (and later optional asymmetric distances)

2. Core operation:
   - for each selected edge, offset its two incident face planes by chamfer distance
   - intersect offset planes with local wedge to compute chamfer strip geometry
   - trim neighboring faces and insert chamfer face(s)

3. Corner resolution:
   - solve multi-edge vertex neighborhoods explicitly
   - produce watertight corner patches without global booleans

4. Output:
   - rebuilt manifold mesh + updated provenance/boundary mappings
   - explicit chamfer faces with stable IDs (not anonymous boolean remnants)

## Data Model / Provenance Updates

1. Extend chamfer result metadata:
   - `source_edge_segment_ids[]`
   - `generated_face_ids[]`
   - `status: geometric_chamfer_ready`

2. GeometryStore integration:
   - chamfer faces emit boundaries/segments directly
   - chamfer faces carry source edge lineage

3. Preserve compatibility:
   - existing docs still readable
   - optional fallback to legacy boolean chamfer behind feature flag

## Algorithm Plan

## Stage A: Topology Extraction

1. Build edge->incident-face adjacency from input mesh.
2. Identify valid chamfer candidates:
   - manifold edges with exactly two incident faces
   - non-smooth crease threshold gating

3. Group selected edges into connected chamfer regions.

## Stage B: Per-Edge Offset Construction

1. For each selected edge:
   - compute incident face normals
   - construct two offset face planes
   - compute chamfer line as plane-plane intersection in local neighborhood

2. Create edge strip endpoints using neighboring trim constraints.

## Stage C: Face Trimming + Insertion

1. Trim original incident faces against chamfer boundary lines.
2. Insert chamfer quad/tri strip faces.
3. Maintain winding and local normal consistency.

## Stage D: Vertex Corner Solver

1. At each selected vertex:
   - collect incoming chamfer strips
   - solve intersection polygon in tangent frame
   - triangulate corner patch deterministically

2. Handle edge cases:
   - 2-edge corner
   - n-edge star corner
   - near-parallel incident faces

## Stage E: Rebuild + Mapping

1. Rebuild indexed mesh with new vertices/faces.
2. Recompute boundary segments and canonical edge refs.
3. Emit provenance mappings:
   - old edge ref -> new chamfer face/segments
   - unchanged faces preserve IDs where possible

## Execution Phases

## Phase 1: Infrastructure + Feature Flag

1. Add `chamfer_mode` toggle:
   - `legacy_boolean` (default initially)
   - `geometric_offset` (new path)
2. Build shared adjacency/topology helpers.

Exit criteria:

1. New path can run no-op safely and fall back cleanly.

## Phase 2: Single-Edge Geometric Chamfer

1. Implement robust one-edge chamfer on simple prism/cube cases.
2. Add deterministic unit fixtures.

Exit criteria:

1. Single selected edge produces expected geometry with no booleans.

## Phase 3: Multi-Edge Same-Face + Parallel Chains

1. Handle multiple selected edges on same body.
2. Ensure trim interactions are stable and watertight.

Exit criteria:

1. Common user workflows work without mesh cracks.

## Phase 4: Corner Solver

1. Implement n-edge corner patches.
2. Add tolerance policy and degeneracy handling.

Exit criteria:

1. Complex corners no longer require boolean fallback.

## Phase 5: Provenance + GeometryStore Wiring

1. Emit chamfer-derived boundaries/patch IDs with lineage.
2. Update hover/select mapping for chamfer outputs.

Exit criteria:

1. Chamfer boundaries are first-class and traceable.

## Phase 6: Default Cutover

1. Make geometric mode default.
2. Keep legacy boolean fallback for one release window.
3. Remove legacy path after stability window.

## Testing Plan

## Unit

1. Edge adjacency correctness.
2. Plane offset/intersection math.
3. Corner patch triangulation determinism.
4. Degenerate geometry tolerance behavior.

## Integration

1. Cube single-edge chamfer.
2. Multiple connected edges.
3. Concave/convex mixed selections.
4. Timeline edits upstream/downstream with stable refs.
5. Interaction with boolean-added bodies.

## Regression

1. No face holes/non-manifold edges after chamfer.
2. No ID churn for unaffected faces.
3. Boundary segment refs remain selectable post-chamfer.

## Risks and Mitigations

1. Risk: corner solver complexity.
   - Mitigation: staged rollout with strict fixtures before cutover.

2. Risk: precision instability on small geometry.
   - Mitigation: unified epsilon policy + local frame math.

3. Risk: behavior divergence from existing chamfer expectations.
   - Mitigation: side-by-side mode comparison tooling and temp dual-run validator.

## Implementation Touchpoints

1. `src/void/solid/chamfer.js`
   - split into legacy boolean and new geometric engine.

2. `src/void/solid/rebuild.js`
   - route chamfer feature to mode-specific executor.

3. `src/void/api/solids.js`
   - preserve/refit canonical edge mappings after geometric chamfer.
   - expose chamfer lineage for debug overlays.

4. `src/void/api/geometry_store.js`
   - ensure chamfer outputs emit boundary/segment/provenance records consistently.

## Immediate Next Step

Implement Phase 1 + Phase 2 in parallel:

1. Add mode flag and new engine scaffolding.
2. Land deterministic single-edge geometric chamfer on planar solids.
