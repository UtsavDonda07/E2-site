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

  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (isLand(x, y)) { sx += x + 0.5; sy += y + 0.5; n++; }
  const cx = sx / n, cy = sy / n;

  const cap = E2.capitalSpot(c);                                   // their headquarters stand in the real capital
  const hq = place('hq', lvl, cap ? cap.x + 0.5 : cx, cap ? cap.y + 0.5 : cy, 1);
  const hx = hq ? hq.x + 1.5 : cx, hy = hq ? hq.y + 1.5 : cy;

  // Towers sit in a ring around the HQ; economy buildings fill the middle.
  const towers = [];
  const extra = Math.floor(conquered / 2);                         // bases toughen as your empire grows
  for (let i = 0; i < 1 + Math.floor(P * 0.35) + extra; i++) towers.push('gunTurret');
  for (let i = 0; i < Math.max(0, Math.floor((P - 3) / 3)) + Math.floor(extra / 2); i++) towers.push('missileBattery');
  if (P >= 6) for (let i = 0; i < 1 + Math.floor((P - 6) / 3); i++) towers.push('antiAir');
  const ring = Math.max(3, Math.min(6, Math.sqrt(n) / 2.2));
  const spin = rand() * Math.PI * 2;
  towers.forEach((t, i) => {
    const a = spin + (Math.PI * 2 * i) / towers.length;
    place(t, Math.min(3, lvl), hx + Math.cos(a) * ring, hy + Math.sin(a) * ring * 0.9, 1);
  });

  const eco = [];
  for (let i = 0; i < 1 + Math.floor(P / 3); i++) eco.push('goldMine');
  for (let i = 0; i < 1 + Math.floor(P / 4); i++) eco.push('oilRefinery');
  eco.push('vault');
  if (P >= 3) eco.push('steelMill');
  if (P >= 5) eco.push('barracks');
  for (const t of eco) place(t, lvl + (t === 'vault' ? 1 : 0), hx, hy, 0);

  const bonus = 1 + conquered * 0.1;
  return {
    id, power: P, level: lvl, buildings,
    loot: { gold: Math.round(300 * P * bonus), oil: Math.round(150 * P * bonus), steel: Math.round(80 * P * bonus) },
  };
}

// Short summary for the world map card.
function describe(enemy) {
  const count = t => enemy.buildings.filter(b => b.type === t).length;
  return { guns: count('gunTurret'), missiles: count('missileBattery'), aa: count('antiAir'), total: enemy.buildings.length, level: enemy.level };
}

E2.enemy = { generate, describe };
})();
