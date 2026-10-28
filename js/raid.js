// Raid planning and the battle simulation. Pure logic: no DOM, so it also runs headless
// when a raid lands while the player is away.
(function () {
'use strict';
const E2 = window.E2;
const B = E2.BUILDINGS, U = E2.UNITS, R = E2.RAID;
const DT = 0.1;
const SPAWN_GAP = 0.5;          // seconds between units entering
const SPAWN_DIST = 9;           // cells beyond the base before units appear
const ENGAGE = 3;               // troops start fighting enemy troops this close
const BOAT_SPEED = 1.3;         // tiles per second for troops crossing the sea in a transport ship

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

// ---------- Planning ----------
function pickAttacker(S, rand) {
  // Anyone bordering your homeland or a conquered territory may attack you.
  const pool = E2.reachable(S.owned || [S.homeland]);
  // Stronger neighbours are more likely to attack.
  const weights = pool.map(id => 1 + E2.byId(id).power);
  let r = rand() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) { r -= weights[i]; if (r <= 0) return pool[i]; }
  return pool[pool.length - 1];
}

function sideOf(home, att) {
  const dx = (att.label[0] - home.label[0]) * Math.cos(home.label[1] * Math.PI / 180);
  const dy = att.label[1] - home.label[1];
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'E' : 'W';
  return dy >= 0 ? 'N' : 'S';
}

// A random army that a country of the given power could field for this budget.
function pickUnits(power, budget, rand, max) {
  const units = [], allowed = Object.keys(U).filter(k => power >= U[k].minPower), total = allowed.reduce((s, k) => s + U[k].weight, 0);
  while (units.length < max) {
    let r = rand() * total, pick = allowed[0];
    for (const k of allowed) { r -= U[k].weight; if (r <= 0) { pick = k; break; } }
    if (U[pick].cost > budget) {
      const cheap = allowed.filter(k => U[k].cost <= budget);
      if (!cheap.length) break;
      pick = cheap[0];
    }
    units.push(pick); budget -= U[pick].cost;
  }
  return units;
}

// Builds the next raid: who, from where, and which units.
function plan(S, hqLevel) {
  const seed = (Math.random() * 2147483647) | 0;
  const rand = rng(seed);
  const home = E2.byId(S.homeland);
  const attackerId = pickAttacker(S, rand);
  const att = E2.byId(attackerId);
  const faced = S.raid.faced;

  const units = [];
  if (faced === 0) {
    for (let i = 0; i < 4; i++) units.push('infantry');       // gentle first raid
  } else units.push(...pickUnits(att.power, 30 + 30 * hqLevel + 6 * att.power + 5 * Math.min(faced, 10), rand, 40));
  return { seed, attackerId, side: sideOf(home, att), units };
}

// ---------- Simulation ----------
function makeSim(S, raid) {
  const rand = rng(raid.seed);
  const blds = [];
  for (const b of S.buildings) {
    if (b.level < 1 || b.ruined) continue;               // unbuilt or already ruined: not a target
    const def = B[b.type], hp = E2.hpOf(b.type, b.level);
    blds.push({
      uid: b.uid, type: b.type, level: b.level, size: def.size, x: b.x, y: b.y,
      cx: b.x + def.size / 2, cy: b.y + def.size / 2,
      hp, maxHp: hp, alive: true, cool: 0, side: 'us', tower: def.tower ? Object.assign({}, def.tower, { dmgNow: def.tower.dmg[b.level - 1] }) : null,
    });
  }
  const sim = {
    t: 0, done: false, raid, rand, buildings: blds, byUid: {},
    units: [], pending: [], effects: [], strikes: [],
    ability: { charges: R.strike.charges, cd: 0 }, nextId: 1, endReason: null,
  };
  for (const b of blds) sim.byUid[b.uid] = b;

  // Where the base is, and where raiders come from.
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const b of blds) { x0 = Math.min(x0, b.x); x1 = Math.max(x1, b.x + b.size); y0 = Math.min(y0, b.y); y1 = Math.max(y1, b.y + b.size); }
  sim.bounds = { x0, x1, y0, y1 };
  // The ground is drawn turned 45 degrees (north is straight up on screen), so on the grid the screen directions
  // are diagonals: right (east) = +x -y, up (north) = -x -y, left (west) = -x +y, down (south) = +x +y.
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, half = Math.max(x1 - x0, y1 - y0) / 2 + 3;
  const [dx, dy] = { E: [1, -1], W: [-1, 1], N: [-1, -1], S: [1, 1] }[raid.side] || [1, 1];
  // Screen distances are stretched sideways (the ground is squashed 2:1), so east/west starts are brought in a little.
  const k = Math.SQRT1_2, reach = (SPAWN_DIST + half) * (raid.side === 'E' || raid.side === 'W' ? 0.7 : 1);
  raid.units.forEach((type, i) => {
    const j = (rand() * 2 - 1) * half;                      // spread along the side, at right angles to the approach
    sim.pending.push({ at: i * SPAWN_GAP, type, x: cx + dx * k * reach - dy * k * j, y: cy + dy * k * reach + dx * k * j });
  });
  return sim;
}

