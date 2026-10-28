// Enemy bases: a country's defence is built from its power level and how many countries you already hold.
(function () {
'use strict';
const E2 = window.E2;
const B = E2.BUILDINGS;

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const seedOf = str => Array.from(str).reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 17);

// How far each tile of a country's land grid is from the sea: 0 for sea, 1 for coast, 2 and up inland. Cached.
const edgeCache = {};
function edgeMap(id) {
  if (edgeCache[id]) return edgeCache[id];
  const g = E2.isoGrid(E2.byId(id)), ed = new Int16Array(g.w * g.h), q = [];
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    if (g.rows[y][x] !== '1') continue;
    const sea = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const a = x + dx, b = y + dy; return a < 0 || b < 0 || a >= g.w || b >= g.h || g.rows[b][a] !== '1'; });
    if (sea) { ed[y * g.w + x] = 1; q.push(x, y); }
  }
  for (let i = 0; i < q.length; i += 2) {
    const x = q[i], y = q[i + 1], d = ed[y * g.w + x];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = x + dx, b = y + dy;
      if (a < 0 || b < 0 || a >= g.w || b >= g.h || g.rows[b][a] !== '1' || ed[b * g.w + a]) continue;
      ed[b * g.w + a] = d + 1; q.push(a, b);
    }
  }
  return (edgeCache[id] = { w: g.w, h: g.h, ed });
}

