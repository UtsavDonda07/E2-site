// Isometric drawing: projection, procedural building/decor/worker painters and the sprite hook.
// Any building can be replaced by a PNG: list it in www/art/manifest.js (see www/art/README.md).
(function () {
'use strict';
const E2 = window.E2;
const B = E2.BUILDINGS;
const TW = 64, TH = 32;                       // one tile = a 64x32 diamond

const iso = (x, y) => ({ x: (x - y) * TW / 2, y: (x + y) * TH / 2 });
const fromIso = (sx, sy) => { const a = sx / (TW / 2), b = sy / (TH / 2); return { x: (a + b) / 2, y: (b - a) / 2 }; };

const hash = E2.hash;                         // same numbers the game rules use to place obstacles (see defs.js)

// ---------- Low-level helpers ----------
function poly(ctx, pts, fill, stroke, lw) {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1.2; ctx.lineJoin = 'round'; ctx.stroke(); }
}
const frame = (ox, oy) => (u, v, z = 0) => ({ x: ox + (u - v) * TW / 2, y: oy + (u + v) * TH / 2 - z });

// Axis-aligned block in footprint coordinates; z0 = base height, h = height (pixels).
function box(ctx, P, u0, v0, u1, v1, h, z0, c) {
  const line = c.line || 'rgba(0,0,0,.35)';
  poly(ctx, [P(u0, v1, z0), P(u1, v1, z0), P(u1, v1, z0 + h), P(u0, v1, z0 + h)], c.left, line);
  poly(ctx, [P(u1, v1, z0), P(u1, v0, z0), P(u1, v0, z0 + h), P(u1, v1, z0 + h)], c.right, line);
  poly(ctx, [P(u0, v0, z0 + h), P(u1, v0, z0 + h), P(u1, v1, z0 + h), P(u0, v1, z0 + h)], c.top, line);
}

// Upright cylinder centred at (u,v).
function cylinder(ctx, P, u, v, r, h, z0, c) {
  const p = P(u, v, z0), rx = r * TW * 0.7071, ry = r * TH * 0.7071;
  const g = ctx.createLinearGradient(p.x - rx, 0, p.x + rx, 0);
  g.addColorStop(0, c.light); g.addColorStop(0.55, c.mid); g.addColorStop(1, c.dark);
  ctx.beginPath();
  ctx.moveTo(p.x - rx, p.y - h);
  ctx.lineTo(p.x - rx, p.y);
  ctx.ellipse(p.x, p.y, rx, ry, 0, Math.PI, 0, true);
  ctx.lineTo(p.x + rx, p.y - h);
  ctx.closePath();
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.beginPath(); ctx.ellipse(p.x, p.y - h, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = c.top; ctx.fill(); ctx.stroke();
}

function slab(ctx, P, s, color, edge) {
  const a = 0.08, b = s - 0.08, d = 4;
  poly(ctx, [P(a, b, 0), P(b, b, 0), P(b, b, d), P(a, b, d)], edge, 'rgba(0,0,0,.3)');
  poly(ctx, [P(b, b, 0), P(b, a, 0), P(b, a, d), P(b, b, d)], edge, 'rgba(0,0,0,.3)');
  poly(ctx, [P(a, a, d), P(b, a, d), P(b, b, d), P(a, b, d)], color, 'rgba(0,0,0,.3)');
}

function circle(ctx, x, y, r, fill, stroke) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill; ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
}

function smoke(ctx, x, y, t, n = 3) {
  for (let i = 0; i < n; i++) {
    const k = ((t / 1600 + i / n) % 1);
    ctx.globalAlpha = 0.45 * (1 - k);
    circle(ctx, x + Math.sin(k * 5 + i) * 4 + k * 8, y - k * 34, 4 + k * 7, '#d8dde3');
  }
  ctx.globalAlpha = 1;
}

// ---------- Building painters (footprint coordinates 0..s) ----------
const PAINT = {};
const H = { hq: 70, goldMine: 34, oilRefinery: 44, steelMill: 56, vault: 48, gunTurret: 22, missileBattery: 36, antiAir: 46, barracks: 40, researchLab: 56, farm: 40, house: 40, village: 50, city: 80 };

PAINT.hq = (ctx, P, s, L, t) => {
  slab(ctx, P, s, '#8a8f96', '#686d74');
  box(ctx, P, 0.45, 0.45, 2.55, 2.55, 34, 4, { top: '#3e4c60', left: '#6f8db8', right: '#57749f' });
  poly(ctx, [P(0.75, 0.75, 38), P(2.25, 0.75, 38), P(2.25, 2.25, 38), P(0.75, 2.25, 38)], '#2f3b4a', 'rgba(0,0,0,.4)');
  for (const [a, b] of [[0.85, 1.3], [1.7, 2.15]]) {
    poly(ctx, [P(a, 2.55, 14), P(b, 2.55, 14), P(b, 2.55, 26), P(a, 2.55, 26)], '#ffd96b');
    poly(ctx, [P(2.55, a, 14), P(2.55, b, 14), P(2.55, b, 26), P(2.55, a, 26)], '#ffd96b');
  }
  box(ctx, P, 1.1, 1.1, 1.9, 1.9, 18 + 6 * L, 38, { top: '#f0c24a', left: '#d3a232', right: '#b0841f' });
  const top = P(1.5, 1.5, 56 + 6 * L);
  ctx.strokeStyle = '#33281a'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(top.x, top.y - 24); ctx.stroke();
  const w = Math.sin(t / 180) * 3;
  poly(ctx, [{ x: top.x, y: top.y - 24 }, { x: top.x + 15, y: top.y - 20 + w }, { x: top.x, y: top.y - 13 }], '#e5382d', 'rgba(0,0,0,.4)');
  smoke(ctx, P(2.1, 0.8, 38).x, P(2.1, 0.8, 38).y, t, 2);
};

PAINT.goldMine = (ctx, P, s, L, t) => {
  slab(ctx, P, s, '#8c7a58', '#6b5c42');
  box(ctx, P, 0.25, 0.25, 1.25, 1.1, 18, 4, { top: '#8a5a2b', left: '#a5733a', right: '#85572b' });
  poly(ctx, [P(0.45, 1.1, 4), P(1.05, 1.1, 4), P(1.05, 1.1, 14), P(0.45, 1.1, 14)], '#1d1812');
  ctx.strokeStyle = '#5b3a1a'; ctx.lineWidth = 3;
  for (const v of [0.35, 1.0]) { const a = P(1.55, v, 4), b = P(1.55, v, 26); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
  const a = P(1.55, 0.35, 26), b = P(1.55, 1.0, 26); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  for (let i = 0; i < 3 + L * 2; i++) {
    const p = P(1.3 + (i % 3) * 0.2 + (i > 4 ? 0.1 : 0), 1.35 + Math.floor(i / 3) * 0.14, 4 + (i > 4 ? 6 : 0));
    circle(ctx, p.x, p.y - 3, 5, '#f5c428', '#8a5a05'); circle(ctx, p.x - 1.5, p.y - 5, 1.6, '#fff3a0');
  }
};

PAINT.oilRefinery = (ctx, P, s, L, t) => {
  slab(ctx, P, s, '#53585f', '#3d4147');
  const tank = { light: '#9aa3ad', mid: '#6d7681', dark: '#454c55', top: '#b6bec7' };
  cylinder(ctx, P, 0.65, 1.3, 0.42, 26, 4, tank);
  cylinder(ctx, P, 1.35, 0.65, 0.42, 22 + L * 2, 4, tank);
  box(ctx, P, 0.9, 0.95, 1.1, 1.05, 5, 12, { top: '#c0392b', left: '#a52f23', right: '#8b261b' });
  box(ctx, P, 1.5, 1.45, 1.62, 1.57, 36, 4, { top: '#7d838c', left: '#656b73', right: '#50555c' });
  const f = P(1.56, 1.51, 40), k = 0.8 + 0.2 * Math.sin(t / 90);
  ctx.fillStyle = '#ff7a1a'; ctx.beginPath(); ctx.ellipse(f.x, f.y - 5 * k, 4, 8 * k, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffd24a'; ctx.beginPath(); ctx.ellipse(f.x, f.y - 3 * k, 2, 4 * k, 0, 0, Math.PI * 2); ctx.fill();
};

PAINT.steelMill = (ctx, P, s, L, t) => {
  slab(ctx, P, s, '#6b6f75', '#4c5056');
  box(ctx, P, 0.2, 0.45, 1.75, 1.7, 24, 4, { top: '#7a6f66', left: '#8a8f98', right: '#6c717a' });
  for (const [u0, u1] of [[0.25, 0.95], [1.0, 1.7]]) {   // sawtooth roof
    poly(ctx, [P(u0, 0.45, 28), P(u1, 0.45, 28), P(u1, 1.7, 28), P(u0, 1.7, 28)], '#5d4f47', 'rgba(0,0,0,.35)');
    poly(ctx, [P(u0, 1.7, 28), P(u1, 1.7, 28), P(u1, 1.7, 40), P(u0, 1.7, 40 - 4)], '#aab2bd', 'rgba(0,0,0,.35)');
  }
  poly(ctx, [P(0.5, 1.7, 4), P(1.4, 1.7, 4), P(1.4, 1.7, 15), P(0.5, 1.7, 15)], '#ff9a2e');
  cylinder(ctx, P, 1.55, 0.45, 0.17, 34, 28, { light: '#b4624a', mid: '#8f4a37', dark: '#6a3527', top: '#3a1f18' });
  const c = P(1.55, 0.45, 66); smoke(ctx, c.x, c.y, t, 4);
};

PAINT.vault = (ctx, P, s, L, t) => {
  slab(ctx, P, s, '#8d9097', '#6a6d74');
  box(ctx, P, 0.3, 0.3, 1.7, 1.7, 22, 4, { top: '#9aa6b8', left: '#b8c3d3', right: '#8e9bb0' });
  poly(ctx, [P(0.7, 1.7, 4), P(1.3, 1.7, 4), P(1.3, 1.7, 17), P(0.7, 1.7, 17)], '#2f3b4d', 'rgba(0,0,0,.4)');
  circle(ctx, P(1.0, 1.7, 10).x, P(1.0, 1.7, 10).y, 3, '#f5c428', '#6e4106');
  const c = P(1.0, 1.0, 26), g = ctx.createRadialGradient(c.x - 6, c.y - 12, 2, c.x, c.y - 6, 26);
  g.addColorStop(0, '#fff3a0'); g.addColorStop(0.5, '#f5c428'); g.addColorStop(1, '#a96c0a');
  ctx.beginPath(); ctx.ellipse(c.x, c.y, 24, 12, 0, Math.PI, 0); ctx.ellipse(c.x, c.y, 24, 12, 0, 0, Math.PI, true);
  ctx.beginPath(); ctx.moveTo(c.x - 24, c.y); ctx.bezierCurveTo(c.x - 24, c.y - 30, c.x + 24, c.y - 30, c.x + 24, c.y);
  ctx.ellipse(c.x, c.y, 24, 12, 0, 0, Math.PI); ctx.closePath();
  ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = '#6e4106'; ctx.lineWidth = 1.5; ctx.stroke();
};

PAINT.gunTurret = (ctx, P, s, L, t) => {
  slab(ctx, P, s, '#7b7f85', '#585c62');
  cylinder(ctx, P, 0.5, 0.5, 0.34, 7, 4, { light: '#9aa0a8', mid: '#757b84', dark: '#555a62', top: '#a9b0b9' });
  box(ctx, P, 0.3, 0.3, 0.7, 0.7, 7, 11, { top: '#6b4a3a', left: '#7e5a47', right: '#5f4132' });
  const a = P(0.5, 0.5, 15), b = P(0.98, 0.98, 18);
  ctx.strokeStyle = '#2a2e33'; ctx.lineWidth = 3 + (L > 1 ? 1 : 0); ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.lineCap = 'butt';
};

PAINT.missileBattery = (ctx, P, s, L, t) => {
  slab(ctx, P, s, '#6f7a68', '#4f5949');
  box(ctx, P, 0.35, 0.35, 1.65, 1.65, 8, 4, { top: '#4a5a3a', left: '#5e7049', right: '#4a5a3a' });
  for (const off of [-0.18, 0.18]) {
    const a = P(0.7 + off, 1.3 - off, 12), b = P(1.35 + off, 0.65 - off, 34);
    ctx.strokeStyle = '#2d3426'; ctx.lineWidth = 9; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.strokeStyle = '#8a9a78'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    circle(ctx, b.x, b.y, 4, '#e5382d', '#5a1410'); ctx.lineCap = 'butt';
  }
};

PAINT.antiAir = (ctx, P, s, L, t) => {
  slab(ctx, P, s, '#667381', '#48525e');
  box(ctx, P, 0.3, 0.9, 1.2, 1.7, 12, 4, { top: '#3a4f6a', left: '#4b6788', right: '#3a5273' });
  box(ctx, P, 0.9, 0.9, 1.1, 1.1, 22, 16, { top: '#8a97a6', left: '#7b8896', right: '#66727f' });
  const c = P(1.0, 1.0, 40), sx = Math.abs(Math.cos(t / 500)) * 0.85 + 0.15;
  ctx.fillStyle = '#d3dae2'; ctx.strokeStyle = '#4a5560'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.ellipse(c.x, c.y, 16 * sx, 11, -0.4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  circle(ctx, c.x, c.y, 2.5, '#e5382d');
};

PAINT.barracks = (ctx, P, s, L, t) => {
  slab(ctx, P, s, '#7f7a62', '#5c5846');
  box(ctx, P, 0.2, 0.25, 1.8, 1.0, 16, 4, { top: '#46563a', left: '#6b7d4e', right: '#556640' });
  for (const u of [0.45, 0.95, 1.4]) poly(ctx, [P(u, 1.0, 8), P(u + 0.2, 1.0, 8), P(u + 0.2, 1.0, 15), P(u, 1.0, 15)], '#26301f');
  box(ctx, P, 0.3, 1.2, 0.9, 1.75, 11, 4, { top: '#7d8a5c', left: '#8f9d68', right: '#707c52' });      // tent
  box(ctx, P, 1.1, 1.3, 1.7, 1.8, 6, 4, { top: '#9a8a5a', left: '#b09d66', right: '#8a7a50' });         // sandbags
  const top = P(1.7, 0.3, 20);
  ctx.strokeStyle = '#33281a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(top.x, top.y - 20); ctx.stroke();
  poly(ctx, [{ x: top.x, y: top.y - 20 }, { x: top.x + 12, y: top.y - 16 + Math.sin(t / 180) * 2 }, { x: top.x, y: top.y - 10 }], '#e5382d', 'rgba(0,0,0,.4)');
};

PAINT.researchLab = (ctx, P, s, L, t) => {
  slab(ctx, P, s, '#7a8590', '#56606a');
  box(ctx, P, 0.25, 0.25, 1.75, 1.75, 26, 4, { top: '#cfd8e3', left: '#e4ebf3', right: '#b9c4d1' });
  poly(ctx, [P(0.5, 1.75, 12), P(1.5, 1.75, 12), P(1.5, 1.75, 22), P(0.5, 1.75, 22)], '#5ec8ff', 'rgba(0,0,0,.35)');
  poly(ctx, [P(1.75, 0.5, 12), P(1.75, 1.5, 12), P(1.75, 1.5, 22), P(1.75, 0.5, 22)], '#4aa8e0', 'rgba(0,0,0,.35)');
  const c = P(1.0, 1.0, 34), sx = Math.abs(Math.cos(t / 700)) * 0.8 + 0.2;
  ctx.strokeStyle = '#4a5560'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(c.x, c.y + 4); ctx.lineTo(c.x, c.y - 4); ctx.stroke();
  ctx.fillStyle = '#e8eef5'; ctx.beginPath(); ctx.ellipse(c.x, c.y - 6, 13 * sx, 8, -0.3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  const glow = 0.5 + 0.5 * Math.sin(t / 400);
  ctx.fillStyle = `rgba(120,255,200,${0.4 + 0.4 * glow})`; circle(ctx, c.x, c.y - 6, 3, ctx.fillStyle);
};

// The harbor's own picture is in art/manifest.js; this is what shows until it has loaded.
PAINT.harbor = (ctx, P, s, L, t) => {
  slab(ctx, P, s, '#9b7a4c', '#6e5533');
  box(ctx, P, 0.2, 0.2, 1.8, 1.8, 6, 4, { top: '#b58b55', left: '#9b7444', right: '#7d5c33' });
  box(ctx, P, 0.35, 0.4, 0.95, 1.0, 22, 6, { top: '#d9533f', left: '#c24632', right: '#9d3626' });
  box(ctx, P, 1.0, 0.9, 1.65, 1.5, 18, 6, { top: '#4f86d9', left: '#3f70bd', right: '#335b99' });
};
H.harbor = 42;
// The country buildings are drawn from pictures (art/manifest.js); this block shows until they have loaded.
for (const [type, wall, roof] of [['farm', '#8b623a', '#6a8a2f'], ['house', '#b04a3a', '#e0604a'], ['village', '#c07a4a', '#e0604a'], ['city', '#a8adb8', '#6c7280']]) {
  PAINT[type] = (ctx, P, s) => {
    slab(ctx, P, s, '#8a8070', '#645c4f');
    box(ctx, P, 0.2, 0.2, s - 0.2, s - 0.2, H[type] * 0.7, 4, { top: roof, left: wall, right: wall });
  };
}

// ---------- Trade ships (Kenney "Watercraft Kit", CC0), rendered by tools/render-models.html ----------
const SHIP_AY = { 'ship-small': 0.6937, 'ship-cargo': 0.6197, 'ship-liner': 0.6454 };   // where the waterline centre sits in each picture
const shipImgs = {};
// Draws the ship for a harbor level (1..3) with its water-line centre at (x, y). flip mirrors it to sail the other way.
function drawShip(ctx, tier, x, y, flip, alpha, k = 1) {
  const name = E2.TRADE.ship[Math.min(3, Math.max(1, tier)) - 1];
  if (!shipImgs[name]) { const im = new Image(); im.onload = () => E2.base && E2.base.dirty(); im.src = `art/rendered/${name}.png`; shipImgs[name] = im; }
  const im = shipImgs[name];
  if (!im.complete || !im.naturalWidth) return false;
  const w = im.naturalWidth * 0.5 * k, h = im.naturalHeight * 0.5 * k;
  ctx.save();
  ctx.globalAlpha = alpha == null ? 1 : alpha;
  ctx.translate(x, y);
  if (flip) ctx.scale(-1, 1);
  ctx.fillStyle = 'rgba(10,40,70,.22)'; ctx.beginPath(); ctx.ellipse(0, 2, w * 0.3, h * 0.1, 0, 0, Math.PI * 2); ctx.fill();     // soft shadow on the water
  ctx.drawImage(im, -w / 2, -h * SHIP_AY[name], w, h);
  ctx.restore();
  return true;
}

// ---------- Defence towers built from stone blocks (Kenney "Tower Defense" isometric tiles, CC0) ----------
// Level 1 sand-coloured blocks, level 2 grey, level 3 red: the tower looks stronger as it grows.
const blockImgs = {};
function blockImg(n) {
  if (!blockImgs[n]) { const im = new Image(); im.onload = () => E2.base && E2.base.dirty(); im.src = `art/towers/${n}.png`; blockImgs[n] = im; }
  const im = blockImgs[n];
  return im.complete && im.naturalWidth ? im : null;
}
// One block standing at footprint position (u,v) at height z; scale 1 = exactly one tile wide.
function block(ctx, P, u, v, z, name, scale) {
  const im = blockImg(name);
  if (!im) return false;
  const k = scale * 64 / 79, w = im.naturalWidth * k, h = im.naturalHeight * k, c = P(u, v, z);
  ctx.drawImage(im, c.x - w / 2, c.y - h * (1 - im.naturalWidth / 4 / im.naturalHeight), w, h);   // the picture's ground point is a quarter of its width above its bottom
  return true;
}
const TOWER_BLOCKS = {
  gunTurret:      { main: ['t74', 't134', 't177'] },
  missileBattery: { wall: ['t72', 't120', 't174'], main: ['t99', 't154', 't197'] },
  antiAir:        { wall: ['t72', 't120', 't174'], main: ['t94', 't160', 't203'] },
};
for (const type of Object.keys(TOWER_BLOCKS)) {
  const drawn = PAINT[type], set = TOWER_BLOCKS[type];
  PAINT[type] = (ctx, P, s, L, t) => {
    const i = Math.min(L, 3) - 1;
    if (!set.wall) { if (block(ctx, P, 0.5, 0.5, 0, set.main[i], 1)) return; }          // 1x1 tower: a single block
    else if (blockImg(set.wall[i]) && blockImg(set.main[i])) {                           // 2x2: a wall of four blocks with a taller one on top
      for (const [u, v] of [[0.5, 0.5], [1.5, 0.5], [0.5, 1.5], [1.5, 1.5]]) block(ctx, P, u, v, 0, set.wall[i], 1);
      block(ctx, P, 1, 1, 21, set.main[i], 1.25);
      return;
    }
    drawn(ctx, P, s, L, t);                                                              // pictures not loaded yet: use the drawn tower
  };
}
H.gunTurret = 44; H.missileBattery = 78; H.antiAir = 84;

// ---------- Construction, ruins, sprites ----------
const sprites = {};                          // type -> { img, ax, ay, scale, dx, dy }
function loadSprites() {
  const m = window.E2_SPRITES || {};
  for (const [type, o] of Object.entries(m)) {
    const img = new Image();
    img.onload = () => {
      sprites[type] = Object.assign({ ax: 0.5, ay: 0.9, scale: 1, dx: 0, dy: 0 }, o, { img });
      if (o.h) H[type] = o.h;                                  // a taller picture needs a taller tap area, label and progress bar
      if (E2.base) E2.base.dirty();
    };
    img.src = o.src;
  }
}

function scaffold(ctx, P, s, h) {
  ctx.strokeStyle = '#a8763a'; ctx.lineWidth = 2;
  const corners = [[0, 0], [s, 0], [s, s], [0, s]];
  for (const [u, v] of corners) { const a = P(u, v, 0), b = P(u, v, h); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
  for (const z of [h * 0.5, h]) {
    ctx.beginPath(); corners.forEach(([u, v], i) => { const p = P(u, v, z); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.closePath(); ctx.stroke();
  }
  const a = P(0, s, 0), b = P(s, s, h * 0.5); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
}

function ruins(ctx, P, s, t) {
  slab(ctx, P, s, '#4d4843', '#363230');
  const pieces = [[0.3, 0.4, 0.5, 0.4, 9], [0.9, 0.3, 0.6, 0.5, 14], [0.4, 1.0, 0.5, 0.5, 7]];
  for (const [u, v, w, d, hh] of pieces) {
    if (u + w > s || v + d > s) continue;
    box(ctx, P, u, v, u + w, v + d, hh, 4, { top: '#6a625a', left: '#58514a', right: '#463f39' });
  }
  const f = P(s / 2, s / 2, 12), k = 0.8 + 0.25 * Math.sin(t / 110);
  ctx.fillStyle = '#ff6a1a'; ctx.beginPath(); ctx.ellipse(f.x, f.y - 6 * k, 6, 11 * k, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffd24a'; ctx.beginPath(); ctx.ellipse(f.x, f.y - 4 * k, 3, 6 * k, 0, 0, Math.PI * 2); ctx.fill();
}

// Draws a building whose footprint corner (0,0) sits at screen (ox, oy).
// opts: { t, alpha, level, progress (0..1 for a brand-new build), ruined, upgrading }
function drawBuilding(ctx, type, ox, oy, opts) {
  const def = B[type], s = def.size, P = frame(ox, oy), t = opts.t || 0;
  ctx.save();
  ctx.globalAlpha = opts.alpha == null ? 1 : opts.alpha;
  if (opts.ruined) { ruins(ctx, P, s, t); ctx.restore(); return; }

  const sp = sprites[type];
  const L = Math.max(1, opts.level || 1);
  const draw = () => {
    if (sp) {
      const c = P(s / 2, s / 2, 0), w = sp.img.width * sp.scale, h = sp.img.height * sp.scale;
      ctx.drawImage(sp.img, c.x - w * sp.ax + sp.dx, c.y - h * sp.ay + sp.dy, w, h);
    } else PAINT[type](ctx, P, s, L, t);
  };

  if (opts.progress != null && opts.progress < 1) {          // new build: rises from the ground
    slab(ctx, P, s, '#8a8070', '#645c4f');
    const bottom = P(s, s, 0).y, top = P(0, 0, H[type] + 30).y;
    ctx.save();
    ctx.beginPath(); ctx.rect(ox - 400, bottom - (bottom - top) * Math.max(0.12, opts.progress), 800, 800); ctx.clip();
    draw();
    ctx.restore();
    scaffold(ctx, P, s, H[type] * 0.9);
  } else {
    draw();
    if (opts.upgrading) scaffold(ctx, P, s, H[type] * 0.9);
  }
  ctx.restore();
}

// ---------- Decor and people ----------
function drawTree(ctx, x, y, k, v) {
  ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.ellipse(x + 3, y + 1, 11 * k, 5 * k, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#5b3a1f'; ctx.fillRect(x - 2 * k, y - 8 * k, 4 * k, 9 * k);
  const g = ['#2f6b34', '#3a8040', '#4a9a4c'];
  for (let i = 0; i < 3; i++) {
    const yy = y - (8 + i * 11) * k, w = (16 - i * 3.5) * k;
    poly(ctx, [{ x, y: yy - 15 * k }, { x: x + w, y: yy }, { x: x - w, y: yy }], v > 0.5 ? g[i] : ['#2a6130', '#35763a', '#44904a'][i], 'rgba(0,0,0,.25)');
  }
}
function drawRock(ctx, x, y, k) {
  ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.ellipse(x + 2, y + 1, 12 * k, 5 * k, 0, 0, Math.PI * 2); ctx.fill();
  poly(ctx, [{ x: x - 11 * k, y }, { x: x - 6 * k, y: y - 12 * k }, { x: x + 3 * k, y: y - 15 * k }, { x: x + 12 * k, y: y - 5 * k }, { x: x + 9 * k, y }], '#8d939b', 'rgba(0,0,0,.35)');
  poly(ctx, [{ x: x - 6 * k, y: y - 12 * k }, { x: x + 3 * k, y: y - 15 * k }, { x: x + 2 * k, y: y - 6 * k }], '#aab0b8');
}
function drawBush(ctx, x, y, k) {
  ctx.fillStyle = 'rgba(0,0,0,.15)'; ctx.beginPath(); ctx.ellipse(x + 2, y + 1, 10 * k, 4 * k, 0, 0, Math.PI * 2); ctx.fill();
  circle(ctx, x - 5 * k, y - 4 * k, 6 * k, '#3a8040'); circle(ctx, x + 4 * k, y - 5 * k, 7 * k, '#4a9a4c'); circle(ctx, x, y - 8 * k, 5 * k, '#5aae5c');
}

function drawWorker(ctx, x, y, t, mode, hue) {
  const bob = mode === 'walk' ? Math.abs(Math.sin(t / 110)) * 2 : 0;
  ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.beginPath(); ctx.ellipse(x, y, 5, 2.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = hue; ctx.fillRect(x - 3.5, y - 11 - bob, 7, 8);
  circle(ctx, x, y - 14 - bob, 3.4, '#f1c9a0', 'rgba(0,0,0,.4)');
  ctx.fillStyle = '#f2b81c'; ctx.beginPath(); ctx.arc(x, y - 15 - bob, 3.8, Math.PI, 0); ctx.fill();
  if (mode === 'hammer') {
    const a = Math.sin(t / 90) * 0.9;
    ctx.strokeStyle = '#5a3a1a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x + 3, y - 9); ctx.lineTo(x + 3 + Math.sin(a) * 8, y - 9 - Math.cos(a) * 8); ctx.stroke();
  }
}

// ---------- Unit pictures (Kenney CC0, see art/LICENSE-Kenney-CC0.txt) ----------
const unitImgs = {};
function unitSprite(type, mine) {
  const src = (mine ? E2.UNIT_IMG : E2.UNIT_IMG_ENEMY)[type];
  if (!src) return null;
  if (!unitImgs[src]) { const im = new Image(); im.src = src; unitImgs[src] = im; }
  const im = unitImgs[src];
  return im.complete && im.naturalWidth ? im : null;
}

// ---------- Icons and thumbnails ----------
const iconCache = {};
function iconImg(key) {
  if (!iconCache[key]) { const im = new Image(); im.onload = () => E2.base && E2.base.dirty(); im.src = E2.iconUrl(key); iconCache[key] = im; }
  return iconCache[key];
}
function drawIcon(ctx, key, cx, cy, size) {
  const im = iconImg(key);
  if (im.complete && im.naturalWidth) ctx.drawImage(im, cx - size / 2, cy - size / 2, size, size);
}

// Small preview of a building for the shop.
function thumb(type, px) {
  const def = B[type], s = def.size, dpr = window.devicePixelRatio || 1;
  const c = document.createElement('canvas');
  c.width = px * dpr; c.height = px * dpr; c.style.width = c.style.height = px + 'px';
  const ctx = c.getContext('2d');
  const wW = s * TW + 10, hH = H[type] + s * TH + 14, k = Math.min(px / wW, px / hH);
  ctx.setTransform(dpr * k, 0, 0, dpr * k, 0, 0);
  const o = iso(0, 0);
  const left = -s * TW / 2 - 5, top = -H[type] - 6;
  ctx.translate(-left + (px / k - wW) / 2, -top + (px / k - hH) / 2);
  drawBuilding(ctx, type, o.x, o.y, { t: 0, level: 1 });
  return c;
}

E2.art = { TW, TH, iso, fromIso, hash, H, drawBuilding, drawTree, drawRock, drawBush, drawWorker, drawIcon, thumb, loadSprites, poly, unitSprite, drawShip };
loadSprites();
})();