const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

function nearestBuilding(sim, u) {
  let best = null, bd = Infinity;
  for (const b of sim.buildings) {
    if (!b.alive || b.side === u.side) continue;
    const d = dist(u.x, u.y, b.cx, b.cy);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

function damageBuilding(sim, b, dmg) {
  if (!b.alive) return;
  b.hp -= dmg;
  if (b.hp <= 0) {
    b.hp = 0; b.alive = false;
    sim.effects.push({ kind: 'boom', x: b.cx, y: b.cy, r: b.size, t0: sim.t, life: 0.6 });
  }
}
function damageUnit(sim, u, dmg) {
  if (!u.alive) return;
  u.hp -= dmg;
  if (u.hp <= 0) { u.alive = false; sim.effects.push({ kind: 'boom', x: u.x, y: u.y, r: 0.5, t0: sim.t, life: 0.35 }); }
}

function fireStrike(sim, x, y) {
  const a = sim.ability;
  if (sim.done || a.charges <= 0 || a.cd > 0) return false;
  a.charges--; a.cd = R.strike.cooldown;
  sim.strikes.push({ x, y, fireAt: sim.t + R.strike.delay, armedAt: sim.t });
  return true;
}

function step(sim) {
  if (sim.done) return;
  const dt = DT;
  sim.t += dt;
  if (sim.ability.cd > 0) sim.ability.cd = Math.max(0, sim.ability.cd - dt);

  // Spawn raiders.
  while (sim.pending.length && sim.pending[0].at <= sim.t) {
    const p = sim.pending.shift();
    const d = U[p.type];
    sim.units.push({ id: sim.nextId++, type: p.type, side: p.side || 'them', x: p.x, y: p.y, hp: d.hp, maxHp: d.hp, cool: 0, alive: true, target: null, air: d.air, ttl: d.ttl == null ? null : d.ttl });
  }
  if (sim.mode === 'war') sendWaves(sim);

  // Strikes landing: when defending they hit raiders, when attacking they bomb buildings.
  for (let i = sim.strikes.length - 1; i >= 0; i--) {
    const s = sim.strikes[i];
    if (s.fireAt > sim.t) continue;
    sim.strikes.splice(i, 1);
    if (sim.mode === 'war') {                           // your bomb hits the enemy's buildings and the troops standing on them
      sim.effects.push({ kind: 'boom', x: s.x, y: s.y, r: R.bomb.radius, t0: sim.t, life: 0.7 });
      for (const b of sim.buildings) if (b.alive && b.side === 'them' && dist(b.cx, b.cy, s.x, s.y) <= R.bomb.radius + b.size / 2) damageBuilding(sim, b, R.bomb.dmg);
      for (const u of sim.units) if (u.alive && u.side === 'them' && dist(u.x, u.y, s.x, s.y) <= R.bomb.radius) damageUnit(sim, u, R.strike.dmg);
    } else {
      sim.effects.push({ kind: 'boom', x: s.x, y: s.y, r: R.strike.radius, t0: sim.t, life: 0.7 });
      for (const u of sim.units) if (u.alive && dist(u.x, u.y, s.x, s.y) <= R.strike.radius) damageUnit(sim, u, R.strike.dmg);
    }
  }

  // Towers.
  for (const b of sim.buildings) {
    if (!b.alive || !b.tower) continue;
    b.cool -= dt;
    if (b.cool > 0) continue;
    let tgt = null, td = b.tower.range;
    for (const u of sim.units) {
      if (!u.alive || u.side === b.side) continue;
      if ((b.tower.targets === 'air') !== u.air) continue;
      const d = dist(b.cx, b.cy, u.x, u.y);
      if (d <= td) { td = d; tgt = u; }
    }
    if (!tgt) continue;
    b.cool = b.tower.rate;
    sim.effects.push({ kind: 'shot', x1: b.cx, y1: b.cy, x2: tgt.x, y2: tgt.y, t0: sim.t, life: 0.15, air: tgt.air });
    if (b.tower.splash) {
      sim.effects.push({ kind: 'boom', x: tgt.x, y: tgt.y, r: b.tower.splash, t0: sim.t, life: 0.4 });
      for (const u of sim.units) if (u.alive && u.side !== b.side && !u.air && dist(u.x, u.y, tgt.x, tgt.y) <= b.tower.splash) damageUnit(sim, u, b.tower.dmgNow);
    } else damageUnit(sim, tgt, b.tower.dmgNow);
  }

  // Raiders.
  for (const u of sim.units) {
    if (!u.alive) continue;
    const d = U[u.type];
    if (u.ttl != null) {                                    // a satellite burns up after a while
      u.ttl -= dt;
      if (u.ttl <= 0) { u.alive = false; sim.effects.push({ kind: 'boom', x: u.x, y: u.y, r: 0.8, t0: sim.t, life: 0.5 }); continue; }
    }
    if (sim.mode === 'war' && !u.boat && u.type !== 'missile' && u.type !== 'satellite') {         // troops fight enemy troops that come close
      let foe = null, fd = ENGAGE;
      for (const v of sim.units) {
        if (!v.alive || v.side === u.side || (v.air && !u.air)) continue;
        const dd = dist(u.x, u.y, v.x, v.y);
        if (dd < fd) { fd = dd; foe = v; }
      }
      if (foe) {
        if (fd <= d.range + 0.4) {
          u.cool -= dt;
          if (u.cool <= 0) { u.cool = d.rate || 1; damageUnit(sim, foe, d.dmg); sim.effects.push({ kind: 'shot', x1: u.x, y1: u.y, x2: foe.x, y2: foe.y, t0: sim.t, life: 0.12, air: foe.air }); }
        } else if (d.speed) { u.x += (foe.x - u.x) / fd * Math.min(fd, d.speed * dt); u.y += (foe.y - u.y) / fd * Math.min(fd, d.speed * dt); }
        continue;
      }
    }
    if (!u.target || !u.target.alive) u.target = nearestBuilding(sim, u);
    const tg = u.target;
    if (!tg) continue;
    const dd = dist(u.x, u.y, tg.cx, tg.cy);
    if (sim.mode === 'war' && !u.air) {                      // ground troops follow the land (and ships), they do not cut across the sea
      if (!u.boat && dd <= d.range + tg.size / 2) {
        u.cool -= dt;
        if (u.cool <= 0) { u.cool = d.rate; damageBuilding(sim, tg, d.dmg); sim.effects.push({ kind: 'hit', x: tg.cx, y: tg.cy, t0: sim.t, life: 0.2 }); }
      } else marchGround(sim, u, tg, d.speed, dt);
      continue;
    }
    if (dd > 0.01) { u.vx = (tg.cx - u.x) / dd; u.vy = (tg.cy - u.y) / dd; }          // heading, for drawing flyers nose-first

    if (u.type === 'missile') {
      if (dd <= d.range) {
        u.alive = false;
        sim.effects.push({ kind: 'boom', x: u.x, y: u.y, r: d.splash, t0: sim.t, life: 0.5 });
        for (const b of sim.buildings) if (b.alive && b.side !== u.side && dist(u.x, u.y, b.cx, b.cy) <= d.splash + b.size / 2) damageBuilding(sim, b, d.dmg);
        continue;
      }
    } else if (dd <= d.range + tg.size / 2) {
      u.cool -= dt;
      if (u.cool <= 0) {
        u.cool = d.rate;
        damageBuilding(sim, tg, d.dmg);
        sim.effects.push(u.type === 'satellite'
          ? { kind: 'beam', x: tg.cx, y: tg.cy, sx: u.x, sy: u.y, t0: sim.t, life: 0.3 }      // a ray from orbit
          : { kind: 'hit', x: tg.cx, y: tg.cy, t0: sim.t, life: 0.2 });
      }
      continue;
    }
    if (!d.speed || dd < 0.001) continue;                   // a satellite out of range just waits
    const m = Math.min(dd, d.speed * dt);
    u.x += (tg.cx - u.x) / dd * m;
    u.y += (tg.cy - u.y) / dd * m;
  }

  sim.effects = sim.effects.filter(e => sim.t - e.t0 < e.life);

  // End conditions.
  const hq = sim.buildings.find(b => b.type === 'hq');
  const unitsAlive = sim.units.filter(u => u.alive).length;
  if (sim.mode === 'war') {
    const ours = sim.buildings.filter(x => x.side === 'us'), theirs = sim.buildings.filter(x => x.side === 'them');
    const ourHq = ours.find(x => x.type === 'hq'), theirHq = theirs.find(x => x.type === 'hq');
    const reserve = Object.values(sim.reserve).reduce((x, y) => x + y, 0), mine = sim.units.filter(x => x.alive && x.side === 'us').length;
    if (theirHq && !theirHq.alive) { sim.done = true; sim.endReason = 'conquered'; }
    else if (ours.length && (ourHq ? !ourHq.alive : !ours.some(x => x.alive))) { sim.done = true; sim.endReason = 'overrun'; }
    else if (!theirs.some(x => x.alive)) { sim.done = true; sim.endReason = 'wiped'; }
    else if (!reserve && !mine && !sim.strikes.length) { sim.done = true; sim.endReason = 'spent'; }
    else if (sim.t >= sim.limit) { sim.done = true; sim.endReason = 'time'; }
    return;
  }
  const raidersLeft = sim.pending.length + unitsAlive;
  if (hq && !hq.alive) { sim.done = true; sim.endReason = 'hq'; }
  else if (!raidersLeft) { sim.done = true; sim.endReason = 'repelled'; }
  else if (!sim.buildings.some(b => b.alive)) { sim.done = true; sim.endReason = 'wiped'; }
  else if (sim.t >= R.maxTime) { sim.done = true; sim.endReason = 'time'; }
}

// ---------- Your wars ----------
// buildings: the war map's buildings (yours with side 'us', the enemy's with 'them'). lay: the combined map (E2.enemy.warLayout).
// army: { infantry: n, tank: n, ... } waiting at home. The enemy sends waves of its own and shoots back.
function makeWarSim(buildings, lay, enemy, army) {
  const blds = [];
  for (const b of buildings) {
    if (b.level < 1 || b.ruined) continue;               // unbuilt or already ruined: not a target
    const def = B[b.type], hp = E2.hpOf(b.type, b.level);
    blds.push({
      uid: b.uid, type: b.type, level: b.level, size: def.size, x: b.x, y: b.y, cx: b.x + def.size / 2, cy: b.y + def.size / 2, side: b.side,
      hp, maxHp: hp, alive: true, cool: 0, tower: def.tower ? Object.assign({}, def.tower, { dmgNow: def.tower.dmg[b.level - 1] }) : null,
    });
  }
  const sim = {
    t: 0, done: false, mode: 'war', rand: rng(7), buildings: blds, byUid: {}, units: [], pending: [], effects: [], strikes: [],
    ability: { charges: R.strike.charges, cd: 0 }, nextId: 1, endReason: null,
    reserve: Object.assign({}, army), deployed: {}, limit: R.warTime, lay, power: enemy.power,
    waveAt: R.waveFirst, wave: 0,
  };
  for (const b of blds) sim.byUid[b.uid] = b;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const b of blds) { x0 = Math.min(x0, b.x); x1 = Math.max(x1, b.x + b.size); y0 = Math.min(y0, b.y); y1 = Math.max(y1, b.y + b.size); }
  sim.bounds = { x0, x1, y0, y1 };
  sim.fields = new Map();
  Object.assign(sim, seaRoute(lay));
  return sim;
}

// Do the two countries touch by land? If not, ground troops sail from the coast tile of one nearest to the other.
function seaRoute(lay) {
  const { w, h, side } = lay, at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : side[y * w + x];
  const coast = [[], [], []];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = at(x, y);
    if ((v === 1 || v === 2) && (!at(x + 1, y) || !at(x - 1, y) || !at(x, y + 1) || !at(x, y - 1))) coast[v].push(x, y);
  }
  let best = null, bd = Infinity;
  for (let i = 0; i < coast[1].length; i += 2) for (let j = 0; j < coast[2].length; j += 2) {
    const d = (coast[1][i] - coast[2][j]) ** 2 + (coast[1][i + 1] - coast[2][j + 1]) ** 2;
    if (d < bd) { bd = d; best = { us: { x: coast[1][i] + 0.5, y: coast[1][i + 1] + 0.5 }, them: { x: coast[2][j] + 0.5, y: coast[2][j + 1] + 0.5 } }; }
  }
  const seen = new Uint8Array(w * h), q = [];                  // flood the land from all of yours: does it reach theirs?
  for (let i = 0; i < side.length; i++) if (side[i] === 1) { seen[i] = 1; q.push(i); }
  let connected = false;
  for (let k = 0; k < q.length && !connected; k++) {
    const x = q[k] % w, y = (q[k] / w) | 0;
    for (const [dx, dy] of DIRS8) {
      const a = x + dx, b = y + dy;
      if (a < 0 || b < 0 || a >= w || b >= h || seen[b * w + a] || !side[b * w + a]) continue;
      if (side[b * w + a] === 2) { connected = true; break; }
      seen[b * w + a] = 1; q.push(b * w + a);
    }
  }
  return { connected, port: best };
}

