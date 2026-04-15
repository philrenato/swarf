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
