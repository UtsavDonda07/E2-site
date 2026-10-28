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
// A war is fought on one map that holds both countries, side by side the way they lie on the globe (their direction from
// each other), a couple of tiles of sea apart. Returns the combined land grid and where each country's own tiles went.
const layoutCache = {};
function warLayout(homeId, targetId) {
  const key = homeId + '>' + targetId;
  if (layoutCache[key]) return layoutCache[key];
  const hc = E2.byId(homeId), tc = E2.byId(targetId), hg = E2.isoGrid(hc), tg = E2.isoGrid(tc);
  let dlon = tc.label[0] - hc.label[0];
  if (dlon > 180) dlon -= 360; else if (dlon < -180) dlon += 360;
  let dx = dlon * Math.cos(hc.label[1] * Math.PI / 180), dy = -(tc.label[1] - hc.label[1]);      // north is up on screen
  const len = Math.hypot(dx, dy);
  if (len < 0.01) { dx = 0; dy = -1; } else { dx /= len; dy /= len; }

  const tiles = g => { const l = []; for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (g.rows[y][x] === '1') l.push(x, y); return l; };
  const hl = tiles(hg), tl = tiles(tg);
  const centre = l => { let sx = 0, sy = 0; for (let i = 0; i < l.length; i += 2) { sx += (l[i] - l[i + 1]) * 32; sy += (l[i] + l[i + 1]) * 16; } return { x: sx / (l.length / 2), y: sy / (l.length / 2) }; };
  const hcn = centre(hl), tcn = centre(tl);
  const K = (x, y) => (y + 4096) * 8192 + x + 4096;
  const homeSet = new Set();
  for (let i = 0; i < hl.length; i += 2) homeSet.add(K(hl[i], hl[i + 1]));
  const offsetFor = t => {                                     // the target's tile shift that puts its centre t px from ours along the bearing
    const sx = hcn.x + dx * t - tcn.x, sy = hcn.y + dy * t - tcn.y, a = sx / 32, b = sy / 16;
    return { x: Math.round((a + b) / 2), y: Math.round((b - a) / 2) };
  };
  const byLand = hc.land.includes(targetId);                  // land neighbours touch at the border; the others have sea between them
  const GAP = byLand ? 1 : 4, close = o => {
    for (let i = 0; i < tl.length; i += 2) {
      const x = tl[i] + o.x, y = tl[i + 1] + o.y;
      for (let ay = -GAP; ay <= GAP; ay++) for (let ax = -GAP; ax <= GAP; ax++) if (homeSet.has(K(x + ax, y + ay))) return true;
    }
    return false;
  };
  let t = (hg.w + hg.h + tg.w + tg.h) * 16, off = offsetFor(t);
  while (t > 0) {                                              // slide the target in until the coasts are a couple of tiles apart
    const next = offsetFor(t - 12);
    if (close(next)) break;
    t -= 12; off = next;
  }

  let x0 = Math.min(0, off.x), y0 = Math.min(0, off.y), x1 = Math.max(hg.w, off.x + tg.w), y1 = Math.max(hg.h, off.y + tg.h);
  const M = 4, hs = { x: M - x0, y: M - y0 }, ts = { x: off.x + hs.x, y: off.y + hs.y };
  const w = x1 - x0 + 2 * M, h = y1 - y0 + 2 * M, side = new Uint8Array(w * h);
  for (let i = 0; i < hl.length; i += 2) side[(hl[i + 1] + hs.y) * w + hl[i] + hs.x] = 1;
  for (let i = 0; i < tl.length; i += 2) side[(tl[i + 1] + ts.y) * w + tl[i] + ts.x] = 2;
  if (byLand) {                                                // land neighbours: a strip of land joins the two countries where they come closest
    let pa = null, pb = null, bd = Infinity;
    const A = [], T = [];
    for (let i = 0; i < w * h; i++) if (side[i] === 1) A.push(i); else if (side[i] === 2) T.push(i);
    for (const i of A) { const ax = i % w, ay = (i / w) | 0; if (!(ax > 0 && side[i - 1] && ay > 0 && side[i - w] && side[i + 1] && side[i + w])) for (const j of T) { const d = (ax - j % w) ** 2 + (ay - ((j / w) | 0)) ** 2; if (d < bd) { bd = d; pa = i; pb = j; } } }
    if (pa != null) {
      const n = Math.ceil(Math.sqrt(bd)) * 2 + 1, ax = pa % w, ay = (pa / w) | 0, bx = pb % w, by = (pb / w) | 0;
      for (let k = 0; k <= n; k++) for (const [ox, oy] of [[0, 0], [1, 0], [0, 1]]) {
        const x = Math.round(ax + (bx - ax) * k / n) + ox, y = Math.round(ay + (by - ay) * k / n) + oy;
        if (x >= 0 && y >= 0 && x < w && y < h && !side[y * w + x]) side[y * w + x] = 3;
      }
    }
  }
  const rows = [];
  for (let y = 0; y < h; y++) { let r = ''; for (let x = 0; x < w; x++) r += side[y * w + x] ? '1' : '0'; rows.push(r); }
  return (layoutCache[key] = { w, h, rows, side, home: hs, target: ts, homeId, targetId, byLand });
}

// Short summary for the world map card.
function describe(enemy) {
  const count = t => enemy.buildings.filter(b => b.type === t).length;
  return { guns: count('gunTurret'), missiles: count('missileBattery'), aa: count('antiAir'), total: enemy.buildings.length, level: enemy.level };
}

E2.enemy = { generate, describe, edgeMap, warLayout };
})();
