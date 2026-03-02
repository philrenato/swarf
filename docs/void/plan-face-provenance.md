# Void Face Provenance Plan (Boundary-First, Split Faces)

## Goal

Track which portions of resulting solids come from which sketch extrude regions, including after union/subtract, while keeping storage compact and spline-ready.

## Execution Status (2026-03-02)

Completed:

1. Plan authored and staged into phased implementation.
2. Debug visualization toggles added to preferences and wired to solids runtime:
3. Boundary loop rendering from GeometryStore.
4. Segment rendering from GeometryStore.
5. Segment/surface/region ID labels (overlay text).
6. Fixed world/local debug overlay transform bug:
7. GeometryStore points are world-space; line geometry parented under solids root must convert world -> root local because `space.WORLD` is rotated -90deg on X.
8. Manifold relation passthrough wired through kernel/worker/rebuild (`runIndex`, `runOriginalID`, `faceID`, and source-run solid mapping).
9. GeometryStore now emits provenance-partitioned `surface_patches` from per-face triangle run attribution (not just per-face-loop seeds).
10. Topology now records `patch_to_tris` and `tri_to_patch` during snapshot build for downstream hover/selection cutover.
11. Debug boundary rendering now prefers patch boundaries when present, so visualization aligns with sketch-derived/provenance splits.

In progress:

1. Cut over hover/selection resolvers from face-loop heuristics to patch-first entities (`surface_patch_id` canonical path).
2. Improve partition quality from triangle boundary approximation to robust boundary arrangement where needed.

Next up:

1. Add explicit `surface_patch_id` in hit/canonical selection entities.
2. Bind extrude-profile hover/select directly to patch/source-region maps.
3. Add regression fixtures for boolean unions/subtracts with mixed curved + planar outputs.

## Decisions

1. Primary provenance is `boundary/region/surface-patch`, not raw triangle ownership.
2. Triangle ownership is derived runtime index only (`tri -> surface_patch_id`) and can be rebuilt.
3. Multi-source output faces must be split into multiple bounded surface patches so each patch has one canonical source region.
4. Line/arc support ships first; segment model must support future spline kinds without schema redesign.

## Scope

In scope:

1. Extrude + boolean provenance tracking through rebuild pipeline.
2. Face splitting by source-region boundaries.
3. GeometryStore schema extension for stable patch-level IDs and source refs.
4. Runtime mapping from picks (`face/edge`) to canonical patch and source region.

Out of scope (initial pass):

1. Native spline feature authoring.
2. Long-lived persisted triangle provenance tables.
3. Non-planar sketch-on-surface expansion beyond current behavior.

## Data Model Changes

Add/extend document `geometry_store` entities:

1. `segments[]`
2. `kind: line | arc | spline`
3. `geom`: kind-specific payload
4. `sampled_polyline` (optional cache for hit testing/partitioning)

5. `boundaries[]`
6. Ordered `segment_ids`
7. `closed`, orientation, optional parent/child nesting

8. `regions[]`
9. `outer_boundary_id`
10. `hole_boundary_ids[]`
11. `source`: canonical source ref (`profile:<sketch>:<profile>`)

12. New `surface_patches[]`
13. `id`
14. `surface_id` (geometric carrier face)
15. `boundary_ids[]` (outer + holes)
16. `source_region_id` (single canonical owner)
17. `source_feature_id` (extrude feature)
18. `solid_id`
19. `status` (`direct`, `boolean-derived`, `rebound`)

20. New runtime-only `topology.patch_tri_index`
21. Maps mesh triangles to `surface_patch_id` for selection/render acceleration.

## Kernel Boundary Changes (Manifold)

Current kernel adapter only round-trips positions/indices; relation metadata is dropped.

Planned update:

1. Preserve Manifold mesh relation fields where available (`runOriginalID`, `faceID`, related run metadata).
2. Carry relation metadata through `extrudePolygons()` and `booleanMeshes()`.
3. Emit relation-aware intermediate records to rebuild stage (not directly persisted).

This enables deterministic attribution from boolean output back to input generated solids/regions before patch splitting.

## Provenance Build Pipeline

### Stage A: Sketch Region Capture

1. Keep current closed-loop profile extraction for line/arc.
2. Emit canonical `region_id = profile:<sketch>:<profile>`.
3. Record region boundaries using generic segment schema (`line|arc` now, `spline` later).

### Stage B: Extrude Seed Patches

1. Extrude each selected sketch region.
2. Seed cap/side patch candidates with direct source region refs.
3. Preserve manifold relation fields in intermediate mesh record.

### Stage C: Boolean Attribution

1. Perform add/subtract/intersect with relation-carrying meshes.
2. Build attribution map from output primitives/runs to source seed patches.
3. Mark ambiguous/mixed carrier surfaces for partitioning.