function generate(id, conquered) {
  const c = E2.byId(id), P = c.power;
  const rand = rng(seedOf(id) + conquered);
  const lvl = Math.min(3, 1 + Math.floor((P + conquered) / 5));
  const g = E2.isoGrid(c);
  const isLand = (x, y) => x >= 0 && y >= 0 && x < g.w && y < g.h && g.rows[y][x] === '1';
  const buildings = [];
  const occ = new Set();
  const mark = (b, size) => { for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) occ.add((b.y + dy) * g.w + b.x + dx); };
  const free = (x, y, size, gap) => {
    for (let dy = -gap; dy < size + gap; dy++) for (let dx = -gap; dx < size + gap; dx++) {
      const inside = dx >= 0 && dy >= 0 && dx < size && dy < size;
      if (inside && !isLand(x + dx, y + dy)) return false;
      if (occ.has((y + dy) * g.w + x + dx)) return false;
    }
    return true;
  };
  const place = (type, level, tx, ty, gap) => {
    const size = B[type].size;
    for (const gp of gap ? [gap, 0] : [0]) {
      let best = null, bd = Infinity;
      for (let y = 0; y <= g.h - size; y++) for (let x = 0; x <= g.w - size; x++) {
        if (!free(x, y, size, gp)) continue;
        const d = (x + size / 2 - tx) ** 2 + (y + size / 2 - ty) ** 2;
        if (d < bd) { bd = d; best = { x, y }; }
      }
      if (best) {
        const b = { uid: 100000 + buildings.length, type, level: Math.min(level, B[type].levels.length), x: best.x, y: best.y };
        buildings.push(b); mark(b, size);
        return b;
      }
    }
    return null;
  };

  const ed = edgeMap(id).ed;                                         // 0 = sea, 1 = coast tile, 2+ = tiles further inland
  const edAt = (x, y) => (x < 0 || y < 0 || x >= g.w || y >= g.h) ? 0 : ed[y * g.w + x];
  const land = [];
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (isLand(x, y)) land.push({ x: x + 0.5, y: y + 0.5, e: edAt(x, y) });
  const cx = land.reduce((a, t) => a + t.x, 0) / land.length, cy = land.reduce((a, t) => a + t.y, 0) / land.length;
  // Farthest-point picks: spread k spots over the candidates, each as far as possible from the ones already chosen.
  const spread = (cands, chosen, k) => {
    const out = [];
    for (let i = 0; i < k; i++) {
      let top = [];
      for (const t of cands) {
        const d = Math.min(...chosen.concat(out).map(q => Math.hypot(q.x - t.x, q.y - t.y)), 99);
        top.push({ t, d: d * (0.85 + rand() * 0.3) });
      }
      top.sort((p, q) => q.d - p.d);
      if (!top.length) break;
      out.push(top[0].t);
    }
    return out;
  };

  const cap = E2.capitalSpot(c);                                   // their headquarters stand in the real capital
  const hq = place('hq', lvl, cap ? cap.x + 0.5 : cx, cap ? cap.y + 0.5 : cy, 1);
  const hx = hq ? hq.x + 1.5 : cx, hy = hq ? hq.y + 1.5 : cy;
  const capital = { x: hx, y: hy };

  // Towns: the capital plus a few more, spread over the whole country and away from the coast.
  const inland = land.filter(t => t.e >= 4), pool = inland.length > 30 ? inland : land;
  const towns = [capital].concat(spread(pool, [capital], 2 + Math.min(4, Math.floor(P / 2))));
  const near = (type, level, p, gap) => place(type, level, p.x, p.y, gap);

  const extra = Math.floor(conquered / 2);                         // bases toughen as your empire grows
  const guns = 3 + Math.floor(P * 0.5) + extra;
  const missiles = Math.max(0, Math.floor((P - 2) / 3)) + Math.floor(extra / 2);
  const aa = P >= 4 ? 1 + Math.floor((P - 4) / 3) : 0;

  // Economy: the vault beside the HQ, the rest in the towns.
  near('vault', lvl + 1, capital, 1);
  const eco = [];
  const kinds = ['goldMine', 'oilRefinery'].concat(P >= 3 ? ['steelMill'] : [], P >= 5 ? ['barracks'] : [], P >= 6 ? ['researchLab'] : []);
  const perTown = 2 + (P >= 6 ? 1 : 0);
  for (let i = 0; i < towns.length * perTown; i++) eco.push({ type: kinds[i % kinds.length], town: towns[(i + (i >= kinds.length ? 1 : 0)) % towns.length] });
  for (const e of eco) near(e.type, lvl, e.town, 1);

  // Their people: houses in every town, villages in the bigger ones, and a city in the capital of a strong country.
  towns.forEach((t, i) => {
    near('house', lvl, t, 1); near('house', lvl, t, 1);
    if (i > 0 && P >= 3) near('village', lvl, t, 1);
  });
  if (P >= 6) near('city', lvl, capital, 2);
  near('farm', lvl, towns[towns.length - 1], 1);

  // Defences: a ring round the HQ, a few at every town, and coastal batteries facing the sea where you land.
  const towers = [];
  for (let i = 0; i < guns; i++) towers.push('gunTurret');
  for (let i = 0; i < missiles; i++) towers.push('missileBattery');
  for (let i = 0; i < aa; i++) towers.push('antiAir');
  const coastal = Math.min(towers.length - 2, Math.ceil(guns * 0.35));
  const coastSpots = spread(land.filter(t => t.e <= 2), [], coastal);
  coastSpots.forEach(sp => place('gunTurret', Math.min(3, lvl), sp.x, sp.y, 1));
  towers.splice(towers.indexOf('gunTurret'), coastSpots.length);
  const ring = 4.5, spin = rand() * Math.PI * 2, hqShare = Math.max(3, Math.ceil(towers.length * 0.4));
  towers.sort((a, b) => (a === 'gunTurret') - (b === 'gunTurret'));       // the big guns go round the HQ first
  towers.forEach((t, i) => {
    if (i < hqShare) {
      const a = spin + (Math.PI * 2 * i) / hqShare;
      place(t, Math.min(3, lvl), hx + Math.cos(a) * ring, hy + Math.sin(a) * ring * 0.9, 1);
    } else {
      const town = towns[1 + (i - hqShare) % Math.max(1, towns.length - 1)] || capital, a = spin + i * 2.4;
      place(t, Math.min(3, lvl), town.x + Math.cos(a) * 3.5, town.y + Math.sin(a) * 3.5, 1);
    }
  });

  // A harbour on the coast nearest the capital.
  if (P >= 2) {
    const shore = land.filter(t => t.e === 1 || t.e === 2).sort((p, q) => Math.hypot(p.x - hx, p.y - hy) - Math.hypot(q.x - hx, q.y - hy))[0];
    if (shore) place('harbor', lvl, shore.x, shore.y, 1);
  }

  const bonus = 1 + conquered * 0.1;
  return {
    id, power: P, level: lvl, buildings,
    loot: { gold: Math.round(300 * P * bonus), oil: Math.round(150 * P * bonus), steel: Math.round(80 * P * bonus) },
  };
}

