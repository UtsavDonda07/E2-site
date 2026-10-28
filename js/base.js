// Base view: isometric country map, buildings, workers, camera, taps, placement and the battle layer.
(function () {
'use strict';
const E2 = window.E2;
const B = E2.BUILDINGS, A = E2.art;
const TW = A.TW, TH = A.TH, CLIFF = 14;
const $ = id => document.getElementById(id);

const canvas = $('baseCanvas'), ctx = canvas.getContext('2d');
let vw = 0, vh = 0, dpr = 1;
const cam = { x: 0, y: 0, z: 1 };
let minZ = 0.3, maxZ = 2.5;
let active = false, needsFit = true;
let placing = null;                 // { type, x, y }
let selectedUid = null;
let selectedCell = null;            // a selected tree or rock (tile index), if any
let floaters = [];                  // { text, wx, wy, t0 }
let decor = [];                     // static trees, rocks and bushes for this country
let workers = [];
let lastFrame = 0;
const pointers = new Map();
let gesture = null;
let raidSim = null, savedCam = null;

const dirty = () => {};             // the base redraws every frame while visible

// ---------- Camera ----------
// The screen area the land really covers (the land is a diagonal band inside its grid, so the grid's own box is too big).
function worldBounds() {
  const g = E2.state.grid();
  if (g._bounds) return g._bounds;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    if (!g.isLand(x, y)) continue;
    const p = A.iso(x, y);
    x0 = Math.min(x0, p.x - TW / 2); x1 = Math.max(x1, p.x + TW / 2); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y + TH + CLIFF);
  }
  return (g._bounds = { x0, x1, y0, y1 });
}

function resize() {
  const r = canvas.getBoundingClientRect();
  if (!r.width || !r.height) return;
  dpr = window.devicePixelRatio || 1;
  vw = r.width; vh = r.height;
  canvas.width = Math.round(vw * dpr); canvas.height = Math.round(vh * dpr);
  if (E2.state.get()) fitCamera(needsFit);
}

function fitCamera(reset) {
  const b = worldBounds();
  const fitAll = Math.min(vw / (b.x1 - b.x0 + 200), vh / (b.y1 - b.y0 + 300));
  minZ = Math.min(fitAll, 0.5) * 0.9;
  maxZ = 2.4;
  if (reset) {
    cam.z = Math.min(maxZ, Math.max(minZ, vw / (9 * TW)));
    const a = anchor(), c = A.iso(a.x, a.y);
    cam.x = c.x - vw / 2 / cam.z;
    cam.y = c.y - vh / 2 / cam.z - 20;
    // needsFit stays true until the player moves the map, so a late or changed window size refits the start view.
  }
  clampCam();
}

function clampCam() {
  const b = worldBounds(), m = 60;
  const cx = cam.x + vw / 2 / cam.z, cy = cam.y + vh / 2 / cam.z;
  const nx = Math.min(b.x1 + m, Math.max(b.x0 - m, cx)), ny = Math.min(b.y1 + m, Math.max(b.y0 - m, cy));
  cam.x = nx - vw / 2 / cam.z; cam.y = ny - vh / 2 / cam.z;
}

function zoomAt(sx, sy, factor) {
  needsFit = false;
  const wx = sx / cam.z + cam.x, wy = sy / cam.z + cam.y;
  cam.z = Math.min(maxZ, Math.max(minZ, cam.z * factor));
  cam.x = wx - sx / cam.z; cam.y = wy - sy / cam.z;
  clampCam();
}

const toWorld = (sx, sy) => ({ x: sx / cam.z + cam.x, y: sy / cam.z + cam.y });
const toTile = (sx, sy) => { const w = toWorld(sx, sy); return A.fromIso(w.x, w.y); };

// ---------- Hit testing ----------
function pointInPoly(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > py) !== (b.y > py) && px < (b.x - a.x) * (py - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
// Silhouette of a block: footprint diamond joined with its roof diamond.
function hull(type, x, y) {
  const s = B[type].size, h = A.H[type], o = A.iso(x, y);
  const P = (u, v, z) => ({ x: o.x + (u - v) * TW / 2, y: o.y + (u + v) * TH / 2 - z });
  return [P(0, 0, h), P(s, 0, h), P(s, 0, 0), P(s, s, 0), P(0, s, 0), P(0, s, h)];
}
function buildingAt(wx, wy) {
  const list = E2.state.get().buildings.slice().sort((a, b) => (b.x + b.y + B[b.type].size) - (a.x + a.y + B[a.type].size));
  for (const b of list) if (pointInPoly(wx, wy, hull(b.type, b.x, b.y))) return b;
  return null;
}
const bubbleSpot = b => { const s = B[b.type].size, c = A.iso(b.x + s / 2, b.y + s / 2); return { x: c.x, y: c.y - A.H[b.type] - 24 }; };

// ---------- Input ----------
const local = ev => { const r = canvas.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };

canvas.addEventListener('pointerdown', ev => {
  try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* some WebViews report touches without a capturable pointer */ }
  const p = local(ev);
  pointers.set(ev.pointerId, { x: p.x, y: p.y, sx: p.x, sy: p.y });
  gesture = { moved: pointers.size > 1, dist: pointers.size === 2 ? pinchDist() : 0, ghost: null };
  if (placing && pointers.size === 1) {              // grab the ghost to drag it
    const w = toWorld(p.x, p.y);
    if (pointInPoly(w.x, w.y, hull(placing.type, placing.x, placing.y))) {
      const t = toTile(p.x, p.y), s = B[placing.type].size;
      gesture.ghost = { ox: t.x - (placing.x + s / 2), oy: t.y - (placing.y + s / 2) };
    }
  }
});