### Stage D: Face Partitioning (Split Multi-Source Faces)

1. For each mixed carrier surface, project contributing source boundaries to surface-local space.
2. Build planar arrangement, split into disjoint bounded cells.
3. Assign each cell a single `source_region_id` by relation majority + geometric tie-break.
4. Emit one `surface_patch` per bounded cell.

### Stage E: Runtime Topology Index

1. Build `tri -> surface_patch_id` map from patch partition output.
2. Use map for selection hit resolution and hover highlighting.
3. Rebuild index each solids rebuild; do not persist large triangle maps.

## Selection/Interaction Integration

1. Face pick resolves to `surface_patch_id` first, then `source_region_id`.
2. Edge/boundary pick resolves to `boundary_id`/`segment_id` that belongs to a patch.
3. Extrude-profile hover/highlight uses `source_region_id -> surface_patch[]` mapping.
4. Remove fallback heuristics that infer provenance only from coarse `source.profile_keys`.

## Storage and Performance

1. Persist compact canonical graph (`segments/boundaries/regions/surface_patches`).
2. Keep triangle-level maps runtime-only to avoid doc bloat and instability across remeshes.
3. Cache partition signatures per carrier surface to avoid full repartition when unchanged.

## Migration Plan

### Phase 1: Schema and Adapters

1. Add `surface_patches` schema and runtime index container.
2. Introduce generic segment schema (`kind + geom`) with current line/arc emitters.
3. Add compatibility normalizer for older docs (missing `surface_patches`).

### Phase 2: Kernel Metadata Plumbing

1. Extend solid kernel adapter to preserve manifold relation metadata.
2. Pass relation metadata through worker/main rebuild paths.

### Phase 3: Patch Builder

1. Implement mixed-face detection.
2. Implement local-space boundary arrangement and patch emission.
3. Add deterministic patch IDs/signatures.

### Phase 4: Resolver Cutover

1. Switch face selection from coarse face groups to `surface_patch` entities.
2. Update properties/tree hover mapping to patch/source-region links.

### Phase 5: Cleanup

1. Remove coarse provenance fallbacks once parity is validated.
2. Keep compatibility reader for older docs without `surface_patches`.

## Validation Plan

Unit tests:

1. Region extraction determinism (line/arc).
2. Mixed-face partitioning into disjoint bounded patches.
3. Single-owner assignment per patch.
4. Deterministic patch IDs under stable input.

Integration tests:

1. Two extrudes unioned: top face splits by source boundary and highlights per profile.
2. Subtract operation: surviving walls/caps retain correct source region refs.
3. Edit upstream sketch profile: downstream patch mapping updates without manual repair.
4. Rebuild in worker vs main thread yields identical patch/source mapping.

Regression guardrails:

1. No persisted triangle tables in doc snapshots.
2. No schema changes required to add spline segment kind later.
3. Selection never reports mixed-source face entities.
4. Any debug/runtime geometry under solids root must explicitly convert GeometryStore world coordinates to root-local coordinates.

## Implementation Checklist

Phase 1:

1. Done: update `src/void/api/geometry_store.js` schema to include `surface_patches` and runtime topology patch map container.
2. Done: extend `buildGeometryStoreSnapshot()` in `src/void/api/solids.js` to emit seeded `surface_patches` per face-loop with source-region candidate fields.
3. In progress: keep current face-key canonical mapping intact while adding optional patch ID fields.

Phase 2:

1. Update `src/void/solid/kernel.js` mesh conversion to preserve manifold relation fields:
2. Input pass-through where provided (`runOriginalID`, `runIndex`, `faceID`, etc.).
3. Output pass-through into rebuild intermediate structures.
4. Add worker payload support for relation arrays when present.

Phase 3:

1. Implement mixed-source detection in `src/void/solid/rebuild.js`.
2. Add per-surface local partition pass and emit patch boundaries.
3. Assign one canonical `source_region_id` per patch.

Phase 4:

1. Extend selection resolver and solids hit mapping to prefer patch IDs over raw face IDs.
2. Add properties/tree hover mapping from extrude profile -> patch IDs.
3. Remove coarse fallback once parity checks pass.

Phase 5:

1. Add deterministic integration tests for union/subtract split-face provenance.
2. Remove temporary migration branches and finalize docs.

## Acceptance Criteria

1. Every selectable resulting face area maps to exactly one `source_region_id`.
2. Multi-source carrier faces are visibly and topologically split at source boundaries.
3. Extrude profile hover/select maps accurately to resulting solid patches after booleans.
4. GeometryStore stays compact and stable; triangle mapping is derived at runtime.