// ---------- The war map ----------
// A war is fought on one map that holds both countries, side by side the way they lie on the globe (their direction from each
// other). Land neighbours touch at a strip of land, the others have sea between them. Returns the combined grid:
// side[] is 0 sea, 1 your country, 2 the enemy country, 3 a land strip between them.
const layoutCache = {};
function warLayout(homeId, targetId) { return layoutOf(homeId, targetId); }
function layoutOf(homeId, targetId) {
  const key = homeId + '>' + (targetId || '');
  if (layoutCache[key]) return layoutCache[key];
  const hc = E2.byId(homeId), tc = targetId ? E2.byId(targetId) : null;
  const K = (x, y) => (y + 4096) * 8192 + x + 4096;
  const tiles = g => { const l = []; for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (g.rows[y][x] === '1') l.push(x, y); return l; };
  const centre = (l, o) => { let sx = 0, sy = 0; for (let i = 0; i < l.length; i += 2) { sx += (l[i] - l[i + 1]) * 32; sy += (l[i] + l[i + 1]) * 16; } return { x: sx / (l.length / 2) + (o.x - o.y) * 32, y: sy / (l.length / 2) + (o.x + o.y) * 16 }; };
  const bearing = (a, b) => {                                  // direction from country a to country b on screen (north is up)
    let dlon = b.label[0] - a.label[0];
    if (dlon > 180) dlon -= 360; else if (dlon < -180) dlon += 360;
    const dx = dlon * Math.cos(a.label[1] * Math.PI / 180), dy = -(b.label[1] - a.label[1]), len = Math.hypot(dx, dy);
    return len < 0.01 ? { x: 0, y: -1 } : { x: dx / len, y: dy / len };
  };
  const occ = new Set();                                       // every tile used so far, in the home country's tile coordinates
  const placed = [];                                           // { id, l (tiles), off, val }
  const put = (id, l, off, val) => { placed.push({ id, l, off, val }); for (let i = 0; i < l.length; i += 2) occ.add(K(l[i] + off.x, l[i + 1] + off.y)); };
  // Slides a country in from far away along `dir` until it would touch (within `gap` tiles of) what is already placed.
  const slide = (refCentre, dir, l, g, refSize, gap) => {
    const cn = centre(l, { x: 0, y: 0 });
    const offsetFor = t => {
      const sx = refCentre.x + dir.x * t - cn.x, sy = refCentre.y + dir.y * t - cn.y, a = sx / 32, b = sy / 16;
      return { x: Math.round((a + b) / 2), y: Math.round((b - a) / 2) };
    };
    const close = o => {
      for (let i = 0; i < l.length; i += 2) {
        const x = l[i] + o.x, y = l[i + 1] + o.y;
        for (let ay = -gap; ay <= gap; ay++) for (let ax = -gap; ax <= gap; ax++) if (occ.has(K(x + ax, y + ay))) return true;
      }
      return false;
    };
    let t = (refSize + g.w + g.h) * 16, off = offsetFor(t);
    while (t > 0) { const next = offsetFor(t - 12); if (close(next)) break; t -= 12; off = next; }
    return off;
  };

  const hg = E2.isoGrid(hc), hl = tiles(hg), byLand = !!tc && hc.land.includes(targetId);
  const tg = tc && E2.isoGrid(tc), tl = tc ? tiles(tg) : [];
  put(homeId, hl, { x: 0, y: 0 }, 1);
  const toff = tc ? slide(centre(hl, { x: 0, y: 0 }), bearing(hc, tc), tl, tg, hg.w + hg.h, byLand ? 1 : 4) : { x: 0, y: 0 };
  if (tc) put(targetId, tl, toff, 2);

  // Land neighbours join the two countries with a strip of land where their coasts come closest.
  const bridge = [];
  if (byLand) {
    const edge = (l, o) => { const e = []; for (let i = 0; i < l.length; i += 2) { const x = l[i] + o.x, y = l[i + 1] + o.y; if (![[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => occ.has(K(x + dx, y + dy)))) e.push(x, y); } return e; };
    const A = edge(hl, { x: 0, y: 0 }), T = edge(tl, toff);
    let pa = null, pb = null, bd = Infinity;
    for (let i = 0; i < A.length; i += 2) for (let j = 0; j < T.length; j += 2) { const d = (A[i] - T[j]) ** 2 + (A[i + 1] - T[j + 1]) ** 2; if (d < bd) { bd = d; pa = [A[i], A[i + 1]]; pb = [T[j], T[j + 1]]; } }
    if (pa) {
      const n = Math.ceil(Math.sqrt(bd)) * 2 + 1;
      for (let k = 0; k <= n; k++) for (const [ox, oy] of [[0, 0], [1, 0], [0, 1]]) {
        const x = Math.round(pa[0] + (pb[0] - pa[0]) * k / n) + ox, y = Math.round(pa[1] + (pb[1] - pa[1]) * k / n) + oy;
        if (!occ.has(K(x, y))) { bridge.push(x, y); occ.add(K(x, y)); }
      }
    }
  }

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of placed) for (let i = 0; i < p.l.length; i += 2) {
    const x = p.l[i] + p.off.x, y = p.l[i + 1] + p.off.y;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const M = 4, hs = { x: M - x0, y: M - y0 }, ts = { x: toff.x + hs.x, y: toff.y + hs.y };
  const w = x1 - x0 + 1 + 2 * M, h = y1 - y0 + 1 + 2 * M, side = new Uint8Array(w * h);
  for (const p of placed) {
    for (let i = 0; i < p.l.length; i += 2) side[(p.l[i + 1] + p.off.y + hs.y) * w + p.l[i] + p.off.x + hs.x] = p.val;
  }
  for (let i = 0; i < bridge.length; i += 2) side[(bridge[i + 1] + hs.y) * w + bridge[i] + hs.x] = 3;
  const rows = [];
  for (let y = 0; y < h; y++) { let r = ''; for (let x = 0; x < w; x++) r += side[y * w + x] ? '1' : '0'; rows.push(r); }
  return (layoutCache[key] = { w, h, rows, side, home: hs, target: ts, homeId, targetId, byLand, placed });
}

// The real land around a country, drawn dimly behind it: every other country's true outline is laid onto this country's grid with
// the same scale, so the neighbours sit where they really are (no sea between India and China). Returns tile coordinates in the
// country's own grid frame (they can be negative or past its edge): [x0, y0, x1, y1, ...].
const aroundCache = {};
function surroundings(id) {
  if (aroundCache[id]) return aroundCache[id];
  const c = E2.byId(id), g = E2.isoGrid(c), M = 55, W = g.w + 2 * M, H = g.h + 2 * M;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#000';
  const cell = Math.max(c.grid.csx, c.grid.csy, 0.02), radius = (Math.max(g.w, g.h) / 2 + M) * cell * 1.7, cx = c.label[0], cy = c.label[1];   // degrees: skips far-off countries
  for (const o of E2.COUNTRIES) {
    if (o.id === id) continue;
    for (const ring of o.outline) {
      let lo0 = Infinity, lo1 = -Infinity, la0 = Infinity, la1 = -Infinity;
      for (let i = 0; i < ring.length; i += 2) { lo0 = Math.min(lo0, ring[i]); lo1 = Math.max(lo1, ring[i]); la0 = Math.min(la0, ring[i + 1]); la1 = Math.max(la1, ring[i + 1]); }
      if (la1 < cy - radius || la0 > cy + radius) continue;
      for (const dl of [-360, 0, 360]) {
        if (lo1 + dl < cx - radius || lo0 + dl > cx + radius) continue;
        ctx.beginPath();
        for (let i = 0; i < ring.length; i += 2) {
          const p = g.project(ring[i] + dl, ring[i + 1]);
          i ? ctx.lineTo(p.x + M + 0.5, p.y + M + 0.5) : ctx.moveTo(p.x + M + 0.5, p.y + M + 0.5);
        }
        ctx.closePath(); ctx.fill();
      }
    }
  }
  const px = ctx.getImageData(0, 0, W, H).data, mine = (x, y) => x >= 0 && y >= 0 && x < g.w && y < g.h && g.rows[y][x] === '1';
  const dim = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (px[(y * W + x) * 4 + 3] > 127 && !mine(x - M, y - M)) dim[y * W + x] = 1;
  const touches = (a, x, y) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if ((dx || dy) && xx >= 0 && yy >= 0 && xx < W && yy < H && a(xx, yy)) return true; } return false; };
  for (let pass = 0; pass < 2; pass++) {                       // the borders of a rough country grid leave hairline gaps: close them
    const add = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (dim[y * W + x] || mine(x - M, y - M)) continue;
      if (touches((a, b) => mine(a - M, b - M), x, y) && touches((a, b) => dim[b * W + a], x, y)) add.push(y * W + x);
    }
    for (const i of add) dim[i] = 1;
  }
  const out = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (dim[y * W + x]) out.push(x - M, y - M);
  return (aroundCache[id] = out);
}

// Short summary for the world map card.
function describe(enemy) {
  const count = t => enemy.buildings.filter(b => b.type === t).length;
  return { guns: count('gunTurret'), missiles: count('missileBattery'), aa: count('antiAir'), total: enemy.buildings.length, level: enemy.level };
}

E2.enemy = { generate, describe, edgeMap, warLayout, surroundings };
})();