canvas.addEventListener('pointermove', ev => {
  const ptr = pointers.get(ev.pointerId);
  if (!ptr) return;
  const p = local(ev);
  if (pointers.size === 1) {
    const dx = p.x - ptr.x, dy = p.y - ptr.y;
    if (!gesture.moved && Math.hypot(p.x - ptr.sx, p.y - ptr.sy) > 8) gesture.moved = true;
    if (gesture.moved) {
      if (gesture.ghost && placing) moveGhost(p.x, p.y, gesture.ghost);
      else { needsFit = false; cam.x -= dx / cam.z; cam.y -= dy / cam.z; clampCam(); }
    }
    ptr.x = p.x; ptr.y = p.y;
  } else if (pointers.size === 2) {
    ptr.x = p.x; ptr.y = p.y;
    const d = pinchDist();
    if (gesture.dist > 0 && d > 0) { const m = pinchMid(); zoomAt(m.x, m.y, d / gesture.dist); }
    gesture.dist = d; gesture.moved = true; gesture.ghost = null;
  }
});

function endPointer(ev, cancelled) {
  const ptr = pointers.get(ev.pointerId);
  if (!ptr) return;
  pointers.delete(ev.pointerId);
  if (!cancelled && gesture && !gesture.moved && pointers.size === 0) onTap(ptr.x, ptr.y);
  if (pointers.size === 0) gesture = null;
  else if (pointers.size === 1) { gesture.dist = 0; gesture.moved = true; }
}
canvas.addEventListener('pointerup', ev => endPointer(ev, false));
canvas.addEventListener('pointercancel', ev => endPointer(ev, true));
canvas.addEventListener('wheel', ev => { ev.preventDefault(); const p = local(ev); zoomAt(p.x, p.y, ev.deltaY < 0 ? 1.12 : 1 / 1.12); }, { passive: false });

const pinchDist = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
const pinchMid = () => { const [a, b] = [...pointers.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };

function setGhost(x, y) {
  const g = E2.state.grid(), s = B[placing.type].size;
  placing.x = Math.min(g.w - s, Math.max(0, x));
  placing.y = Math.min(g.h - s, Math.max(0, y));
  const why = E2.state.placeBlock(placing.type, placing.x, placing.y, 0, false, placing.uid);
  E2.ui.setPlaceValid(!why, why);
}
function moveGhost(sx, sy, grab) {
  const t = toTile(sx, sy), s = B[placing.type].size;
  setGhost(Math.round(t.x - grab.ox - s / 2), Math.round(t.y - grab.oy - s / 2));
}

// ---------- Taps ----------
function bubbleVisible(b) {
  const def = B[b.type];
  if (!def.produces || b.level < 1 || b.ruined || raidSim) return false;
  return b.stored >= Math.max(1, E2.holdCap(b.type, b.level) * 0.05);
}

function onTap(sx, sy) {
  const w = toWorld(sx, sy);

  if (raidSim) { const t = A.fromIso(w.x, w.y); E2.raidview.mapTap(t.x, t.y); return; }

  if (placing) {
    const t = A.fromIso(w.x, w.y), s = B[placing.type].size;
    setGhost(Math.round(t.x - s / 2), Math.round(t.y - s / 2));
    return;
  }

  for (const b of E2.state.get().buildings) {
    if (!bubbleVisible(b)) continue;
    const s = bubbleSpot(b);
    if (Math.hypot(w.x - s.x, w.y - s.y) <= 24) { E2.ui.collectOne(b.uid); return; }
  }

  const hit = buildingAt(w.x, w.y);
  if (hit) { select(hit.uid); return; }
  const ob = obstacleHit(w.x, w.y);
  if (ob) { selectObstacle(ob.cell); return; }
  E2.ui.closeSheet(); select(null);
}

function select(uid) {
  selectedUid = uid; selectedCell = null;
  E2.ui.onSelect(uid);
}
function selectObstacle(cell) {
  selectedCell = cell; selectedUid = null;
  E2.ui.closeSheet();
  E2.ui.onSelect(null);
}
// The selected tree or rock: { cell, tx, ty, kind } or null.
const selectedObstacle = () => selectedCell == null ? null : decor.find(d => d.obs && d.cell === selectedCell) || null;

// ---------- Placement ----------
function startPlacing(type) {
  const s = B[type].size, g = E2.state.grid();
  const c = toTile(vw / 2, vh / 2);
  let best = null, bd = Infinity;
  for (let y = 0; y <= g.h - s; y++) for (let x = 0; x <= g.w - s; x++) {
    if (!E2.state.canPlace(type, x, y)) continue;
    const d = (x + s / 2 - c.x) ** 2 + (y + s / 2 - c.y) ** 2;
    if (d < bd) { bd = d; best = { x, y }; }
  }
  placing = { type, x: best ? best.x : Math.round(c.x - s / 2), y: best ? best.y : Math.round(c.y - s / 2) };
  select(null);
  E2.ui.showPlaceBar(type);
  const why = E2.state.placeBlock(type, placing.x, placing.y);
  E2.ui.setPlaceValid(!why, why);
}
// Pick up a finished building and drop it somewhere else: the same ghost, drag and ✓ as building a new one.
function startMoving(uid) {
  const b = E2.state.byUid(uid), block = b ? E2.state.moveBlock(b) : 'Building not found.';
  if (block) return E2.ui.toast(block);
  placing = { type: b.type, x: b.x, y: b.y, uid, level: b.level };
  select(null);
  E2.ui.showPlaceBar(b.type, true);
  E2.ui.setPlaceValid(true);
}
function cancelPlacing() { placing = null; E2.ui.hidePlaceBar(); }
function confirmPlacing() {
  if (!placing) return;
  if (placing.uid) {
    const uid = placing.uid, r = E2.state.moveBuilding(uid, placing.x, placing.y);
    if (!r.ok) { E2.ui.toast(r.reason); return; }
    placing = null;
    E2.ui.hidePlaceBar();
    E2.ui.toast(`✅ ${B[r.b.type].name} moved and saved`);
    E2.sfx.play('build');
    select(uid);
    return;
  }
  const { type, x, y } = placing;
  const r = E2.state.startBuild(type, x, y);
  if (!r.ok) { E2.ui.toast(r.reason); return; }
  placing = null;
  E2.ui.hidePlaceBar();
  E2.ui.toast(`🔨 Building ${B[type].name}`);
  E2.sfx.play('build');
  E2.ui.afterChange();
  select(r.b.uid);
}

function floatText(text, b) {
  const s = bubbleSpot(b);
  floaters.push({ text, wx: s.x, wy: s.y, t0: performance.now() });
}

// ---------- Terrain and decor ----------
const GRASS = ['#79b24a', '#82ba52', '#72aa44', '#7eb64e'];

// The point the view is built around: the HQ at home, the capital city in a conquered country.
function anchor() {
  const hq = E2.state.hq(), g = E2.state.grid();
  if (hq) return { x: hq.x + B.hq.size / 2, y: hq.y + B.hq.size / 2 };
  const cap = E2.capitalSpot(E2.byId(E2.state.viewId()));
  if (cap) return { x: cap.x + 0.5, y: cap.y + 0.5 };
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (g.isLand(x, y)) { sx += x + 0.5; sy += y + 0.5; n++; }
  return { x: sx / n, y: sy / n };
}

// Scenery of the land being shown. Trees and rocks (d.obs) are real obstacles you can remove; bushes are only decoration.
function buildDecor() {
  const g = E2.state.grid(), seed = Array.from(E2.state.viewId()).reduce((a, c) => a * 31 + c.charCodeAt(0), 7) | 0;
  decor = [];
  const taken = new Set();
  for (const o of E2.state.visualObstacles()) {
    taken.add(o.cell);
    decor.push({ kind: o.kind, obs: true, tx: o.tx, ty: o.ty, x: o.tx + 0.5 + o.jx, y: o.ty + 0.5 + o.jy, k: o.k, v: o.v, cell: o.cell });
  }
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    const cell = y * g.w + x;
    if (!g.isLand(x, y) || taken.has(cell) || A.hash(x, y, seed + 20) > 0.04) continue;
    decor.push({ kind: 'bush', obs: false, tx: x, ty: y, x: x + 0.5 + (A.hash(x, y, seed + 2) - 0.5) * 0.5, y: y + 0.5 + (A.hash(x, y, seed + 3) - 0.5) * 0.5, k: 0.8 + 0.4 * A.hash(x, y, seed + 4), v: 0, cell });
  }
  decor.sort((a, b) => (a.x + a.y) - (b.x + b.y));
  for (const d of decor) { const p = A.iso(d.x, d.y); d.sx = p.x; d.sy = p.y; d.depth = d.x + d.y; }
  if (selectedCell != null && !decor.some(d => d.obs && d.cell === selectedCell)) selectedCell = null;
}

