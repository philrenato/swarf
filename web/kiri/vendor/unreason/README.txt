Unreason 2D exchange (SVG / DXF / AI / PDF read and write), vendored unchanged
from unreason3d-web/app at commit 0bcd8b70 (2026-10-27) for swarf's 2D import
and "save drawing". Phil Renato approved publishing these two files in the
public swarf repo and on renato.design on 2026-10-27.

arrangement.mjs (the planar arrangement: every region a set of outlines
encloses, for DRAW's regions tool and its add / cut), vendored unchanged from
unreason3d-web/kernel/arrangement.mjs at commit 661bad94 (2026-10-29), with
trim.mjs holding only the two helpers it imports (signedArea2D,
pointInUVPolygon), copied unchanged from kernel/trim.mjs at the same commit.
Phil Renato approved vendoring Unreason 2D code into swarf.

Update by copying the files again; do not edit them here.
Copyright 2026 Phil Renato. Licensed under the MIT License (see /license.md) as part of swarf.
