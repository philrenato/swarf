# Shared Palette Audit (Kiri / Mesh / Void)

## Goal

Define a shared semantic color system in `web/moto/palette.css` and migrate each app incrementally with low risk.

## Phase 1 Delivered

- Added shared file: `web/moto/palette.css`
- Added semantic tokens for `light` and `dark` themes:
  - `--color-bg`, `--color-surface`, `--color-text`, `--color-border`, `--color-accent`, etc
- Added compatibility aliases (bridge variables) for Mesh/Void existing CSS vars.
- Wired palette stylesheet into:
  - `web/kiri/index.html`
  - `web/mesh/index.html`
  - `web/void/index.html`
- Added root attributes:
  - Kiri: `data-app="kiri"` and early `data-theme="light|dark"` set in head script
  - Mesh: `data-app="mesh" data-theme="dark"`
  - Void: `data-app="void" data-theme="dark"`

## Naming Recommendation (semantic first)

- Surfaces:
  - `--color-bg`, `--color-bg-elev`, `--color-bg-subtle`
  - `--color-surface`, `--color-surface-2`
- Content:
  - `--color-text`, `--color-text-muted`
  - `--color-border`, `--color-border-strong`
- Interaction:
  - `--color-accent`, `--color-accent-hover`, `--color-focus`
  - `--color-selection`, `--color-selection-hover`
- Status:
  - `--color-success`, `--color-warning`, `--color-danger`

## Step-wise Migration Plan

1. Convert top-level containers/menus/panels in each app to semantic tokens only.
2. Convert controls/interactions (hover/focus/selected) to semantic tokens.
3. Convert specialty overlays (grids, badges, debug panes) last.
4. Remove legacy per-app aliases once selectors are migrated.

## Validation Checklist Per Step

- Kiri light unchanged
- Kiri dark unchanged
- Mesh dark unchanged
- Void dark unchanged
- Contrast and hover/focus states still readable