// The tree or rock under a point of the map (they are tall, so the test is a circle around the middle of the sprite).
function obstacleHit(wx, wy) {
  let best = null, bd = Infinity;
  for (const d of decor) {
    if (!d.obs) continue;
    const dx = wx - d.sx, dy = wy - (d.sy - 14 * d.k), r = 20 * d.k + 6, dd = dx * dx + dy * dy;
    if (dd < r * r && dd < bd) { bd = dd; best = d; }
  }
  return best;
}

function drawTerrain(g, view) {
  const hw = TW / 2, seedTint = 3;
  for (let d = 0; d <= g.w + g.h - 2; d++) {
    for (let x = Math.max(0, d - g.h + 1); x <= Math.min(g.w - 1, d); x++) {
      const y = d - x;
      if (!g.isLand(x, y)) continue;
      const p = A.iso(x, y);
      if (p.x < view.l - TW || p.x > view.r + TW || p.y < view.t - TH - CLIFF || p.y > view.b + TH) continue;
      const E = { x: p.x + hw, y: p.y + TH / 2 }, S = { x: p.x, y: p.y + TH }, W = { x: p.x - hw, y: p.y + TH / 2 };

      const landR = g.isLand(x + 1, y), landD = g.isLand(x, y + 1);
      if (!landR) A.poly(ctx, [E, S, { x: S.x, y: S.y + CLIFF }, { x: E.x, y: E.y + CLIFF }], '#6a4727');
      if (!landD) A.poly(ctx, [W, S, { x: S.x, y: S.y + CLIFF }, { x: W.x, y: W.y + CLIFF }], '#85613a');

      A.poly(ctx, [p, E, S, W], GRASS[Math.floor(A.hash(x, y, seedTint) * GRASS.length)], 'rgba(40,80,20,.10)', 1);
      if (cam.z > 0.4) {
        const h1 = A.hash(x, y, 11), h2 = A.hash(x, y, 12);
        ctx.strokeStyle = 'rgba(40,100,30,.35)'; ctx.lineWidth = 1.5; ctx.beginPath();
        ctx.moveTo(p.x - 10 + h1 * 20, p.y + 12 + h2 * 8); ctx.lineTo(p.x - 12 + h1 * 20, p.y + 8 + h2 * 8);
        ctx.moveTo(p.x - 4 + h2 * 14, p.y + 18 + h1 * 6); ctx.lineTo(p.x - 6 + h2 * 14, p.y + 14 + h1 * 6);
        ctx.stroke();
        if (h1 > 0.82) { ctx.fillStyle = h2 > 0.5 ? '#fff6a0' : '#ffd0e0'; ctx.fillRect(p.x - 6 + h2 * 12, p.y + 10 + h1 * 8, 2.5, 2.5); }
      }
      ctx.strokeStyle = 'rgba(255,255,255,.65)'; ctx.lineWidth = 2; ctx.beginPath();
      if (!g.isLand(x, y - 1)) { ctx.moveTo(p.x, p.y); ctx.lineTo(E.x, E.y); }
      if (!landR) { ctx.moveTo(E.x, E.y); ctx.lineTo(S.x, S.y); }
      if (!landD) { ctx.moveTo(S.x, S.y); ctx.lineTo(W.x, W.y); }
      if (!g.isLand(x - 1, y)) { ctx.moveTo(W.x, W.y); ctx.lineTo(p.x, p.y); }
      ctx.stroke();
    }
  }
}