// Distance (in steps over land) from every land tile to the nearest of the goal tiles, cached by key. -1 = not reachable on foot.
const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]], DIRS8 = DIRS4.concat([[1, 1], [1, -1], [-1, 1], [-1, -1]]);
function fieldFor(sim, key, goals) {
  let f = sim.fields.get(key);
  if (f) return f;
  const { w, h, side } = sim.lay;
  f = new Int16Array(w * h).fill(-1);
  const q = [];
  for (const [x, y] of goals) if (x >= 0 && y >= 0 && x < w && y < h && !(f[y * w + x] >= 0)) { f[y * w + x] = 0; q.push(x, y); }
  for (let k = 0; k < q.length; k += 2) {
    const x = q[k], y = q[k + 1], d = f[y * w + x];
    for (const [dx, dy] of DIRS8) {
      const a = x + dx, b = y + dy;
      if (a < 0 || b < 0 || a >= w || b >= h || f[b * w + a] >= 0 || !side[b * w + a]) continue;
      f[b * w + a] = d + 1; q.push(a, b);
    }
  }
  sim.fields.set(key, f);
  return f;
}
const footprint = b => { const t = []; for (let dy = 0; dy < b.size; dy++) for (let dx = 0; dx < b.size; dx++) t.push([b.x + dx, b.y + dy]); return t; };

