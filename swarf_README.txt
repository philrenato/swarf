sw|arf™ v00000-012
gcode carving interface
renato.design/swarf/

(Wordmark: sw in white, arf in mill-red — the cutter making its sound.
 Backronym below.)

The name
────────
swarf is the dust, chips, and shavings left on the floor after a CNC machine
finishes its work. The shop floor remembers what got made.

It is also a soft, contented bark — sw•arf — the sound a router makes when
it finds the material and starts to bite. The wordmark splits accordingly:
sw is the spin-up, arf is the cut.

Backronym (recovered after the fact, like all good ones):

  S — Subtractive
  W — Workshop
  A — for
  R — Resourceful
  F — Folks

Subtractive Workshop for Resourceful Folks. The tool is for design students
who want to cut something out, not for shopfloor pros who already have a CAM
package they trust. The whole interface is built around making a single,
honest cut readable.

If anyone asks "is the name an acronym?", the answer is "no, it's a noun.
But if it were, it would be Subtractive Workshop for Resourceful Folks."

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
6. Simulate — clicking SIMULATE auto-plays the toolpath. The cutter spins, curled chips peel off it in the color of the selected material, arc through the scene, and pile up on the floor. Not a cleanup sim — the workshop looks worked-in when you're done. The bottom rail has a red play/pause/step row, a fast-forward cycle through ½× to 32×, click the speed value to type a custom multiplier, and a chips on/off toggle so you can compare with and without debris.
7. Export — gcode for the selected machine. After export the scene goes quiet and achromatic; move the mouse or start a new step and the color comes back.

That is the whole trip.

Two help surfaces ship with the app, both under the Help menu —
Search Help (live filter across operations, parameters, tools, and short coaching paragraphs) and Concordance (the glossary, every named thing in swarf in one paragraph).

A Concerns drawer pinned to the lower right counts setup warnings as you build a job — stepover too wide on a finishing pass, plunge running as fast as feed, step-down deeper than the tool diameter. Empty drawer means a clean setup.

A small indicator LED next to the renato.design watermark changes color with the current phase of work — dim when idle, amber while you're editing toolpaths, gold while preview is slicing, glowing mill-red while simulation runs, gray after gcode export. It is the quietest possible progress bar, and always on.

Materials
─────────
A MATERIAL row sits at the top of the TOOLPATHS panel — pick hard wood, foam, aluminum 6061, polycarbonate, or mild steel. The selection retints the stock and the chips. Hardwood looks like wood and throws brown shavings; aluminum reads as brushed silver and spits silver curls; polycarbonate goes translucent blue and the chips do too. The endmill itself is always brushed metallic silver with a helical flute pattern, regardless of stock material — a tool is a tool.

Speeds and feeds for each material × tool diameter live in web/kiri/swarf-materials.json (HSS midranges cut in half for safety per Phil's prosumer-CNC rule). The selection is per-browser and persists across reloads.

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


Lightstreams
────────────
Every move the simulated tool makes lays down a glowing translucent ribbon along the cut path. Three stacked layers — a tight red centerline, a softer orange halo, a wide diffuse bloom — all additive. The ribbon is horizontal, thin in Z, lying flat on the cut plane like phosphorescent tape.

Toggle from the pill in the simulate bar. Off means off — the ribbon stops drawing and anything already drawn hides. It clears on each new simulate so it always starts fresh.

The ribbon is driven directly from the simulator's per-frame tool position, not from any scene-graph guesswork. Only genuine rapids (big XY jumps between passes, or a retract to clearance in Z) break the trace.


Web edition
───────────
Live at renato.design/swarf-app/ — the same app, served from the website. No install, no download. Open it in Chrome or Safari and you're cutting.

SharedArrayBuffer (which Kiri's worker threads need) requires specific security headers. A service worker shim (coi-serviceworker.js) injects COEP and COOP headers on first load. This means one extra page refresh the first time — after that, the service worker handles it silently.

One catch: incognito and private browsing windows block service workers entirely. If the app can't start, an 8-second timeout shows a message explaining why. Use a regular browser window.

On a phone the app doesn't load. A desktop-only takeover explains why — swarf is a CAM workbench and its 3D orbit, precise pointer, and drag-to-pan toolpaths don't survive on a phone screen. Link back to the marketing page and an escape hatch (?full=1) for visitors who want to see the unusable UI anyway.

The deployed build flattens the kiri/ directory to root and rewrites all absolute paths from /kiri/ and /lib/ to /swarf-app/ prefixes. The source of truth is always this repo — the deployed copy is a build artifact.