// Where a harbor's ship floats: beside the first side of the footprint that has open water, as tile offsets from the corner.
// flip turns the ship to run along that side. East/south sides are drawn in front of the pier, west/north behind it.
const dockCache = new Map();
function dockOf(b) {
  const key = b.uid + ':' + b.x + ':' + b.y + ':' + E2.state.viewId();
  if (dockCache.has(key)) return dockCache.get(key);
  const g = E2.state.grid(), s = B[b.type].size, sea = (x, y) => !g.isLand(x, y);
  const sides = [
    { u: s + 0.7, v: s / 2, behind: false, flip: false, wet: i => sea(b.x + s, b.y + i) },
    { u: s / 2, v: s + 0.7, behind: false, flip: true, wet: i => sea(b.x + i, b.y + s) },
    { u: -0.7, v: s / 2, behind: true, flip: false, wet: i => sea(b.x - 1, b.y + i) },
    { u: s / 2, v: -0.7, behind: true, flip: true, wet: i => sea(b.x + i, b.y - 1) },
  ];
  let found = sides[0];
  for (const side of sides) if ([...Array(s).keys()].some(side.wet)) { found = side; break; }
  dockCache.set(key, found);
  return found;
}

function footprint(type, x, y, fill, stroke, lw) {
  const s = B[type].size, o = A.iso(x, y);
  A.poly(ctx, [o, { x: o.x + s * TW / 2, y: o.y + s * TH / 2 }, { x: o.x, y: o.y + s * TH }, { x: o.x - s * TW / 2, y: o.y + s * TH / 2 }], fill, stroke, lw);
}

// ---------- Workers ----------
const HUES = ['#2c6fd1', '#d2602a', '#2a9d4a'];
function updateWorkers(dt) {
  if (E2.state.inEnemyView()) { workers = []; return; }
  const S = E2.state.get(), g = E2.state.grid(), a = anchor();
  const n = Math.min(3, S.builders);
  while (workers.length < n) {
    workers.push({ x: a.x + workers.length * 0.4, y: a.y + 2.2, tx: null, ty: null, wait: 0, mode: 'walk', hue: HUES[workers.length % 3] });
  }
  // Where the builders are needed: next to every building under construction and every tree or rock being removed.
  const sites = S.buildings.filter(b => b.endAt).map(b => ({ x: b.x + B[b.type].size * 0.5, y: b.y + B[b.type].size + 0.35 }))
    .concat(E2.state.jobs().map(j => { const d = decor.find(q => q.obs && q.cell === j.cell); return d ? { x: d.tx + 0.5, y: d.ty + 1.25 } : null; }).filter(Boolean));
  workers.forEach((w, i) => {
    let tx = w.tx, ty = w.ty, onSite = false;
    if (sites.length) {
      const site = sites[i % sites.length];
      tx = site.x + (i % 2 ? 0.4 : -0.4); ty = site.y; onSite = true;
    } else if (tx == null || Math.hypot(tx - w.x, ty - w.y) < 0.15) {
      if (w.wait > 0) w.wait -= dt;
      else {
        for (let k = 0; k < 12; k++) {
          const cx = a.x + (Math.random() * 12 - 6), cy = a.y + (Math.random() * 12 - 6);
          const fx = Math.floor(cx), fy = Math.floor(cy);
          if (g.isLand(fx, fy) && !E2.state.occupant(fx, fy) && !E2.state.obstacleAt(fx, fy)) { tx = cx; ty = cy; break; }
        }
        w.wait = 1 + Math.random() * 2.5;
      }
    }
    w.tx = tx; w.ty = ty;
    if (tx == null) { w.mode = 'idle'; return; }
    const d = Math.hypot(tx - w.x, ty - w.y);
    if (d > 0.12) { const m = Math.min(d, 1.5 * dt); w.x += (tx - w.x) / d * m; w.y += (ty - w.y) / d * m; w.mode = 'walk'; }
    else w.mode = onSite ? 'hammer' : 'idle';
  });
}

// ---------- Overlays ----------
function roundPill(x, y, w, h, r, fill, stroke) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
}

