# swarf™

**gcode carving interface**
[renato.design](https://renato.design)

swarf is a focused CNC carving front-end for design students — mesh in,
gcode out, everything else hidden. A fork of
[Kiri:Moto](https://github.com/GridSpace/grid-apps) (by Stewart Allen /
grid.space, MIT) trimmed down to a single mode (CAM), two machines
(Langmuir MR-1, ShopBot Basic), and four operations (rough, contour,
outline, pocket).

Read `swarf_README.txt` for the human version. Read `swarf_HANDOFF.txt`
for the build state and what's next.

## Running locally

```
npm run webpack-src
npx gs-app-server --debug --single --port 8181
```

Then open [localhost:8181/kiri/](http://localhost:8181/kiri/).

First time after fresh clone: `mkdir -p src/pack && npm run webpack-ext`
before the first `npm run dev`.

## Upstream

Kiri:Moto — [grid.space/kiri](https://grid.space) — is the engine under
the hood and the source of everything swarf didn't have to write. MIT
license (`license.md`), attribution kept in the app's About panel.
Upstream docs, forums, and Discord are the right place for machining
questions that outrun swarf's scope.

## Modifying swarf with an LLM

swarf is a fork — almost all of the engine is Stewart Allen's Kiri:Moto.
The swarf-specific layer is small and concentrated: `web/kiri/swarf-*.js`,
`src/kiri/app/init/menu.js`, `tools/deploy.sh`, the loading curtain in
`web/kiri/index.html`, and a handful of standing notes in `swarf_HANDOFF.txt`
that explain why things are the way they are. You can read all of it.

You can also ask a model to read it for you. That's how this fork was
built — not by typing the code, but by holding a long conversation with
a model that had the whole tree in context. It's a real way to work, and
you don't have to be a programmer for it to be useful. You do have to want 
the thing to exist and have the tools, you have to be the designer who holds focus.

**What you get from working this way.** You can change something the
day you notice it. You can ask "what would happen if…" and get a working
version of the answer in an hour. You can read code you didn't write —
Kiri:Moto is something like a thousand files — and have it explained back
to you in a register you can use. When you hit something stuck, you can
argue with the model until you both understand what's actually going on,
instead of grepping in the dark. What's a grep?

**What you give up.** The model doesn't have your taste. It will smooth
over the parts you wanted to keep weird. It will confidently invent
functions that look plausible and don't work... you can harden. It will over-engineer if
you don't push back — adding tests for things that don't fail, comments
that explain what the code already says, abstractions for cases that
won't come. The work of holding the line on what swarf is, and what it
isn't, falls to you.

**How to start.** Clone the repo. Open it in
[Claude Code](https://claude.com/claude-code) or whatever model you
prefer. Point it at `swarf_HANDOFF.txt` first — the deploy-pipeline
state at the top of that file is load-bearing, and the model needs the
context before it tries to write anything. Then describe what you want
the way you'd describe it to a quiet collaborator who has been in this
repo for months. Let it propose; you decide.

**What to watch out for.**

- The model will not tell you "this is a bad idea." You have to. Argue
  with it before you ask it to build. This is the single most important
  habit.
- If it generates a comment, ask whether the comment explains *why*
  something is true. If it's just narrating *what* the code does,
  delete it.
- If it adds a new file, check whether that file needed to exist.
  Usually two more lines in an existing file is the right answer.
- If it pulls in a dependency, check the license. swarf is MIT —
  copyleft (GPL / AGPL) deps would contaminate that.
- If it touches `tools/deploy.sh`, read every change. That script is
  the difference between swarf working on live and the curtain hanging
  forever.

**How Phil thinks about it.** The working method behind this fork (and
the whole suite of apps it sits in) is documented at
[renato.design/ilca/](https://renato.design/ilca/). It's called ILCA,
and it's a stance more than a methodology:
the model proposes, you dispose; argue against your own load-bearing
ideas before you build them; one bundled change is usually better than
three small ones; design taste lives in the human, implementation
muscle lives in the machine. If you want a way to think about *why*
this fork exists at all, start there.
