(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const root = document.documentElement;
  const stage = $('#stage');
  const world = $('#world');
  const chart = $('#chart');
  const F = CHART.frame;
  const AX = CHART.axis;
  const FULL = { x0: 0, x1: CHART.size, y0: 0, y1: CHART.size };

  /* ================================================================
     Camera
     ================================================================ */
  const cam = { x: 750, y: 750, s: 0.5 };
  const inset = { l: 176, t: 82 };
  let W = innerWidth, H = innerHeight;
  let fitS = 0.5, sMin = 0.4;
  let sMax = 14; // set from the source resolution below
  let dirty = true;

  const vcx = () => inset.l + (W - inset.l) / 2;
  const vcy = () => inset.t + (H - inset.t) / 2;
  const sx = (wx) => (wx - cam.x) * cam.s + vcx();
  const sy = (wy) => (wy - cam.y) * cam.s + vcy();
  const wx = (px) => (px - vcx()) / cam.s + cam.x;
  const wy = (py) => (py - vcy()) / cam.s + cam.y;

  function readInsets() {
    const cs = getComputedStyle(root);
    inset.l = parseFloat(cs.getPropertyValue('--rail-w')) || 176;
    inset.t = parseFloat(cs.getPropertyValue('--ruler-h')) || 82;
  }

  function scaleToFit(r, pad = 0.92, area) {
    const a = area || { l: inset.l, t: inset.t, r: W, b: H };
    return Math.min((a.r - a.l) / (r.x1 - r.x0), (a.b - a.t) / (r.y1 - r.y0)) * pad;
  }

  function clampCam(c = cam) {
    c.s = clamp(c.s, sMin, sMax);
    const hw = (W - inset.l) / c.s / 2, hh = (H - inset.t) / c.s / 2;
    const m = 60 / c.s;
    const loX = -m + hw, hiX = CHART.size + m - hw;
    const loY = -m + hh, hiY = CHART.size + m - hh;
    c.x = loX > hiX ? CHART.size / 2 : clamp(c.x, loX, hiX);
    c.y = loY > hiY ? CHART.size / 2 : clamp(c.y, loY, hiY);
    return c;
  }

  function zoomAt(px, py, factor) {
    const ax = wx(px), ay = wy(py);
    cam.s = clamp(cam.s * factor, sMin, sMax);
    cam.x = ax - (px - vcx()) / cam.s;
    cam.y = ay - (py - vcy()) / cam.s;
    clampCam();
    dirty = true;
  }

  function panBy(dx, dy) {
    cam.x -= dx / cam.s;
    cam.y -= dy / cam.s;
    clampCam();
    dirty = true;
  }

  /* ---- smooth wheel zoom ---- */
  let zoomTarget = null; // { s, px, py }
  function smoothZoom(px, py, factor) {
    cancelFly();
    const base = zoomTarget ? zoomTarget.s : cam.s;
    zoomTarget = { s: clamp(base * factor, sMin, sMax), px, py };
  }
  function stepZoom() {
    if (!zoomTarget) return;
    const r = Math.log(zoomTarget.s / cam.s);
    if (Math.abs(r) < 0.0015) {
      zoomAt(zoomTarget.px, zoomTarget.py, zoomTarget.s / cam.s);
      zoomTarget = null;
      return;
    }
    zoomAt(zoomTarget.px, zoomTarget.py, Math.exp(r * 0.22));
  }

  /* ---- inertia ---- */
  const vel = { x: 0, y: 0 };
  let inertia = false;
  function stepInertia(dt) {
    if (!inertia) return;
    const k = Math.pow(0.0035, dt / 1000); // friction
    vel.x *= k; vel.y *= k;
    panBy(vel.x * dt, vel.y * dt);
    if (Math.hypot(vel.x, vel.y) < 0.01) inertia = false;
  }

  /* ---- fly (van Wijk & Nuij smooth zoom/pan) ---- */
  function interpolateZoom(p0, p1) {
    const rho = 1.42, rho2 = rho * rho, rho4 = rho2 * rho2;
    const [ux0, uy0, w0] = p0, [ux1, uy1, w1] = p1;
    const dx = ux1 - ux0, dy = uy1 - uy0, d2 = dx * dx + dy * dy;
    let i, S;
    if (d2 < 1e-9) {
      S = Math.log(w1 / w0) / rho;
      i = (t) => [ux0 + t * dx, uy0 + t * dy, w0 * Math.exp(rho * t * S)];
    } else {
      const d1 = Math.sqrt(d2);
      const b0 = (w1 * w1 - w0 * w0 + rho4 * d2) / (2 * w0 * rho2 * d1);
      const b1 = (w1 * w1 - w0 * w0 - rho4 * d2) / (2 * w1 * rho2 * d1);
      const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0);
      const r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
      S = (r1 - r0) / rho;
      i = (t) => {
        const s = t * S, c0 = Math.cosh(r0);
        const u = (w0 / (rho2 * d1)) * (c0 * Math.tanh(rho * s + r0) - Math.sinh(r0));
        return [ux0 + u * dx, uy0 + u * dy, (w0 * c0) / Math.cosh(rho * s + r0)];
      };
    }
    i.duration = Math.abs(S) * 1000;
    return i;
  }

  let fly = null;
  function cancelFly() { fly = null; }
  function flyTo(tx, ty, ts, opts = {}) {
    zoomTarget = null; inertia = false;
    const t = clampCam({ x: tx, y: ty, s: ts });
    if (opts.free) { t.x = tx; t.y = ty; }
    const vw = W - inset.l;
    const i = interpolateZoom([cam.x, cam.y, vw / cam.s], [t.x, t.y, vw / t.s]);
    const dur = reduced ? 1 : opts.duration || clamp(i.duration * 0.85, 650, 2400);
    fly = { i, start: performance.now(), dur, done: opts.done, vw };
  }
  function stepFly(now) {
    if (!fly) return;
    const t = clamp((now - fly.start) / fly.dur, 0, 1);
    const [x, y, w] = fly.i(easeInOut(t));
    cam.x = x; cam.y = y; cam.s = fly.vw / w;
    dirty = true;
    if (t >= 1) { const d = fly.done; fly = null; d && d(); }
  }

  /* fly so that `r` fills the free area (avoiding UI panels given by pad) */
  function flyToRect(r, { pad = 0.9, right = 0, bottom = 0, maxS = sMax * 0.85, done } = {}) {
    const area = { l: inset.l, t: inset.t, r: W - right, b: H - bottom };
    const s = clamp(scaleToFit(r, pad, area), sMin, maxS);
    const acx = (area.l + area.r) / 2, acy = (area.t + area.b) / 2;
    const cx = (r.x0 + r.x1) / 2 - (acx - vcx()) / s;
    const cy = (r.y0 + r.y1) / 2 - (acy - vcy()) / s;
    flyTo(cx, cy, s, { done, free: true });
  }

  function fitAll(done) {
    flyTo(CHART.size / 2, CHART.size / 2, fitS, { done });
  }

  /* ================================================================
     Layout
     ================================================================ */
  function resize() {
    const keep = { x: cam.x, y: cam.y, rel: cam.s / fitS };
    W = innerWidth; H = innerHeight;
    readInsets();
    fitS = scaleToFit(FULL, 0.97);
    sMin = fitS * 0.8;
    cam.x = keep.x; cam.y = keep.y; cam.s = fitS * keep.rel;
    clampCam();
    sizeTileCanvas();
    sizeCanvas(rulerCanvas, rulerCtx);
    sizeCanvas(dust, dustCtx, true);
    dirty = true;
  }

  function sizeCanvas(c, ctx, full) {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = full ? W : c.clientWidth, h = full ? H : c.clientHeight;
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    c._w = w; c._h = h;
  }

  /* ================================================================
     Deep-zoom renderer
     'remote': one large image on an image host. Its small thumbnail shows
       at once; the full image streams in, is decoded once, and 1024px
       tiles are cut from it in the browser as they come into view.
     'tiles': a pyramid of pre-built tiles served next to the page.
     Either way only the visible tiles at the level that matches
     zoom × device-pixel ratio are drawn on a canvas — no <img> to save.
     ================================================================ */
  const SRC = CHART.source;
  const MODE = window.CHRONO_SOURCE || SRC.mode;
  const ROOT = window.CHRONO_TILE_ROOT ?? SRC.tiles.root;
  const TILE = 1024;
  const P = (() => {
    if (MODE === 'tiles') {
      const t = SRC.tiles;
      return { base: ROOT + t.base.path, baseSize: t.base.size, thumb: ROOT + t.thumb, full: t.levels[t.levels.length - 1].size, levels: t.levels };
    }
    const r = SRC.remote;
    const levels = [Math.round(r.size / 2), r.size].map((size) => ({ size, n: Math.ceil(size / TILE) }));
    return { base: r.preview, baseSize: r.previewSize, thumb: r.thumb, full: r.size, levels };
  })();
  sMax = Math.max(4, (P.full / CHART.size) * 1.6); // stop where the source runs out of detail

  const tileCanvas = $('#tiles');
  const tctx = tileCanvas.getContext('2d', { alpha: true });
  const tileCache = new Map(); // key -> { img, w, ready, last }
  const MAX_TILES = 72, MAX_INFLIGHT = 6;
  let inflight = 0, revealP = 0, frameNo = 0;

  const loadImage = (url, cors) => new Promise((res, rej) => {
    const img = new Image();
    if (cors) img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = url;
  });

  let baseImg = null;
  const baseReady = loadImage(P.base, MODE === 'remote')
    .then((img) => { baseImg = img; dirty = true; })
    .catch(() => {});
  $('#mmImg').src = P.thumb;

  /* ---- remote full image: stream with progress, decode once ---- */
  let fullBmp = null, fullState = 'idle';
  const hiRes = $('#hiRes'), hiResText = $('#hiResText'), hiResBar = $('#hiResBar');
  function hiResStatus(p, text) {
    hiRes.hidden = false;
    hiResText.textContent = text || `Loading full resolution · ${Math.round(p * 100)}%`;
    hiResBar.style.transform = `scaleX(${p == null ? 0 : p})`;
  }
  async function loadFull() {
    if (MODE !== 'remote' || fullState !== 'idle') return;
    fullState = 'loading';
    hiResStatus(0);
    try {
      const res = await fetch(SRC.remote.full, { mode: 'cors', credentials: 'omit' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const total = Number(res.headers.get('content-length')) || 0;
      let blob;
      if (res.body && res.body.getReader && total) {
        const reader = res.body.getReader();
        const chunks = [];
        let got = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          got += value.length;
          hiResStatus(Math.min(1, got / total));
        }
        blob = new Blob(chunks, { type: res.headers.get('content-type') || 'image/jpeg' });
      } else {
        hiResStatus(null, 'Loading full resolution…');
        blob = await res.blob();
      }
      hiResStatus(1, 'Preparing full resolution…');
      fullBmp = window.createImageBitmap
        ? await createImageBitmap(blob)
        : await loadImage(URL.createObjectURL(blob));
      fullState = 'ready';
      gsap.to(hiRes, { opacity: 0, duration: 0.5, delay: 0.3, onComplete: () => { hiRes.hidden = true; hiRes.style.opacity = ''; } });
      dirty = true;
    } catch (err) {
      fullState = 'failed';
      hiResStatus(0, 'Full resolution unavailable · showing preview');
      gsap.to(hiRes, { opacity: 0, duration: 0.6, delay: 4, onComplete: () => { hiRes.hidden = true; hiRes.style.opacity = ''; } });
    }
  }

  // cut one tile of level L out of the decoded full image
  function cutTile(L, c, r) {
    const f = P.full / L.size;
    const sx0 = c * TILE * f, sy0 = r * TILE * f;
    const sw = Math.min(TILE * f, P.full - sx0), sh = Math.min(TILE * f, P.full - sy0);
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(sw / f));
    cv.height = Math.max(1, Math.round(sh / f));
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(fullBmp, sx0, sy0, sw, sh, 0, 0, cv.width, cv.height);
    return cv;
  }

  function tileDpr() { return Math.min(devicePixelRatio || 1, 2); }
  function sizeTileCanvas() {
    const d = tileDpr();
    tileCanvas.width = Math.round(W * d);
    tileCanvas.height = Math.round(H * d);
  }

  function requestTile(key, L, c, r) {
    if (MODE === 'remote') {
      const cv = cutTile(L, c, r);
      tileCache.set(key, { img: cv, w: cv.width, h: cv.height, ready: true, last: frameNo });
      dirty = true;
      return;
    }
    const e = { img: null, w: TILE, h: TILE, ready: false, last: frameNo };
    tileCache.set(key, e);
    inflight++;
    loadImage(ROOT + SRC.tiles.path(L.size, c, r), false)
      .then((img) => { e.img = img; e.w = img.naturalWidth; e.h = img.naturalHeight; e.ready = true; })
      .catch(() => tileCache.delete(key))
      .finally(() => { inflight--; dirty = true; });
  }

  function freeTile(e) {
    if (!e.img) return;
    if (e.img instanceof HTMLImageElement) e.img.src = '';
    else { e.img.width = 0; e.img.height = 0; }
  }
  function evictTiles() {
    if (tileCache.size <= MAX_TILES) return;
    const old = [...tileCache.entries()]
      .filter(([, e]) => e.ready && e.last < frameNo)
      .sort((x, y) => x[1].last - y[1].last);
    for (const [k, e] of old) {
      if (tileCache.size <= MAX_TILES) break;
      freeTile(e);
      tileCache.delete(k);
    }
  }

  let settleTimer = 0;
  function settleFetch() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => (dirty = true), 90);
  }

  function drawTiles() {
    frameNo++;
    const d = tileDpr(), ctx = tctx, U = CHART.size;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, tileCanvas.width, tileCanvas.height);
    if (revealP <= 0) return;
    const X = (v) => Math.round(sx(v) * d), Y = (v) => Math.round(sy(v) * d);
    const ix0 = X(0), iy0 = Y(0), ix1 = X(U), iy1 = Y(U);
    ctx.save();
    ctx.beginPath();
    ctx.rect(ix0, iy0, (ix1 - ix0) * revealP, iy1 - iy0);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (baseImg) ctx.drawImage(baseImg, ix0, iy0, ix1 - ix0, iy1 - iy0);
    else { ctx.fillStyle = '#f3f1ec'; ctx.fillRect(ix0, iy0, ix1 - ix0, iy1 - iy0); }

    // device pixels needed across the whole chart at this zoom
    const need = U * cam.s * d;
    let target = -1;
    if (need > P.baseSize * 1.1) {
      target = P.levels.findIndex((l) => l.size >= need * 0.85);
      if (target < 0) target = P.levels.length - 1;
    }
    const canFetch = MODE === 'tiles' || fullState === 'ready';
    if (target >= 0 && MODE === 'remote' && fullState === 'idle') loadFull();

    const vx0 = clamp(wx(0), 0, U), vx1 = clamp(wx(W), 0, U);
    const vy0 = clamp(wy(0), 0, U), vy1 = clamp(wy(H), 0, U);
    const cxw = wx(vcx()), cyw = wy(vcy());
    const missing = [];

    for (let li = 0; li <= target; li++) {
      const L = P.levels[li];
      const k = U / L.size;      // world units per level pixel
      const tw = TILE * k;       // tile pitch in world units
      const c0 = Math.max(0, Math.floor(vx0 / tw)), c1 = Math.min(L.n - 1, Math.floor(vx1 / tw));
      const r0 = Math.max(0, Math.floor(vy0 / tw)), r1 = Math.min(L.n - 1, Math.floor(vy1 / tw));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const key = `${L.size}/${c}_${r}`;
          const e = tileCache.get(key);
          if (e) e.last = frameNo;
          if (e && e.ready) {
            const x0 = X(c * tw), y0 = Y(r * tw), x1 = X(c * tw + e.w * k), y1 = Y(r * tw + e.h * k);
            ctx.drawImage(e.img, x0, y0, x1 - x0, y1 - y0);
          } else if (!e && li === target && canFetch) {
            missing.push({ key, L, c, r, d: Math.hypot((c + 0.5) * tw - cxw, (r + 0.5) * tw - cyw) });
          }
        }
      }
    }
    ctx.restore();

    const moving = fly || zoomTarget || dragging || pinch;
    if (missing.length && !moving) {
      missing.sort((x, y) => x.d - y.d);
      const budget = MODE === 'remote' ? 3 : Math.max(0, MAX_INFLIGHT - inflight);
      for (const m of missing.slice(0, budget)) requestTile(m.key, m.L, m.c, m.r);
      if (missing.length > budget) dirty = true;
    } else if (missing.length) {
      settleFetch(); // fetch once the camera comes to rest
    }
    evictTiles();
  }

  /* ---- image protection: deterrents against casual saving ---- */
  const inField = (t) => t && t.closest && t.closest('input, textarea');
  document.addEventListener('contextmenu', (e) => { if (!inField(e.target)) e.preventDefault(); });
  document.addEventListener('dragstart', (e) => e.preventDefault());
  document.addEventListener('selectstart', (e) => { if (!inField(e.target)) e.preventDefault(); });
  addEventListener('keydown', (e) => {
    const k = (e.key || '').toLowerCase();
    if ((e.metaKey || e.ctrlKey) && (k === 's' || k === 'p' || k === 'u')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      toast('Saving and printing are turned off for this chart');
    }
  }, true);

  /* ================================================================
     Ruler
     ================================================================ */
  const rulerCanvas = $('#rulerCanvas');
  const rulerCtx = rulerCanvas.getContext('2d');
  const STEPS = [1, 5, 10, 25, 50, 100, 250, 500, 1000];
  let hover = null; // { px, py, year, region }

  function drawRuler() {
    const ctx = rulerCtx, w = rulerCanvas._w, h = rulerCanvas._h;
    ctx.clearRect(0, 0, w, h);
    const ppy = AX.PX_PER_YEAR * cam.s; // screen px per year
    let major = STEPS.find((st) => st * ppy >= 86) || 1000;
    let minor = [major / 10, major / 5, major / 2].find((m) => Number.isInteger(m) && m * ppy >= 7) || major;
    const left = xToYear(wx(inset.l)), right = xToYear(wx(W));
    const xOf = (y) => sx(yearToX(y)) - inset.l;

    // outside chart range
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    const a = xOf(AX.min), b = xOf(AX.max);
    if (a > 0) ctx.fillRect(0, 0, a, h);
    if (b < w) ctx.fillRect(b, 0, w - b, h);

    // BCE tint
    const z = xOf(0);
    if (z > 0) {
      ctx.fillStyle = 'rgba(196,61,85,.06)';
      ctx.fillRect(Math.max(0, a), 0, Math.min(w, z) - Math.max(0, a), h);
    }

    ctx.lineWidth = 1;
    const y0 = Math.max(AX.min, Math.floor(left / minor) * minor);
    const y1 = Math.min(AX.max, Math.ceil(right / minor) * minor);
    ctx.strokeStyle = 'rgba(232,214,176,.22)';
    ctx.beginPath();
    for (let y = y0; y <= y1; y += minor) {
      if (y % major === 0) continue;
      const x = Math.round(xOf(y)) + 0.5;
      ctx.moveTo(x, h - 9); ctx.lineTo(x, h);
    }
    ctx.stroke();

    ctx.font = '500 11px "IBM Plex Mono", monospace';
    ctx.textBaseline = 'alphabetic';
    const ym0 = Math.max(Math.ceil(AX.min / major) * major, Math.floor(left / major) * major);
    let lastRight = -Infinity;
    for (let y = ym0; y <= y1; y += major) {
      const x = Math.round(xOf(y)) + 0.5;
      if (x < -60 || x > w + 60) continue;
      const big = y % (major * 5) === 0 || y === 0;
      ctx.strokeStyle = big ? 'rgba(227,178,96,.75)' : 'rgba(232,214,176,.45)';
      ctx.beginPath(); ctx.moveTo(x, h - (big ? 20 : 15)); ctx.lineTo(x, h); ctx.stroke();
      const lbl = y === 0 ? 'BCE | CE' : y < 0 ? `${-y} BCE` : `${y}`;
      const tw = ctx.measureText(lbl).width;
      if (x - tw / 2 < lastRight + 10) continue;
      lastRight = x + tw / 2;
      ctx.fillStyle = big ? '#e3b260' : '#b8af9c';
      ctx.textAlign = 'center';
      ctx.fillText(lbl, x, h - 25);
    }

    // hover marker
    if (hover && hover.year != null) {
      const x = xOf(hover.year);
      ctx.fillStyle = '#e3b260';
      ctx.beginPath(); ctx.moveTo(x - 6, h); ctx.lineTo(x + 6, h); ctx.lineTo(x, h - 8); ctx.closePath(); ctx.fill();
    }
  }

  /* ================================================================
     Eras
     ================================================================ */
  const erasEl = $('#eras');
  const eraEls = ERAS.map((e) => {
    const d = document.createElement('div');
    d.className = 'era';
    d.innerHTML = `<span>${e.name}</span>`;
    d.title = `${e.name} · ${fmtYear(e.from)} – ${fmtYear(e.to)}`;
    d.addEventListener('click', () => flyToEra(e));
    erasEl.appendChild(d);
    return d;
  });
  function placeEras() {
    const focusYear = hover && hover.year != null ? hover.year : xToYear(cam.x);
    ERAS.forEach((e, i) => {
      const a = sx(yearToX(Math.max(e.from, AX.min))) - inset.l;
      const b = sx(yearToX(Math.min(e.to, AX.max))) - inset.l;
      const el = eraEls[i];
      el.style.transform = `translateX(${a}px)`;
      el.style.width = `${Math.max(0, b - a)}px`;
      const lbl = el.firstChild;
      const off = Math.max(0, Math.min(-a, b - a - (lbl._w || (lbl._w = lbl.offsetWidth)) - 16));
      lbl.style.transform = `translateX(${off}px)`;
      el.classList.toggle('cur', focusYear >= e.from && focusYear < e.to);
    });
  }
  function flyToEra(e) {
    const x0 = yearToX(Math.max(e.from, AX.min)), x1 = yearToX(Math.min(e.to, AX.max));
    const s = clamp(((W - inset.l) / (x1 - x0)) * 0.94, sMin, sMax);
    flyTo((x0 + x1) / 2, cam.y, s);
  }

  /* ================================================================
     Region rail
     ================================================================ */
  const rail = $('#rail');
  const bandEls = REGIONS.map((r, i) => {
    const b = document.createElement('button');
    b.className = 'band';
    b.style.setProperty('--h', r.hue);
    b.innerHTML = `<span class="lbl"><span class="f">${r.name}</span><span class="s">${r.short}</span><small>${String(i + 1).padStart(2, '0')} / 12</small></span>`;
    b.setAttribute('aria-label', `Fly to ${r.name}`);
    b.addEventListener('click', () => flyToRegion(r));
    b.addEventListener('mouseenter', () => { railHover = r; dirty = true; });
    b.addEventListener('mouseleave', () => { railHover = null; dirty = true; });
    rail.appendChild(b);
    b._lbl = b.querySelector('.lbl');
    return b;
  });
  let railHover = null;

  function placeBands() {
    const cur = railHover || (hover && hover.region);
    REGIONS.forEach((r, i) => {
      const el = bandEls[i];
      const top = sy(r.y0) - inset.t, hgt = (r.y1 - r.y0) * cam.s;
      el.style.transform = `translateY(${top}px)`;
      el.style.height = `${hgt}px`;
      el.classList.toggle('cur', cur === r);
      el.classList.toggle('tiny', hgt < 46);
      const lh = el._lh || (el._lh = el._lbl.offsetHeight || 34);
      const ly = clamp(-top + 10, 8, Math.max(8, hgt - lh - 8));
      el._lbl.style.transform = `translateY(${hgt < 20 ? 0 : ly}px)`;
      el._lbl.style.opacity = hgt < 16 ? 0 : 1;
    });
    // glow on stage
    const g = $('#bandGlow');
    if (cur) {
      g.style.top = `${sy(cur.y0)}px`;
      g.style.height = `${(cur.y1 - cur.y0) * cam.s}px`;
      g.style.left = `${inset.l}px`;
      g.classList.add('on');
    } else g.classList.remove('on');
  }

  function flyToRegion(r) {
    const s = clamp(((H - inset.t) / (r.y1 - r.y0)) * 0.86, fitS, sMax * 0.7);
    const keepX = cam.s < fitS * 1.05 ? xToYear(cam.x) : null;
    flyTo(keepX == null ? cam.x : yearToX(1000), (r.y0 + r.y1) / 2, s);
  }

  const regionAt = (y) => REGIONS.find((r) => y >= r.y0 && y < r.y1) || null;

  /* ================================================================
     Needle (cursor year)
     ================================================================ */
  const needle = $('#needle'), needleYear = $('#needleYear'), needleRegion = $('#needleRegion'), needleBadge = $('#needleBadge');
  const decadeEl = $('#decade');
  function updateHover(px, py) {
    if (px == null || px < inset.l || py < inset.t) { hover = null; dirty = true; return; }
    const x = wx(px), y = wy(py);
    const yr = xToYear(x);
    const inChart = yr >= AX.min && yr <= AX.max && y >= F.y0 && y <= F.y1;
    hover = { px, py, year: inChart ? yr : null, region: inChart ? regionAt(y) : null };
    dirty = true;
  }
  function placeNeedle() {
    if (!hover || hover.year == null || dragging || fly) {
      needle.classList.remove('on'); decadeEl.classList.remove('on'); return;
    }
    const yr = Math.round(hover.year);
    needle.style.transform = `translateX(${sx(yearToX(hover.year))}px)`;
    needleYear.textContent = fmtYear(yr, true);
    const dec = Math.floor(yr / 10) * 10;
    const decLbl = dec < 0 ? `${-dec - 9}–${-dec} BCE` : `${dec}s`;
    needleRegion.textContent = `${hover.region ? hover.region.name : ''}${AX.PX_PER_YEAR * cam.s * 10 > 8 ? ' · ' + decLbl : ''}`;
    needleBadge.classList.toggle('flip', hover.px > W - 220);
    needle.classList.add('on');
    // decade column
    const ppy = AX.PX_PER_YEAR * cam.s;
    if (ppy * 10 > 8) {
      const d0 = sx(yearToX(dec));
      decadeEl.style.left = `${d0}px`;
      decadeEl.style.width = `${ppy * 10}px`;
      decadeEl.style.top = `${inset.t}px`;
      decadeEl.classList.add('on');
    } else decadeEl.classList.remove('on');
  }

  /* ================================================================
     Hotspots + spotlight
     ================================================================ */
  const stopRect = (s) => s.rect || { x0: yearToX(s.from), x1: yearToX(Math.min(s.to, AX.max)), y0: s.y - s.h / 2, y1: s.y + s.h / 2 };
  STOPS.forEach((s) => (s._r = stopRect(s)));
  if (STOPS.find((s) => s.id === 'now')) {
    const n = STOPS.find((s) => s.id === 'now');
    n._r = { x0: yearToX(n.from), x1: F.x1, y0: F.y0, y1: F.y1 };
  }

  const hsWrap = $('#hotspots');
  const hsEls = STOPS.map((s, i) => {
    if (s.id === 'now') return null;
    const b = document.createElement('button');
    b.className = 'hs';
    b.setAttribute('aria-label', s.title);
    const yrs = s.years || `${fmtYear(s.from)} – ${fmtYear(s.to)}`;
    b.innerHTML = `<span class="ring"></span><span class="core"></span><span class="tip">${s.title}<small>${yrs}</small></span>`;
    b.addEventListener('click', (e) => { e.stopPropagation(); openTour(i); });
    hsWrap.appendChild(b);
    return b;
  });
  function placeHotspots() {
    STOPS.forEach((s, i) => {
      const el = hsEls[i]; if (!el) return;
      const x = sx(s._r.x0), y = sy((s._r.y0 + s._r.y1) / 2);
      const vis = x > inset.l - 10 && y > inset.t - 10 && x < W + 10 && y < H + 10;
      el.style.left = `${x}px`; el.style.top = `${y}px`;
      el.style.visibility = vis ? 'visible' : 'hidden';
    });
  }

  const spot = $('#spot'), spotHole = $('#spotHole'), spotRing = $('#spotRing');
  let spotRect = null;
  function placeSpot() {
    if (!spotRect) return;
    const p = 6;
    const x = sx(spotRect.x0) - p, y = sy(spotRect.y0) - p;
    const w = (spotRect.x1 - spotRect.x0) * cam.s + p * 2, h = (spotRect.y1 - spotRect.y0) * cam.s + p * 2;
    for (const el of [spotHole, spotRing]) {
      el.setAttribute('x', x); el.setAttribute('y', y);
      el.setAttribute('width', Math.max(0, w)); el.setAttribute('height', Math.max(0, h));
    }
  }

  /* ================================================================
     Minimap
     ================================================================ */
  const mm = $('#minimap'), mmView = $('#mmView');
  function placeMinimap() {
    const k = mm.clientWidth / CHART.size;
    const x0 = wx(inset.l), y0 = wy(inset.t), x1 = wx(W), y1 = wy(H);
    mmView.style.left = `${x0 * k}px`; mmView.style.top = `${y0 * k}px`;
    mmView.style.width = `${(x1 - x0) * k}px`; mmView.style.height = `${(y1 - y0) * k}px`;
  }
  let mmDrag = false;
  function mmMove(e, animate) {
    const r = mm.getBoundingClientRect(), k = r.width / CHART.size;
    const x = (e.clientX - r.left) / k, y = (e.clientY - r.top) / k;
    if (animate) { flyTo(x, y, cam.s, { duration: 700 }); return; }
    cancelFly(); cam.x = x; cam.y = y; clampCam(); dirty = true;
  }
  mm.addEventListener('pointerdown', (e) => { mmDrag = true; mm.setPointerCapture(e.pointerId); mmMove(e, true); });
  mm.addEventListener('pointermove', (e) => { if (mmDrag && e.buttons) { mmMove(e, false); } });
  mm.addEventListener('pointerup', () => (mmDrag = false));

  /* ================================================================
     Render loop
     ================================================================ */
  const zoomLabel = $('#zoomLevel');
  function render() {
    world.style.transform = `translate3d(${vcx() - cam.x * cam.s}px, ${vcy() - cam.y * cam.s}px, 0) scale(${cam.s})`;
    drawTiles();
    drawRuler();
    placeEras();
    placeBands();
    placeNeedle();
    placeHotspots();
    placeSpot();
    placeMinimap();
    zoomLabel.textContent = `${Math.round((cam.s / fitS) * 100)}%`;
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(48, now - last); last = now;
    stepFly(now);
    stepZoom();
    stepInertia(dt);
    if (dirty) { dirty = false; render(); }
    drawDust(now);
    requestAnimationFrame(frame);
  }

  /* ================================================================
     Input
     ================================================================ */
  const pointers = new Map();
  let dragging = false, pinch = null, lastPt = null, lastT = 0, moved = 0;

  stage.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    $('#q').blur(); closeResults();
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    cancelFly(); zoomTarget = null; inertia = false; vel.x = vel.y = 0;
    moved = 0;
    if (pointers.size === 1) {
      dragging = true; stage.classList.add('dragging');
      lastPt = { x: e.clientX, y: e.clientY }; lastT = performance.now();
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    }
    dirty = true;
  });

  stage.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) {
      if (e.pointerType === 'mouse') updateHover(e.clientX, e.clientY);
      return;
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1 && lastPt) {
      const dx = e.clientX - lastPt.x, dy = e.clientY - lastPt.y;
      const now = performance.now(), dt = Math.max(1, now - lastT);
      panBy(dx, dy);
      moved += Math.abs(dx) + Math.abs(dy);
      vel.x = lerp(vel.x, dx / dt, 0.35); vel.y = lerp(vel.y, dy / dt, 0.35);
      lastPt = { x: e.clientX, y: e.clientY }; lastT = now;
      if (e.pointerType === 'mouse') updateHover(e.clientX, e.clientY);
    } else if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      panBy(mx - pinch.mx, my - pinch.my);
      zoomAt(mx, my, d / pinch.d);
      pinch = { d, mx, my };
    }
  });

  function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size === 1) {
      const p = [...pointers.values()][0];
      lastPt = { x: p.x, y: p.y }; lastT = performance.now(); pinch = null; vel.x = vel.y = 0;
    }
    if (pointers.size === 0) {
      dragging = false; stage.classList.remove('dragging'); pinch = null;
      if (performance.now() - lastT < 80 && Math.hypot(vel.x, vel.y) > 0.08) inertia = true;
      dirty = true;
    }
  }
  stage.addEventListener('pointerup', endPointer);
  stage.addEventListener('pointercancel', endPointer);
  stage.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !pointers.size) { hover = null; dirty = true; } });

  stage.addEventListener('dblclick', (e) => smoothZoom(e.clientX, e.clientY, e.shiftKey ? 1 / 2.2 : 2.2));

  function onWheel(e, horizontalOnly) {
    e.preventDefault();
    let dx = e.deltaX, dy = e.deltaY;
    if (e.deltaMode === 1) { dx *= 16; dy *= 16; }
    if (horizontalOnly) { cancelFly(); panBy(-(dx || dy), 0); return; }
    if (e.ctrlKey) { smoothZoom(e.clientX, e.clientY, Math.exp(-dy * 0.012)); return; }
    if (Math.abs(dx) > 0.5 && e.deltaMode === 0) { cancelFly(); zoomTarget = null; panBy(-dx, -dy); return; }
    smoothZoom(e.clientX, e.clientY, Math.exp(-clamp(dy, -150, 150) * 0.0024));
  }
  stage.addEventListener('wheel', (e) => onWheel(e), { passive: false });
  $('#ruler').addEventListener('wheel', (e) => onWheel(e, true), { passive: false });
  rail.addEventListener('wheel', (e) => { e.preventDefault(); cancelFly(); panBy(0, -(e.deltaY * (e.deltaMode === 1 ? 16 : 1))); }, { passive: false });

  // drag the ruler to scrub through time
  let rDrag = null;
  rulerCanvas.addEventListener('pointerdown', (e) => { rDrag = e.clientX; rulerCanvas.setPointerCapture(e.pointerId); cancelFly(); });
  rulerCanvas.addEventListener('pointermove', (e) => {
    if (rDrag != null && e.buttons) { panBy(e.clientX - rDrag, 0); rDrag = e.clientX; }
    updateHover(e.clientX, inset.t + 1);
    if (hover) hover.region = null;
  });
  rulerCanvas.addEventListener('pointerup', () => (rDrag = null));
  rulerCanvas.addEventListener('pointerleave', () => { hover = null; dirty = true; });

  // keyboard
  addEventListener('keydown', (e) => {
    if (e.target === $('#q') || !booted) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    const step = 0.9;
    if (k === 'ArrowLeft') { vel.x = step; vel.y = 0; inertia = true; cancelFly(); }
    else if (k === 'ArrowRight') { vel.x = -step; vel.y = 0; inertia = true; cancelFly(); }
    else if (k === 'ArrowUp') { vel.y = step; vel.x = 0; inertia = true; cancelFly(); }
    else if (k === 'ArrowDown') { vel.y = -step; vel.x = 0; inertia = true; cancelFly(); }
    else if (k === '+' || k === '=') smoothZoom(vcx(), vcy(), 1.6);
    else if (k === '-' || k === '_') smoothZoom(vcx(), vcy(), 1 / 1.6);
    else if (k === '0') fitAll();
    else if (k === '/') { e.preventDefault(); $('#q').focus(); }
    else if (k === 't' || k === 'T') tourIndex < 0 ? openTour(0) : closeTour();
    else if (k === ' ' || k === 'Enter') { if (tourIndex >= 0) { e.preventDefault(); go(1); } }
    else if (k === 'Backspace') { if (tourIndex >= 0) go(-1); }
    else if (k === 'h' || k === 'H') togglePins();
    else if (k === 'f' || k === 'F') toggleFull();
    else if (k === '?') toggleHelp();
    else if (k === 'Escape') { if ($('#help').classList.contains('open')) toggleHelp(false); else closeTour(); }
    else return;
    dirty = true;
  });

  /* ================================================================
     Controls
     ================================================================ */
  $('#controls').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const a = b.dataset.act;
    if (a === 'in') smoothZoom(vcx(), vcy(), 1.8);
    if (a === 'out') smoothZoom(vcx(), vcy(), 1 / 1.8);
    if (a === 'fit') fitAll();
    if (a === 'tour') tourIndex < 0 ? openTour(0) : closeTour();
    if (a === 'pins') togglePins();
    if (a === 'full') toggleFull();
    if (a === 'help') toggleHelp();
  });
  function togglePins() {
    const off = hsWrap.classList.toggle('off');
    document.querySelector('[data-act="pins"]').classList.toggle('on', !off);
  }
  function toggleFull() {
    if (!document.fullscreenElement) root.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.();
  }
  function toggleHelp(force) {
    const h = $('#help');
    const open = force ?? !h.classList.contains('open');
    h.classList.toggle('open', open);
  }
  $('#helpClose').addEventListener('click', () => toggleHelp(false));
  $('#help').addEventListener('click', (e) => { if (e.target.id === 'help') toggleHelp(false); });

  /* ================================================================
     Tour
     ================================================================ */
  const card = $('#card');
  const dots = $('#dots');
  STOPS.forEach((s, i) => {
    const d = document.createElement('i');
    d.title = s.title;
    d.addEventListener('click', () => openTour(i));
    dots.appendChild(d);
  });
  let tourIndex = -1, autoplay = false, autoTween = null;

  function cardPads() {
    const mobile = innerWidth <= 760;
    return mobile ? { right: 0, bottom: card.offsetHeight + 140 } : { right: card.offsetWidth + 32, bottom: 0 };
  }

  function openTour(i) {
    i = (i + STOPS.length) % STOPS.length;
    const first = tourIndex < 0;
    tourIndex = i;
    const s = STOPS[i];
    $('#cardIndex').textContent = `${String(i + 1).padStart(2, '0')} / ${STOPS.length}`;
    $('#cardRegion').textContent = s.region;
    $('#cardYears').textContent = s.years || `${fmtYear(s.from)} – ${s.id === 'now' ? 'today' : fmtYear(s.to)}`;
    $('#cardTitle').innerHTML = s.title.split(' ').map((w) => `<span class="split">${w}</span>`).join(' ');
    $('#cardText').textContent = s.text;
    [...dots.children].forEach((d, k) => d.classList.toggle('on', k === i));
    hsEls.forEach((h, k) => h && h.classList.toggle('active', k === i));
    $('[data-act="tour"]').innerHTML = '<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17"/></svg>';

    if (first) {
      gsap.set(card, { visibility: 'visible' });
      gsap.fromTo(card, { opacity: 0, x: 40, scale: 0.97 }, { opacity: 1, x: 0, scale: 1, duration: 0.7, ease: 'expo.out' });
    }
    gsap.fromTo('#cardTitle .split', { yPercent: 70, opacity: 0, filter: 'blur(6px)' }, { yPercent: 0, opacity: 1, filter: 'blur(0px)', duration: 0.7, stagger: 0.06, ease: 'expo.out', delay: 0.05 });
    gsap.fromTo(['#cardRegion', '#cardYears', '#cardText'], { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, stagger: 0.07, ease: 'power3.out', delay: 0.15 });

    spotRect = null; spot.classList.remove('on');
    const r = s._r;
    const pads = cardPads();
    const view = s.id === 'key' || s.id === 'now'
      ? { x0: r.x0 - 20, x1: r.x1 + 20, y0: r.y0 - 20, y1: r.y1 + 20 }
      : (() => {
          const w = r.x1 - r.x0, h = r.y1 - r.y0;
          const ex = Math.max(w * 0.3, 40), ey = Math.max(h * 1.4, 70);
          return { x0: r.x0 - ex, x1: r.x1 + ex, y0: r.y0 - ey, y1: r.y1 + ey };
        })();
    flyToRect(view, {
      ...pads, pad: 0.95, maxS: 6,
      done: () => { spotRect = r; placeSpot(); spot.classList.add('on'); dirty = true; },
    });
    restartAuto();
  }

  function go(d) { openTour(tourIndex + d); }
  function closeTour() {
    if (tourIndex < 0) return;
    tourIndex = -1; autoplay = false; $('#play').classList.remove('on');
    autoTween && autoTween.kill();
    spotRect = null; spot.classList.remove('on');
    hsEls.forEach((h) => h && h.classList.remove('active'));
    $('[data-act="tour"]').innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z"/></svg>';
    gsap.to(card, { opacity: 0, x: 40, duration: 0.4, ease: 'power2.in', onComplete: () => gsap.set(card, { visibility: 'hidden' }) });
  }
  function restartAuto() {
    autoTween && autoTween.kill();
    gsap.set('#cardProgress i', { width: 0 });
    if (!autoplay) return;
    autoTween = gsap.to('#cardProgress i', { width: '100%', duration: 11, ease: 'none', onComplete: () => go(1) });
  }
  $('#prev').addEventListener('click', () => go(-1));
  $('#next').addEventListener('click', () => go(1));
  $('#cardClose').addEventListener('click', closeTour);
  $('#play').addEventListener('click', () => {
    autoplay = !autoplay;
    $('#play').classList.toggle('on', autoplay);
    $('#play').textContent = autoplay ? '❚❚' : '▶';
    restartAuto();
  });

  /* ================================================================
     Search / jump
     ================================================================ */
  const q = $('#q'), results = $('#results');
  let items = [], sel = 0;
  function parseYear(str) {
    const m = str.trim().toLowerCase().match(/^(ad\s*)?(-?\d{1,4})\s*(bce|bc|ce|ad|b\.c\.|a\.d\.)?$/);
    if (!m) return null;
    let y = parseInt(m[2], 10);
    if (m[3] && m[3].startsWith('b')) y = -Math.abs(y);
    if (y < AX.min || y > AX.max) return null;
    return y;
  }
  function buildResults() {
    const v = q.value.trim().toLowerCase();
    items = [];
    const y = parseYear(v);
    if (y != null) items.push({ k: 'Year', label: `Go to ${fmtYear(y)}`, meta: 'decade view', act: () => jumpYear(y) });
    if (v) {
      STOPS.forEach((s, i) => { if ((s.title + ' ' + s.region).toLowerCase().includes(v)) items.push({ k: 'Highlight', label: s.title, meta: s.years || `${fmtYear(s.from)}–${fmtYear(s.to)}`, act: () => openTour(i) }); });
      REGIONS.forEach((r) => { if (r.name.toLowerCase().includes(v)) items.push({ k: 'Region', label: r.name, meta: 'band', act: () => flyToRegion(r) }); });
      ERAS.forEach((e) => { if (e.name.toLowerCase().includes(v)) items.push({ k: 'Era', label: e.name, meta: `${fmtYear(e.from)}–${fmtYear(e.to)}`, act: () => flyToEra(e) }); });
    } else {
      [1066, -776, 1453, 1492].forEach((yy) => items.push({ k: 'Year', label: `Go to ${fmtYear(yy)}`, meta: 'try it', act: () => jumpYear(yy) }));
    }
    sel = 0;
    results.innerHTML = items.slice(0, 9).map((it, i) => `<li class="${i === sel ? 'sel' : ''}" data-i="${i}"><span><span class="k">${it.k}</span>${it.label}</span><small>${it.meta}</small></li>`).join('') || '<li><span>No match — try a year like “800” or “500 BCE”</span></li>';
    results.classList.add('open');
  }
  function closeResults() { results.classList.remove('open'); }
  function choose(i) { const it = items[i]; if (!it) return; closeResults(); q.blur(); it.act(); }
  q.addEventListener('focus', buildResults);
  q.addEventListener('input', buildResults);
  q.addEventListener('blur', () => setTimeout(closeResults, 150));
  q.addEventListener('keydown', (e) => {
    const n = Math.min(items.length, 9);
    if (e.key === 'ArrowDown') { sel = (sel + 1) % n; e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = (sel - 1 + n) % n; e.preventDefault(); }
    else if (e.key === 'Enter') { choose(sel); return; }
    else if (e.key === 'Escape') { q.blur(); return; }
    else return;
    [...results.children].forEach((li, k) => li.classList.toggle('sel', k === sel));
  });
  results.addEventListener('pointerdown', (e) => { const li = e.target.closest('li[data-i]'); if (li) { e.preventDefault(); choose(+li.dataset.i); } });

  const pulse = $('#pulse');
  function jumpYear(y) {
    const s = Math.max(cam.s, fitS * 3.2);
    flyTo(yearToX(y), cam.s > fitS * 1.5 ? cam.y : (F.y0 + F.y1) / 2, s, {
      done: () => {
        const x = sx(yearToX(y));
        gsap.fromTo(pulse, { left: x - 1, opacity: 1, scaleX: 1 }, { opacity: 0, scaleX: 14, duration: 1.4, ease: 'expo.out' });
        updateHover(x, hover ? hover.py : vcy());
      },
    });
  }

  /* ================================================================
     Ambient dust
     ================================================================ */
  const dust = $('#dust'), dustCtx = dust.getContext('2d');
  const motes = Array.from({ length: 70 }, () => ({
    x: Math.random(), y: Math.random(), z: 0.2 + Math.random() * 0.8,
    r: 0.4 + Math.random() * 1.4, p: Math.random() * Math.PI * 2,
  }));
  function drawDust(now) {
    const ctx = dustCtx, w = dust._w, h = dust._h;
    if (!w) return;
    ctx.clearRect(0, 0, w, h);
    const ox = cam.x * 0.04, oy = cam.y * 0.04;
    for (const m of motes) {
      const x = ((m.x * w - ox * m.z + now * 0.004 * m.z) % w + w) % w;
      const y = ((m.y * h - oy * m.z - now * 0.002 * m.z) % h + h) % h;
      const a = 0.25 + 0.25 * Math.sin(now * 0.001 + m.p);
      ctx.fillStyle = `rgba(227,178,96,${a * m.z})`;
      ctx.beginPath(); ctx.arc(x, y, m.r * m.z, 0, Math.PI * 2); ctx.fill();
    }
  }

  /* ================================================================
     Intro
     ================================================================ */
  function splitTitle() {
    const t = $('#introTitle');
    t.innerHTML = [...t.textContent].map((c) => (c === ' ' ? ' ' : `<span class="ch">${c}</span>`)).join('');
  }

  function toast(msg) {
    const el = document.createElement('div');
    el.textContent = msg;
    Object.assign(el.style, {
      position: 'fixed', left: `${vcx()}px`, bottom: innerWidth <= 760 ? '200px' : '24px', transform: 'translateX(-50%)', zIndex: 8,
      padding: '10px 16px', borderRadius: '999px', background: 'rgba(14,16,24,.9)', border: '1px solid rgba(232,214,176,.3)',
      font: '500 12.5px Manrope, sans-serif', color: '#efe7d6', whiteSpace: 'nowrap', pointerEvents: 'none',
      backdropFilter: 'blur(10px)', maxWidth: '90vw', overflow: 'hidden', textOverflow: 'ellipsis',
    });
    document.body.appendChild(el);
    gsap.fromTo(el, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.6, ease: 'expo.out' });
    gsap.to(el, { opacity: 0, y: 10, duration: 0.5, delay: 5.5, onComplete: () => el.remove() });
  }

  let introTl = null, skipRequested = false, booted = false;
  $('#skip').addEventListener('click', () => (introTl ? introTl.progress(1) : (skipRequested = true)));

  function intro() {
    document.body.classList.add('pre');
    splitTitle();
    const yearEl = $('#introYear');
    const counter = { y: AX.Y0 };
    const reveal = { p: 0 };
    const sweep = $('#sweep');

    const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });
    tl.from('.kicker', { opacity: 0, y: 14, letterSpacing: '0.6em', duration: 1.2 })
      .from('#introTitle .ch', { opacity: 0, yPercent: 80, rotateX: -80, filter: 'blur(14px)', duration: 1.3, stagger: 0.045 }, 0.15)
      .to('.intro-line i', { scaleX: 1, duration: 2.1, ease: 'power2.inOut' }, 0.6)
      .to(counter, { y: 2020, duration: 2.1, ease: 'power2.inOut', onUpdate: () => (yearEl.textContent = counter.y >= 2019.5 ? 'Today' : fmtYear(counter.y)) }, 0.6)
      .from('#skip', { opacity: 0, duration: 0.6 }, 0.8)
      .addLabel('out', 3.0)
      .to('.intro-inner', { opacity: 0, y: -30, filter: 'blur(8px)', duration: 0.8, ease: 'power2.in' }, 'out')
      .to('#intro', { opacity: 0, duration: 0.9, ease: 'power2.inOut' }, 'out+=0.35')
      .set('#intro', { display: 'none' })
      // chart reveal: time flows left → right
      .set(sweep, { opacity: 1 }, 'out+=0.5')
      .to(reveal, {
        p: 1, duration: 1.9, ease: 'power2.inOut',
        onUpdate: () => {
          chart.style.clipPath = `inset(0 ${(1 - reveal.p) * 100}% 0 0)`;
          revealP = reveal.p; dirty = true;
          sweep.style.transform = `translateX(${reveal.p * 1500}px)`;
        },
      }, 'out+=0.5')
      .to(sweep, { opacity: 0, duration: 0.5 }, '>-0.25')
      .fromTo(cam, { s: fitS * 0.86 }, { s: fitS, duration: 2.6, ease: 'expo.out', onUpdate: () => (dirty = true) }, 'out+=0.5')
      // UI chrome
      .add(() => { document.body.classList.remove('pre'); booted = true; }, 'out+=1.6')
      .fromTo('#ruler', { yPercent: -100, y: 0 }, { yPercent: 0, y: 0, duration: 0.9 }, 'out+=1.6')
      .fromTo('#rail', { xPercent: -100, x: 0 }, { xPercent: 0, x: 0, duration: 0.9 }, 'out+=1.7')
      .fromTo('.band .lbl > *', { opacity: 0, x: -24 }, { opacity: 1, x: 0, duration: 0.7, stagger: 0.03 }, 'out+=1.85')
      .fromTo(['#search', '#controls', '#minimap'], { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.8, stagger: 0.08 }, 'out+=2.0')
      .fromTo('.hs', { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.6, stagger: 0.05, ease: 'back.out(2.2)', clearProps: 'transform,scale' }, 'out+=2.2')
      .add(() => toast(innerWidth <= 760 ? 'Drag · pinch to zoom · ▶ for a tour' : 'Drag to explore · scroll or pinch to zoom · press T for a guided tour'), 'out+=2.6');

    tl.eventCallback('onUpdate', () => (dirty = true));

    introTl = tl;
    if (reduced || skipRequested || location.hash === '#skip') tl.progress(1);
  }

  /* ================================================================
     Boot
     ================================================================ */
  addEventListener('resize', () => { resize(); });
  document.addEventListener('fullscreenchange', () => setTimeout(resize, 50));

  resize();
  cam.x = CHART.size / 2; cam.y = CHART.size / 2; cam.s = fitS;
  requestAnimationFrame(frame);

  const loaded = Promise.all([baseReady, document.fonts ? document.fonts.ready : null]);
  Promise.race([loaded, new Promise((r) => setTimeout(r, 3500))]).then(() => {
    bandEls.forEach((b) => (b._lh = b._lbl.offsetHeight || 34));
    resize();
    intro();
    setTimeout(loadFull, 1200);
  });

  // debug helper
  window.__chrono = { cam, flyTo, flyToRect, openTour, state: () => ({ mode: MODE, full: fullState, tiles: tileCache.size, sMax }) };
})();