function drawOverlays(b, now, wall) {
  const s = B[b.type].size, c = A.iso(b.x + s / 2, b.y + s / 2), top = c.y - A.H[b.type];
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

  if (b.endAt) {                                      // progress bar + countdown
    const total = b.endAt - b.startAt, left = Math.max(0, b.endAt - wall);
    ctx.font = '800 15px system-ui, sans-serif'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.8)';
    const txt = E2.fmtTime(left / 1000);
    ctx.strokeText(txt, c.x, top - 22); ctx.fillStyle = '#fff'; ctx.fillText(txt, c.x, top - 22);
    roundPill(c.x - 38, top - 14, 76, 11, 5, 'rgba(10,20,10,.85)', '#0b1408');
    roundPill(c.x - 36, top - 12, Math.max(6, 72 * (1 - left / total)), 7, 3, '#5fd04a');
    return;
  }
  if (bubbleVisible(b)) {                             // collect bubble
    const sp = bubbleSpot(b), bob = Math.sin(now / 280 + b.uid) * 2.5;
    const full = b.stored >= E2.holdCap(b.type, b.level) * 0.98;
    ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.beginPath(); ctx.ellipse(sp.x, sp.y + 30, 10, 3, 0, 0, Math.PI * 2); ctx.fill();
    roundPill(sp.x - 19, sp.y - 17 + bob, 38, 34, 10, '#fffdf4', '#6a5a3a');
    ctx.fillStyle = '#fffdf4'; ctx.beginPath(); ctx.moveTo(sp.x - 6, sp.y + 16 + bob); ctx.lineTo(sp.x, sp.y + 25 + bob); ctx.lineTo(sp.x + 6, sp.y + 16 + bob); ctx.fill();
    A.drawIcon(ctx, B[b.type].produces, sp.x, sp.y + bob, 26);
    if (full) {
      ctx.font = '800 13px system-ui, sans-serif';
      ctx.setLineDash([4, 3]); roundPill(sp.x - 24, sp.y - 44 + bob, 48, 20, 8, 'rgba(255,255,255,.92)', '#4a4a4a'); ctx.setLineDash([]);
      ctx.fillStyle = '#222'; ctx.fillText('Full!', sp.x, sp.y - 34 + bob);
    }
  }
  if (b.uid === selectedUid && !raidSim) {            // name tag
    const label = `${B[b.type].name}${b.level ? ' · Lv ' + b.level : ''}`;
    ctx.font = '800 14px system-ui, sans-serif';
    const w = ctx.measureText(label).width + 22, y = top - (bubbleVisible(b) ? 60 : 24);
    roundPill(c.x - w / 2, y - 12, w, 24, 12, 'rgba(14,22,34,.92)', '#e0b23c');
    ctx.fillStyle = '#fff'; ctx.fillText(label, c.x, y + 1);
  }
  if (b.level >= 1 && !b.ruined && cam.z > 0.35) {    // level stars under the building
    const fp = A.iso(b.x + s / 2, b.y + s);
    const n = Math.min(5, b.level), gap = 12;
    for (let i = 0; i < n; i++) A.drawIcon(ctx, 'star', fp.x + (i - (n - 1) / 2) * gap, fp.y + 6, 12);
  }
}

// Rings, name tags and removal progress for trees and rocks.
function drawObstacleOverlays(now, wall) {
  const ring = (tx, ty, fill, stroke) => { const p = A.iso(tx, ty); A.poly(ctx, [p, { x: p.x + TW / 2, y: p.y + TH / 2 }, { x: p.x, y: p.y + TH }, { x: p.x - TW / 2, y: p.y + TH / 2 }], fill, stroke, 3); };
  if (placing) {                                         // mark what is in the way of the building being placed
    const s = B[placing.type].size, om = E2.state;
    for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) if (om.obstacleAt(placing.x + dx, placing.y + dy)) ring(placing.x + dx, placing.y + dy, 'rgba(239,106,90,.35)', '#ef6a5a');
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const sel = selectedObstacle();
  if (sel) {
    ctx.save(); ctx.globalAlpha = 0.6 + 0.25 * Math.sin(now / 250); ring(sel.tx, sel.ty, 'rgba(255,255,255,.3)', '#fff'); ctx.restore();
    if (!E2.state.jobs().some(j => j.cell === sel.cell)) {   // while it is being removed the progress bar takes the tag's place
      const label = E2.OBSTACLE[sel.kind].name, y = sel.sy - 52 * sel.k;
      ctx.font = '800 14px system-ui, sans-serif';
      const w = ctx.measureText(label).width + 22;
      roundPill(sel.sx - w / 2, y - 12, w, 24, 12, 'rgba(14,22,34,.92)', '#e0b23c');
      ctx.fillStyle = '#fff'; ctx.fillText(label, sel.sx, y + 1);
    }
  }
  for (const j of E2.state.jobs()) {                     // a builder is removing it
    const d = decor.find(q => q.obs && q.cell === j.cell);
    if (!d) continue;
    const left = Math.max(0, j.endAt - wall), total = j.endAt - j.startAt, y = d.sy - 40 * d.k;
    ctx.font = '800 15px system-ui, sans-serif'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.8)';
    const txt = E2.fmtTime(left / 1000);
    ctx.strokeText(txt, d.sx, y - 12); ctx.fillStyle = '#fff'; ctx.fillText(txt, d.sx, y - 12);
    roundPill(d.sx - 30, y - 4, 60, 10, 5, 'rgba(10,20,10,.85)', '#0b1408');
    roundPill(d.sx - 28, y - 2, Math.max(6, 56 * (1 - left / total)), 6, 3, '#5fd04a');
  }
}

