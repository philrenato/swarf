swarf™ v00000-007 r6
gcode carving interface
renato.design

What it is
──────────
swarf is a focused CNC carving front-end for design students — mesh in, gcode out, everything else hidden.

It is a fork of Kiri:Moto (by Stewart Allen / grid.space, MIT) with opinions.
Kiri:Moto handles six manufacturing modes and hundreds of machines. swarf does one thing: take a part, set up toolpaths on a Langmuir MR-1 or a ShopBot Basic, write gcode. Everything else is either gone or hidden behind an Expert toggle.

Where the name comes from — swarf is what is left on the floor after the machine does its work. Chips, shavings, displaced material. Evidence that something real got made.

Genre
─────
The Downward Spiral, by Nine Inch Nails. Productive upside-down of bright, feature-complete Kiri:Moto. Crushed blacks, bone text, mill-red accent, and a live sailor's-warning sky behind the viewport — procedural cloud drift that picks up pace while swarf is thinking, parallax on camera rotate. Industrial plate chrome. No lightcycles, no Eurostile monograms.

How to use
──────────
1. Open the app. A 25.4mm cube sits centered on the bed so the viewport is never blank. Drop in your own STL or OBJ and the seed cube steps aside — swarf only ever holds one part at a time in student mode.
2. File → import — drop in an STL or OBJ.
3. Setup → machines — MR-1 is preselected. Or pick ShopBot Basic.
4. Toolpaths (top toolbar) — add rough, contour, outline, pocket. Click the op name or the EDIT pill on the right to open its parameter drawer and change tool, feed, stepdown, stepover. Click ENDMILLS & BITS to manage the tool library.
5. Preview — slice and inspect.
6. Simulate — watch the tool walk the paths in real time. Curled chips peel off the cutter, arc through the scene, and pile up on the floor. Not a cleanup sim — the workshop looks worked-in when you're done.
7. Export — gcode for the selected machine. After export the scene goes quiet and achromatic; move the mouse or start a new step and the color comes back.

That is the whole trip.

Two help surfaces ship with the app, both under the Help menu —
Search Help (live filter across operations, parameters, tools, and short coaching paragraphs) and Concordance (the glossary, every named thing in swarf in one paragraph).

A Concerns drawer pinned to the lower right counts setup warnings as you build a job — stepover too wide on a finishing pass, plunge running as fast as feed, step-down deeper than the tool diameter. Empty drawer means a clean setup.

A small indicator LED next to the renato.design watermark changes color with the current phase of work — dim when idle, amber while you're editing toolpaths, gold while preview is slicing, glowing mill-red while simulation runs, gray after gcode export. It is the quietest possible progress bar, and always on.

Student mode vs. Expert mode
────────────────────────────
Student is the default and covers the four operations above with locked tools, auto stock at the part bbox, and origin centered on the part.
Expert (View → expert mode) unlocks the rest — stock overrides, origin offsets, tool library editing, flip, drip, area, gcode, register, level, helical. Persists per browser. Also restores the translucent stock outline around the part so you can see your raw material.

Keyboard shortcuts
──────────────────
One. Delete key removes the selected part.
Everything else must be reached through a menu or a tool icon — swarf is for design students, not power users. Discoverability over efficiency.

What is inside
──────────────
– Kiri:Moto CAM engine (unmodified, up to you to keep in sync with upstream)
– RenatoDesignSystem house style: chamfered plates, mill-red accent, bone typography in JetBrains Mono / IBM Plex Mono
– Searchable help and a concordance scaffolded under the Help menu — content fills in as the app earns it
– A dev-only markup toolbar for reviewing the UI in-browser

Credits
───────
Concept — Phil Renato / renato.design
Original source — Stewart Allen / grid.space · grid-apps
New code — Claude (Anthropic)
Method — ILCA (Iterative LLM Co-Authorship)

License
───────
Kiri:Moto is MIT — see KIRI_MOTO_LICENSE.txt (or upstream license.md). Attribution preserved in the app's about panel.
swarf's own modifications are Phil Renato's. Do not ship a build without keeping Kiri:Moto's license with it.
