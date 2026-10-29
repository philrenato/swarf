# swarf™

Browser CAM for a school woodshop. Draw or import a part, set toolpaths and tabs,
simulate, then cut.

**Open it:** [renato.design/swarf-app](https://renato.design/swarf-app/) (installable, works offline once loaded)

- **Runs a ShopBot from the browser.** Chrome or Edge drives a ShopBot over its USB
  cable, no other software: connect, jog, zero, Z plate, trace, air cut, cut, feed
  override, e-stop. swarf switches the router on and off itself.
- **Auto tabs.** One press places tabs sized for the material, bit, board and machine.
  Every tab setting is editable, and pieces inside holes are held too. Parts cut free
  with no tabs are flagged.
- **Make parts:** shapes, drawing, text, or import SVG, DXF, AI, PDF, STL or OBJ.
- **Toolpaths:** rough, contour, outline, pocket, with feeds and speeds from the
  material and the bit.
- **Inches or millimeters**, fractions included.
- **Simulate** before you cut.
- **Two machines:** ShopBot (default) and Langmuir MR-1, which runs from an exported file.
- **Skins:** wet plastic (default), classic, swarf.

## Running locally and forking

```
npm i && mkdir -p src/pack && npm run webpack-ext   # once, after a fresh clone
npm run webpack-src
npx gs-app-server --debug --single --port 8181      # then open localhost:8181/kiri/
```

swarf is MIT (`license.md` keeps Kiri:Moto's notice; keep both). To make your own copy:
remove the GoatCounter tag at the end of `web/kiri/index.html`, change the canonical /
og URLs at its top and the renato.design watermark in `src/kiri/app/init/sync.js`.
`tools/deploy.sh` updates an existing static copy served at `/swarf-app/` (set
`SWARF_WEB_REPO`); to start fresh, build with `npm run webpack-src prod` and serve `web/`.
The gates in `tools/` drive Chrome for Testing (`CHROME=/path/to/chrome`) against a URL you pass.

## Credits

swarf is a fork of [Kiri:Moto](https://github.com/GridSpace/grid-apps) by Stewart Allen /
[grid.space](https://grid.space) (MIT), the engine underneath and the source of most of the
code. Third-party licenses: `THIRD_PARTY_NOTICES.txt`.

ShopBot is a trademark of ShopBot Tools, Inc.; MR-1 of Langmuir Systems; Porter-Cable of its
owner. swarf is independent, not made, endorsed or supported by any of them; the names only
say which machines it drives.