// One step for a ground unit: walk the land toward a goal (a building's footprint or the port). Returns false if there is no way on foot.
function walk(sim, u, key, goals, speed, dt) {
  const f = fieldFor(sim, key, goals), { w, h } = sim.lay, tx = Math.floor(u.x), ty = Math.floor(u.y);
  if (tx < 0 || ty < 0 || tx >= w || ty >= h || f[ty * w + tx] < 0) return false;
  let bx = tx, by = ty, bd = f[ty * w + tx];
  for (const [dx, dy] of DIRS8) {
    const a = tx + dx, b = ty + dy;
    if (a < 0 || b < 0 || a >= w || b >= h) continue;
    const d = f[b * w + a];
    if (d >= 0 && d < bd) { bd = d; bx = a; by = b; }
  }
  if (bx === tx && by === ty) return false;
  const px = bx + 0.5, py = by + 0.5, dd = dist(u.x, u.y, px, py), m = Math.min(dd, speed * dt);
  if (dd > 0.001) { u.vx = (px - u.x) / dd; u.vy = (py - u.y) / dd; u.x += u.vx * m; u.y += u.vy * m; }
  return true;
}

// Ground troops (infantry, tanks) cannot fly: they walk from their base to the target, and if the sea is in the way they
// march to their coast, sail across in a transport ship and land on the other side.
function marchGround(sim, u, tg, speed, dt) {
  const own = u.side === 'us' ? 1 : 2, l = sim.lay, tx = Math.floor(u.x), ty = Math.floor(u.y);
  const here = (tx < 0 || ty < 0 || tx >= l.w || ty >= l.h) ? 0 : l.side[ty * l.w + tx];
  const from = sim.port && (own === 1 ? sim.port.us : sim.port.them), to = sim.port && (own === 1 ? sim.port.them : sim.port.us);
  if (u.boat) {
    const dd = dist(u.x, u.y, to.x, to.y);
    if (dd < 0.7) u.boat = false;
    else { const m = Math.min(dd, BOAT_SPEED * dt); u.vx = (to.x - u.x) / dd; u.vy = (to.y - u.y) / dd; u.x += u.vx * m; u.y += u.vy * m; return; }
  }
  if (!sim.connected && sim.port && here === own) {
    if (dist(u.x, u.y, from.x, from.y) < 0.7) { u.boat = true; return; }
    if (walk(sim, u, 'port' + own, [[Math.floor(from.x), Math.floor(from.y)]], speed, dt)) return;
  }
  if (!walk(sim, u, 't' + tg.uid, footprint(tg), speed, dt)) {            // no way on foot: wade straight at it
    const dd = dist(u.x, u.y, tg.cx, tg.cy);
    if (dd > 0.01) { const m = Math.min(dd, speed * dt); u.vx = (tg.cx - u.x) / dd; u.vy = (tg.cy - u.y) / dd; u.x += u.vx * m; u.y += u.vy * m; }
  }
}

