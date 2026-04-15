swarf™ v00000-007
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
The Downward Spiral, by Nine Inch Nails. Productive upside-down of bright, feature-complete Kiri:Moto. Crushed blacks, bone text, mill-red accent, subtle sunset backdrop, industrial plate chrome. No lightcycles, no Eurostile monograms.

How to use
──────────
1. Open the app. A 25.4mm cube is loaded by default so the viewport is never blank.
2. File → import — drop in an STL or OBJ.
3. Setup → machines — pick MR-1 or ShopBot.
4. Toolpaths (top toolbar) — add rough, contour, outline, pocket as needed.
5. Preview — slice and inspect the toolpaths.
6. Export — gcode for the selected machine.

That is the whole trip.

Student mode vs. Expert mode
────────────────────────────
Student is the default and covers the four operations above with locked tools, auto stock, and corner/top origin.
Expert (View → expert mode) unlocks the rest — stock overrides, origin offsets, tool library editing, flip, drip, area, gcode, register, level, helical. Persists per browser.

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
