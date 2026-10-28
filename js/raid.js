// Raid planning and the battle simulation. Pure logic: no DOM, so it also runs headless
// when a raid lands while the player is away.
(function () {
'use strict';
const E2 = window.E2;
const B = E2.BUILDINGS, U = E2.UNITS, R = E2.RAID;
const DT = 0.1;
const SPAWN_GAP = 0.5;          // seconds between units entering
const SPAWN_DIST = 9;           // cells beyond the base before units appear

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
  } else {
    let budget = 30 + 30 * hqLevel + 6 * att.power + 5 * Math.min(faced, 10);
    const allowed = Object.keys(U).filter(k => att.power >= U[k].minPower);
    const total = allowed.reduce((s, k) => s + U[k].weight, 0);
    while (units.length < 40) {
      let r = rand() * total, pick = allowed[0];
      for (const k of allowed) { r -= U[k].weight; if (r <= 0) { pick = k; break; } }
      if (U[pick].cost > budget) {
        const cheap = allowed.filter(k => U[k].cost <= budget);
        if (!cheap.length) break;
        pick = cheap[0];
      }
      units.push(pick); budget -= U[pick].cost;
    }
  }
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
      hp, maxHp: hp, alive: true, cool: 0, tower: def.tower ? Object.assign({}, def.tower, { dmgNow: def.tower.dmg[b.level - 1] }) : null,
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
    if (!b.alive) continue;
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
    sim.units.push({ id: sim.nextId++, type: p.type, x: p.x, y: p.y, hp: d.hp, maxHp: d.hp, cool: 0, alive: true, target: null, air: d.air, ttl: d.ttl == null ? null : d.ttl });
  }

  // Strikes landing: when defending they hit raiders, when attacking they bomb buildings.
  for (let i = sim.strikes.length - 1; i >= 0; i--) {
    const s = sim.strikes[i];
    if (s.fireAt > sim.t) continue;
    sim.strikes.splice(i, 1);
    if (sim.mode === 'attack') {
      sim.effects.push({ kind: 'boom', x: s.x, y: s.y, r: R.bomb.radius, t0: sim.t, life: 0.7 });
      for (const b of sim.buildings) if (b.alive && dist(b.cx, b.cy, s.x, s.y) <= R.bomb.radius + b.size / 2) damageBuilding(sim, b, R.bomb.dmg);
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
      if (!u.alive) continue;
      if ((b.tower.targets === 'air') !== u.air) continue;
      const d = dist(b.cx, b.cy, u.x, u.y);
      if (d <= td) { td = d; tgt = u; }
    }
    if (!tgt) continue;
    b.cool = b.tower.rate;
    sim.effects.push({ kind: 'shot', x1: b.cx, y1: b.cy, x2: tgt.x, y2: tgt.y, t0: sim.t, life: 0.15, air: tgt.air });
    if (b.tower.splash) {
      sim.effects.push({ kind: 'boom', x: tgt.x, y: tgt.y, r: b.tower.splash, t0: sim.t, life: 0.4 });
      for (const u of sim.units) if (u.alive && !u.air && dist(u.x, u.y, tgt.x, tgt.y) <= b.tower.splash) damageUnit(sim, u, b.tower.dmgNow);
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
    if (!u.target || !u.target.alive) u.target = nearestBuilding(sim, u);
    const tg = u.target;
    if (!tg) continue;
    const dd = dist(u.x, u.y, tg.cx, tg.cy);
    if (dd > 0.01) { u.vx = (tg.cx - u.x) / dd; u.vy = (tg.cy - u.y) / dd; }          // heading, for drawing flyers nose-first

    if (u.type === 'missile') {
      if (dd <= d.range) {
        u.alive = false;
        sim.effects.push({ kind: 'boom', x: u.x, y: u.y, r: d.splash, t0: sim.t, life: 0.5 });
        for (const b of sim.buildings) if (b.alive && dist(u.x, u.y, b.cx, b.cy) <= d.splash + b.size / 2) damageBuilding(sim, b, d.dmg);
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
  if (sim.mode === 'attack') {                           // you attack: the battle runs until you are spent
    const reserve = Object.values(sim.reserve).reduce((a, b) => a + b, 0);
    if (!sim.buildings.some(b => b.alive)) { sim.done = true; sim.endReason = 'wiped'; }
    else if (!reserve && !unitsAlive && !sim.strikes.length && !sim.expecting) { sim.done = true; sim.endReason = 'spent'; }
    else if (sim.t >= sim.limit && !sim.expecting) { sim.done = true; sim.endReason = 'time'; }
    return;
  }
  const raidersLeft = sim.pending.length + unitsAlive;
  if (hq && !hq.alive) { sim.done = true; sim.endReason = 'hq'; }
  else if (!raidersLeft) { sim.done = true; sim.endReason = 'repelled'; }
  else if (!sim.buildings.some(b => b.alive)) { sim.done = true; sim.endReason = 'wiped'; }
  else if (sim.t >= R.maxTime) { sim.done = true; sim.endReason = 'time'; }
}

// ---------- Your attacks ----------
// enemy = { id, buildings:[{uid,type,x,y,level}] } (see E2.enemy). army = { infantry: n, tank: n, ... }.
function makeAttackSim(enemy, army) {
  const blds = [];
  for (const b of enemy.buildings) {
    const def = B[b.type], hp = E2.hpOf(b.type, b.level);
    blds.push({
      uid: b.uid, type: b.type, level: b.level, size: def.size, x: b.x, y: b.y, cx: b.x + def.size / 2, cy: b.y + def.size / 2,
      hp, maxHp: hp, alive: true, cool: 0, tower: def.tower ? Object.assign({}, def.tower, { dmgNow: def.tower.dmg[b.level - 1] }) : null,
    });
  }
  const sim = {
    t: 0, done: false, mode: 'attack', rand: rng(7), buildings: blds, byUid: {}, units: [], pending: [], effects: [], strikes: [],
    ability: { charges: R.strike.charges, cd: 0 }, nextId: 1, endReason: null,
    reserve: Object.assign({}, army), deployed: {},
    expecting: 0, limit: R.maxTime,                      // units still travelling to the battle / time limit (grows as they arrive)
  };
  for (const b of blds) sim.byUid[b.uid] = b;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const b of blds) { x0 = Math.min(x0, b.x); x1 = Math.max(x1, b.x + b.size); y0 = Math.min(y0, b.y); y1 = Math.max(y1, b.y + b.size); }
  sim.bounds = { x0, x1, y0, y1 };
  return sim;
}

// Units may only land outside the enemy base.
function canDeploy(sim, x, y) {
  const b = sim.bounds;
  return x < b.x0 - 1 || x > b.x1 + 1 || y < b.y0 - 1 || y > b.y1 + 1;
}
function deploy(sim, type, x, y) {
  if (sim.done || !(sim.reserve[type] > 0) || !canDeploy(sim, x, y)) return false;
  const d = U[type];
  sim.reserve[type]--;
  sim.deployed[type] = (sim.deployed[type] || 0) + 1;
  sim.units.push({ id: sim.nextId++, type, x, y, hp: d.hp, maxHp: d.hp, cool: 0, alive: true, target: null, air: d.air, ttl: d.ttl == null ? null : d.ttl });
  sim.effects.push({ kind: 'hit', x, y, t0: sim.t, life: 0.3 });
  return true;
}

function attackOutcome(sim) {
  const total = sim.buildings.length;
  const destroyed = sim.buildings.filter(b => !b.alive);
  const pct = total ? destroyed.length / total : 0;
  const hq = sim.buildings.find(b => b.type === 'hq');
  const hqDown = !!hq && !hq.alive;
  const stars = (hqDown ? 1 : 0) + (pct >= 0.5 ? 1 : 0) + (pct >= 0.999 ? 1 : 0);
  const survivors = {};
  for (const u of sim.units) if (u.alive) survivors[u.type] = (survivors[u.type] || 0) + 1;
  return { win: stars >= 1, stars, pct, hqDown, deployed: Object.assign({}, sim.deployed), survivors, t: sim.t, endReason: sim.endReason };
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

E2.raid = { plan, makeSim, step, fireStrike, outcome, runHeadless, DT, makeAttackSim, deploy, canDeploy, attackOutcome };
})();