// ---------- Battle layer ----------
function bar(x, y, w, frac, color) {
  ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(x, y, w, 5);
  ctx.fillStyle = color; ctx.fillRect(x, y, w * Math.max(0, frac), 5);
}
function ring(cx, cy, r, fill, stroke, lw) {                 // a circle of radius r tiles, seen in iso
  const p = A.iso(cx, cy);
  ctx.beginPath(); ctx.ellipse(p.x, p.y, r * TW * 0.7071, r * TH * 0.7071, 0, 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 2; ctx.stroke(); }
}

const FLY_W = { jet: 50, drone: 42, missile: 15, satellite: 78 };      // on-screen width of each flyer's sprite
function drawRaid(sim) {
  const t = sim.t, mine = sim.mode === 'attack';
  if (mine) {                                            // no-landing zone around the enemy base
    const b = sim.bounds, pts = [A.iso(b.x0 - 1, b.y0 - 1), A.iso(b.x1 + 1, b.y0 - 1), A.iso(b.x1 + 1, b.y1 + 1), A.iso(b.x0 - 1, b.y1 + 1)];
    ctx.setLineDash([10, 8]);
    A.poly(ctx, pts, 'rgba(255,60,40,.08)', 'rgba(255,90,70,.7)', 3);
    ctx.setLineDash([]);
  }
  for (const b of sim.buildings) {
    if (b.alive && b.tower) ring(b.cx, b.cy, b.tower.range, null, b.tower.targets === 'air' ? 'rgba(120,200,255,.35)' : 'rgba(255,225,120,.3)', 2);
  }
  for (const b of sim.buildings) {
    if (!b.alive || b.hp >= b.maxHp) continue;
    const c = A.iso(b.cx, b.cy);
    bar(c.x - 22, c.y - A.H[b.type] - 12, 44, b.hp / b.maxHp, b.hp / b.maxHp > 0.4 ? '#5fd07a' : '#ef6a5a');
  }
  for (const s of sim.strikes) {
    const k = (t - s.armedAt) / (s.fireAt - s.armedAt);
    ctx.setLineDash([8, 6]);
    ring(s.x, s.y, (mine ? E2.RAID.bomb : E2.RAID.strike).radius * (1.1 - 0.1 * k), 'rgba(255,60,40,.12)', `rgba(255,80,60,${0.6 + 0.4 * Math.sin(t * 14)})`, 3);
    ctx.setLineDash([]);
    const p = A.iso(s.x, s.y); ctx.font = '26px system-ui, "Segoe UI Emoji", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('✈', p.x, p.y);
  }
  for (const u of sim.units) {
    if (!u.alive) continue;
    const p = A.iso(u.x, u.y), air = u.air, alt = u.type === 'satellite' ? 64 : air ? 26 : 0, y0 = p.y - alt;
    if (air) { ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.beginPath(); ctx.ellipse(p.x, p.y, u.type === 'satellite' ? 20 : 9, u.type === 'satellite' ? 8 : 4, 0, 0, Math.PI * 2); ctx.fill(); }
    const spr = A.unitSprite(u.type, mine);
    if (spr) {                                                        // flyers use the Kenney space sprites, nose toward where they are heading
      const w = FLY_W[u.type] || 40, k = w / spr.naturalWidth, h = spr.naturalHeight * k;
      ctx.save(); ctx.translate(p.x, y0);
      if (u.type === 'satellite') ctx.translate(0, Math.sin(t * 2 + u.id) * 2);
      else { const sx = ((u.vx || 0) - (u.vy || 0)) * 32, sy = ((u.vx || 0) + (u.vy || 0)) * 16; if (sx || sy) ctx.rotate(Math.atan2(sy, sx) + Math.PI / 2); }
      if (mine && (u.type === 'jet' || u.type === 'drone')) ctx.filter = 'hue-rotate(185deg) saturate(1.1)';   // the art is red: turn it blue for your side
      ctx.drawImage(spr, -w / 2, -h / 2, w, h);
      ctx.restore();
      if (u.hp < u.maxHp) bar(p.x - 12, y0 - Math.max(h, 24) / 2 - 8, 24, u.hp / u.maxHp, '#ef6a5a');
      if (u.ttl != null) bar(p.x - 12, y0 + h / 2 + 4, 24, u.ttl / (E2.UNITS[u.type].ttl || 1), '#e0b23c');     // time left in orbit
      continue;
    }
    ctx.save(); ctx.translate(p.x, y0); ctx.scale(1.5, 1.5);
    const col = mine ? { a: '#2f7fe0', b: '#1f4f9a', c: '#2a6bc0', d: '#3a8ae6' } : { a: '#d2403a', b: '#8a1f1a', c: '#b02a22', d: '#b03a6a' };
    ctx.fillStyle = col.a; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2;
    if (u.type === 'infantry') { ctx.beginPath(); ctx.arc(0, -5, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.fillRect(-3, -1, 6, 7); }
    else if (u.type === 'tank') { ctx.fillStyle = col.b; ctx.fillRect(-11, -8, 22, 12); ctx.strokeRect(-11, -8, 22, 12); ctx.fillStyle = col.c; ctx.fillRect(-6, -13, 12, 7); ctx.fillRect(2, -11, 12, 3); }
    else if (u.type === 'jet') { ctx.fillStyle = col.d; ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(10, 9); ctx.lineTo(0, 4); ctx.lineTo(-10, 9); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    else { ctx.fillStyle = '#ff9a2e'; ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(5, 0); ctx.lineTo(0, 8); ctx.lineTo(-5, 0); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    if (u.hp < u.maxHp) bar(-10, -22, 20, u.hp / u.maxHp, '#ef6a5a');
    ctx.restore();
  }
  for (const e of sim.effects) {
    const k = (t - e.t0) / e.life;
    if (e.kind === 'shot') {
      const a = A.iso(e.x1, e.y1), b2 = A.iso(e.x2, e.y2);
      ctx.strokeStyle = e.air ? `rgba(130,210,255,${1 - k})` : `rgba(255,230,120,${1 - k})`; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(a.x, a.y - 14); ctx.lineTo(b2.x, b2.y - (e.air ? 26 : 8)); ctx.stroke();
    } else if (e.kind === 'boom') {
      ring(e.x, e.y, e.r * (0.4 + 0.6 * k), `rgba(255,150,50,${0.6 * (1 - k)})`);
    } else if (e.kind === 'hit') {
      const p = A.iso(e.x, e.y); ctx.fillStyle = `rgba(255,255,255,${1 - k})`; ctx.beginPath(); ctx.arc(p.x, p.y - 14, 6 + 10 * k, 0, Math.PI * 2); ctx.fill();
    } else if (e.kind === 'beam') {                                   // a satellite's ray from orbit
      const a = A.iso(e.sx, e.sy), b2 = A.iso(e.x, e.y);
      ctx.lineCap = 'round';
      ctx.strokeStyle = `rgba(90,200,255,${0.55 * (1 - k)})`; ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(a.x, a.y - 64); ctx.lineTo(b2.x, b2.y - 10); ctx.stroke();
      ctx.strokeStyle = `rgba(255,255,255,${1 - k})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(a.x, a.y - 64); ctx.lineTo(b2.x, b2.y - 10); ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.fillStyle = `rgba(160,230,255,${0.7 * (1 - k)})`; ctx.beginPath(); ctx.arc(b2.x, b2.y - 10, 8 + 10 * k, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function setRaid(sim) {
  savedCam = { x: cam.x, y: cam.y, z: cam.z };
  needsFit = false;                                      // keep the battle view if the window changes
  raidSim = sim;
  select(null);
  const b = sim.bounds, M = 5;
  const corners = [A.iso(b.x0 - M, b.y0 - M), A.iso(b.x1 + M, b.y0 - M), A.iso(b.x1 + M, b.y1 + M), A.iso(b.x0 - M, b.y1 + M)];
  for (const p of sim.pending) corners.push(A.iso(p.x, p.y));        // frame the raiders' starting points too
  const xs = corners.map(c => c.x), ys = corners.map(c => c.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  cam.z = Math.max(Math.min(vw / (x1 - x0), vh / (y1 - y0)) * 0.92, vw / (22 * TW));
  minZ = Math.min(minZ, cam.z * 0.7);
  cam.x = (x0 + x1) / 2 - vw / 2 / cam.z; cam.y = (y0 + y1) / 2 - vh / 2 / cam.z;
}
function clearRaid() {
  raidSim = null;
  if (savedCam) { cam.x = savedCam.x; cam.y = savedCam.y; cam.z = savedCam.z; savedCam = null; }
  fitCamera(false);
}

// ---------- Frame ----------
function draw(now, dt) {
  const S = E2.state.get(), g = E2.state.grid(), wall = Date.now();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const sea = ctx.createLinearGradient(0, 0, 0, vh);
  sea.addColorStop(0, '#2f8bbd'); sea.addColorStop(1, '#1f6a98');
  ctx.fillStyle = sea; ctx.fillRect(0, 0, vw, vh);

  ctx.save();
  ctx.scale(cam.z, cam.z); ctx.translate(-cam.x, -cam.y);
  const view = { l: cam.x, t: cam.y, r: cam.x + vw / cam.z, b: cam.y + vh / cam.z };

  drawTerrain(g, view);

  if (placing) {                                        // faint grid while placing
    ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 1;
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
      if (!g.isLand(x, y)) continue;
      const p = A.iso(x, y);
      if (p.x < view.l - TW || p.x > view.r + TW || p.y < view.t - TH || p.y > view.b + TH) continue;
      A.poly(ctx, [p, { x: p.x + TW / 2, y: p.y + TH / 2 }, { x: p.x, y: p.y + TH }, { x: p.x - TW / 2, y: p.y + TH / 2 }], null, 'rgba(255,255,255,.22)', 1);
    }
  }

  // Scenery on a tile that has a building on it is not drawn (trees next to a building stay: they still block).
  const blocked = new Set();
  for (const b of S.buildings) {
    const s = B[b.type].size;
    for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) blocked.add((b.y + dy) * g.w + (b.x + dx));
  }

  const dyn = S.buildings.filter(b => !(placing && placing.uid === b.uid)).map(b => ({ depth: b.x + b.y + B[b.type].size, b }));   // a building being moved is drawn as the ghost
  for (const w of workers) dyn.push({ depth: w.x + w.y, w });
  dyn.sort((a, b) => a.depth - b.depth);

  let di = 0;
  const flushDecor = upTo => {
    for (; di < decor.length && decor[di].depth <= upTo; di++) {
      const d = decor[di];
      if (blocked.has(d.cell) || d.sx < view.l - 40 || d.sx > view.r + 40 || d.sy < view.t - 60 || d.sy > view.b + 40) continue;
      if (d.kind === 'tree') A.drawTree(ctx, d.sx, d.sy, d.k, d.v);
      else if (d.kind === 'rock') A.drawRock(ctx, d.sx, d.sy, d.k);
      else A.drawBush(ctx, d.sx, d.sy, d.k);
    }
  };
  for (const it of dyn) {
    flushDecor(it.depth);
    if (it.w) { const p = A.iso(it.w.x, it.w.y); A.drawWorker(ctx, p.x, p.y, now, it.w.mode === 'hammer' ? 'hammer' : it.w.mode === 'walk' ? 'walk' : 'idle', it.w.hue); continue; }
    const b = it.b, o = A.iso(b.x, b.y);
    if (b.uid === selectedUid && !raidSim) { ctx.save(); ctx.globalAlpha = 0.55 + 0.25 * Math.sin(now / 250); footprint(b.type, b.x, b.y, 'rgba(255,255,255,.35)', '#fff', 3); ctx.restore(); }
    const sb = raidSim && raidSim.byUid[b.uid];
    const brandNew = b.level === 0 && b.endAt;
    const dock = b.type === 'harbor' && b.level >= 1 && !b.ruined && !b.trip && !raidSim ? dockOf(b) : null;   // the trade ship waits at the pier
    const ship = () => { const p = A.iso(b.x + dock.u, b.y + dock.v); A.drawShip(ctx, b.level, p.x, p.y + Math.sin(now / 700 + b.uid) * 1.5, dock.flip); };
    if (dock && dock.behind) ship();
    A.drawBuilding(ctx, b.type, o.x, o.y, {
      t: now, level: brandNew ? b.upTo : b.level, ruined: b.ruined && !b.endAt || (sb && !sb.alive),
      progress: brandNew ? 1 - Math.max(0, b.endAt - wall) / (b.endAt - b.startAt) : null,
      upgrading: !!b.endAt && b.level > 0,
    });
    if (dock && !dock.behind) ship();
  }
  flushDecor(Infinity);

  for (const b of S.buildings) if (!(placing && placing.uid === b.uid)) drawOverlays(b, now, wall);
  if (!raidSim) drawObstacleOverlays(now, wall);

  if (placing) {
    const ok = !E2.state.placeBlock(placing.type, placing.x, placing.y, 0, false, placing.uid), o = A.iso(placing.x, placing.y);
    footprint(placing.type, placing.x, placing.y, ok ? 'rgba(95,208,122,.55)' : 'rgba(239,106,90,.6)', ok ? '#5fd07a' : '#ef6a5a', 3);
    A.drawBuilding(ctx, placing.type, o.x, o.y, { t: now, level: placing.level || 1, alpha: 0.85 });
    positionPlacePop();
  }
  if (raidSim) drawRaid(raidSim);
  ctx.restore();

  floaters = floaters.filter(f => now - f.t0 < 1200);
  for (const f of floaters) {
    const k = (now - f.t0) / 1200, sx = (f.wx - cam.x) * cam.z, sy = (f.wy - cam.y) * cam.z - k * 40;
    ctx.globalAlpha = 1 - k; ctx.font = '800 20px system-ui, "Segoe UI Emoji", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.strokeText(f.text, sx, sy);
    ctx.fillStyle = '#ffe28a'; ctx.fillText(f.text, sx, sy); ctx.globalAlpha = 1;
  }
}

// The ✕ / ✓ buttons float on the building being placed; below it when there is no room above.
function positionPlacePop() {
  const pop = $('placePop');
  if (!pop || !placing) return;
  const s = B[placing.type].size, top = A.iso(placing.x, placing.y), bot = A.iso(placing.x + s, placing.y + s);
  const x = Math.min(vw - 70, Math.max(70, (top.x - cam.x) * cam.z));
  let y = (top.y + s * TH / 2 - 18 - 20 * s - cam.y) * cam.z, below = false;
  if (y < 190) { y = (bot.y + 8 - cam.y) * cam.z; below = true; }
  pop.style.left = x + 'px'; pop.style.top = y + 'px';
  pop.classList.toggle('below', below);
}

function frame(now) {
  requestAnimationFrame(frame);
  if (!active || !vw || !E2.state.get()) return;
  const dt = Math.min(0.1, (now - lastFrame) / 1000 || 0.016);
  lastFrame = now;
  updateWorkers(dt);
  draw(now, dt);
}

function enter() {
  placing = null; selectedUid = null; selectedCell = null; needsFit = true; workers = [];
  $('screenBase').classList.remove('hidden');
  active = true;
  buildDecor();
  resize();
  requestAnimationFrame(() => resize());
}

function leave() { active = false; select(null); $('screenBase').classList.add('hidden'); }

window.addEventListener('resize', resize);
requestAnimationFrame(frame);

E2.base = {
  enter, leave, resize, dirty, select, floatText, setRaid, clearRaid,
  startPlacing, startMoving, cancelPlacing, confirmPlacing, isPlacing: () => !!placing,
  selected: () => selectedUid,
  selectedObstacle, refreshDecor: buildDecor, ghost: () => placing && { type: placing.type, x: placing.x, y: placing.y },
  // For tests: where a tree or rock is on screen (canvas pixels), and which obstacles are visible now.
  screenOfObstacle: cell => { const d = decor.find(q => q.obs && q.cell === cell); return d ? { x: (d.sx - cam.x) * cam.z, y: (d.sy - 14 * d.k - cam.y) * cam.z } : null; },
  visibleObstacles: () => decor.filter(d => d.obs && ((d.sx - cam.x) * cam.z) > 20 && ((d.sx - cam.x) * cam.z) < vw - 20 && ((d.sy - cam.y) * cam.z) > 160 && ((d.sy - cam.y) * cam.z) < vh - 220).map(d => d.cell),
};
})();