// The enemy launches an attack wave from its headquarters or barracks every so often, stronger as the war goes on.
function sendWaves(sim) {
  if (sim.t < sim.waveAt) return;
  sim.waveAt += R.waveGap;
  const bases = sim.buildings.filter(b => b.alive && b.side === 'them' && (b.type === 'barracks' || b.type === 'hq'));
  if (!bases.length || !sim.buildings.some(b => b.alive && b.side === 'us')) return;
  const base = bases[Math.floor(sim.rand() * bases.length)];
  const units = pickUnits(sim.power, R.waveBudget + 3 * sim.power + 2 * sim.wave, sim.rand, 14).filter(k => k !== 'satellite');
  sim.wave++;
  units.forEach((type, i) => sim.pending.push({ at: sim.t + i * SPAWN_GAP, type, side: 'them', x: base.cx + (sim.rand() - 0.5) * 2, y: base.cy + (sim.rand() - 0.5) * 2 }));
}

// Troops are not dropped from the sky: they leave your own base (a barracks, else the HQ). Tapping one of the enemy's buildings
// orders them to hit that building first; elsewhere they go for the nearest one.
function baseOf(sim, side) {
  const mine = sim.buildings.filter(b => b.alive && b.side === side);
  return mine.find(b => b.type === 'barracks') || mine.find(b => b.type === 'hq') || mine[0] || null;
}
function pickTarget(sim, x, y) {
  let best = null, bd = 2.5;
  for (const b of sim.buildings) {
    if (!b.alive || b.side !== 'them') continue;
    const d = dist(x, y, b.cx, b.cy) - b.size / 2;
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}
function canDeploy(sim) { return !sim.done && !!baseOf(sim, 'us'); }
function deploy(sim, type, x, y) {
  const base = baseOf(sim, 'us');
  if (sim.done || !(sim.reserve[type] > 0) || !base) return false;
  const d = U[type], focus = pickTarget(sim, x, y);
  sim.reserve[type]--;
  sim.deployed[type] = (sim.deployed[type] || 0) + 1;
  const ox = base.cx + (sim.rand() - 0.5) * base.size * 0.8, oy = base.cy + (sim.rand() - 0.5) * base.size * 0.8;       // they march out of the building
  sim.units.push({ id: sim.nextId++, type, side: 'us', x: ox, y: oy, hp: d.hp, maxHp: d.hp, cool: 0, alive: true, target: focus, air: d.air, ttl: d.ttl == null ? null : d.ttl });
  sim.effects.push({ kind: 'hit', x: ox, y: oy, t0: sim.t, life: 0.3 });
  return true;
}

function warOutcome(sim) {
  const theirs = sim.buildings.filter(b => b.side === 'them'), ours = sim.buildings.filter(b => b.side === 'us');
  const destroyed = theirs.filter(b => !b.alive), pct = theirs.length ? destroyed.length / theirs.length : 0;
  const hq = theirs.find(b => b.type === 'hq'), hqDown = !!hq && !hq.alive;
  const ourHq = ours.find(b => b.type === 'hq');
  const overrun = sim.endReason === 'overrun' || (!!ourHq && !ourHq.alive);
  const stars = overrun ? 0 : (hqDown ? 1 : 0) + (pct >= 0.5 ? 1 : 0) + (pct >= 0.999 ? 1 : 0);
  const survivors = {};
  for (const u of sim.units) if (u.alive && u.side === 'us') survivors[u.type] = (survivors[u.type] || 0) + 1;
  return {
    win: stars >= 1, stars, pct, hqDown, overrun, deployed: Object.assign({}, sim.deployed), survivors, t: sim.t, endReason: sim.endReason,
    ourDestroyed: ours.filter(b => !b.alive).map(b => b.uid), ourTotal: ours.length,
  };
}

function outcome(sim) {
  const total = sim.buildings.length;
  const destroyed = sim.buildings.filter(b => !b.alive);
  const pct = total ? destroyed.length / total : 0;
  const hq = sim.buildings.find(b => b.type === 'hq');
  const win = !!hq && hq.alive && pct < 0.5;
  const rating = !win ? 0 : destroyed.length === 0 ? 3 : pct <= 0.25 ? 2 : 1;
  return { win, rating, pct, destroyed: destroyed.map(b => b.uid), total, endReason: sim.endReason, t: sim.t };
}

// Plays the whole battle at once. With `auto`, an airstrike is thrown at the raider swarm for the player.
function runHeadless(sim, auto) {
  let steps = 0;
  while (!sim.done && steps++ < 5000) {
    if (auto) {
      const a = sim.ability;
      if (a.charges > 0 && a.cd <= 0) {
        const near = sim.units.filter(u => u.alive && dist(u.x, u.y, (sim.bounds.x0 + sim.bounds.x1) / 2, (sim.bounds.y0 + sim.bounds.y1) / 2) < 13);
        if (near.length >= 2) {
          const c = near.reduce((p, u) => ({ x: p.x + u.x / near.length, y: p.y + u.y / near.length }), { x: 0, y: 0 });
          fireStrike(sim, c.x, c.y);
        }
      }
    }
    step(sim);
  }
  if (!sim.done) { sim.done = true; sim.endReason = 'time'; }
  return outcome(sim);
}

E2.raid = { plan, makeSim, step, fireStrike, outcome, runHeadless, DT, makeWarSim, deploy, canDeploy, warOutcome };
})();
