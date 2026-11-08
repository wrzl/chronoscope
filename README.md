# Chronoscope: world history, decade by decade

An explorable, zoomable web app built on the SenseForMaps poster "World History Timeline — Decade by Decade". The chart is shown unchanged. The time ruler, region rail, era strip, year needle, highlights, guided tour and search are drawn as a layer on top.

**Live:** https://wrzl.github.io/chronoscope/

## How it is hosted

The whole site is static and runs on **GitHub Pages**, for free, from the `main` branch of this repo. GitHub serves the image too, as tiles in `assets/`, so no other host is involved.

| Path | What it is |
|---|---|
| `index.html`, `css/`, `js/` | The app (about 80 KB) |
| `assets/base.webp` | The whole chart at 2048px, drawn first |
| `assets/tiles/<size>/<col>_<row>.webp` | 1024px tiles at 3375, 6750 and 13,500px (about 17 MB in all) |
| `assets/timeline-thumb.jpg` | Minimap thumbnail |
| `assets/og.jpg` | Preview image for links shared on social media and in chats |
| `.nojekyll` | Tells Pages to serve the files as they are |

To publish a change, commit and push to `main`. Pages redeploys in about a minute.

## Run locally

```bash
node serve.mjs        # → http://localhost:5178
```

## Controls

| Input | Action |
|---|---|
| Drag / arrows | Pan (with inertia) |
| Scroll / pinch / `+` `−` | Zoom at cursor |
| Double-click | Zoom in (Shift: out) |
| `0` | Fit the whole chart |
| `/` | Search years ("1453", "500 BCE"), regions, empires, eras |
| `T` / Space | Guided tour / next stop |
| `H` | Hide or show the highlight pins |
| `F` | Fullscreen |
| `?` | Help |

Add `#skip` to the URL to skip the intro.

## Deep zoom

The chart is drawn on a canvas from tiles, the same way map apps work. Only the visible tiles at the level that matches the zoom and the screen's pixel density are loaded and drawn, so text stays sharp up to about 14× zoom.
Loading the 13,500px master JPEG directly does not work: decoded, it needs about 730 MB, and browsers silently downscale it.

To rebuild the tiles from a new scan (square, same poster), put it at `assets/timeline.jpg` and run:

```bash
bash scripts/make-tiles.sh
```

The master scan is in `.gitignore`, so only the tiles get published. If the scan is not 13,500px, update `CHART.source.tiles.levels` in `js/data.js` to match what the script prints. All overlays use 1500-unit coordinates, so nothing else needs to change.

## Other image sources

`CHART.source` in `js/data.js` can also be set up to load the image from elsewhere. You can also set these globals in a `<script>` before `data.js`:

- `window.CHRONO_TILE_ROOT` sets the folder or URL that holds `base.webp`, `timeline-thumb.jpg` and `tiles/`. The default is `assets/`.
- `window.CHRONO_SOURCE = "remote"` loads one large image from an image host and tiles it in the browser. The imgur copy is 5000px, so zoom stops at about 5×.

## Image protection

The chart is drawn on a `<canvas>`, so there is no `<img>` to right-click and save. On top of that, the page blocks:

- the context menu
- dragging
- text selection
- the iOS long-press menu
- Ctrl/Cmd + S, P and U
- printing

These only stop casual copying. The tiles are public files in a public repo, and anyone with the developer tools or a screenshot can still get the image.

## Files

- `js/data.js`: chart calibration (year ↔ x), the 12 region bands, eras, tour stops and the image source
- `js/app.js`: camera (pan, zoom, fly-to), tile renderer, overlays, tour, search, intro
- `css/style.css`: styles
- `scripts/make-tiles.sh`: builds the tile pyramid with ffmpeg

Chart © SenseForMaps.
