// Game state, rules and timers. No DOM here.
// The empire is a set of territories (your homeland plus every country you conquer). Each has its own
// buildings and land; resources, builders, army and XP are shared. `S.buildings` is always the list of
// the territory being viewed (or of the enemy base during an attack) and is never saved on its own.
(function () {
'use strict';
const E2 = window.E2;
const KEY = 'e2.save.v1';
const B = E2.BUILDINGS;

let S = null;
let memorySave = null;          // fallback when localStorage is unavailable
let gridCache = null;
let enemyView = null;           // { id, grid, buildings } while an attack is shown

const newRaidState = createdAt => ({ nextAt: createdAt + E2.RAID.firstDelay, shieldUntil: 0, pending: null, faced: 0, history: [] });
const emptyArmy = () => Object.fromEntries(E2.ARMY_KEYS.map(k => [k, 0]));

// ---------- Persistence ----------
function readRaw() {
  try { const r = localStorage.getItem(KEY); if (r) return r; } catch (e) { /* storage blocked */ }
  return memorySave;
}
function writeRaw(str) {
  memorySave = str;
  try { localStorage.setItem(KEY, str); } catch (e) { /* storage blocked */ }
}

function load() {
  const raw = readRaw();
  if (!raw) return false;
  try {
    const d = JSON.parse(raw);
    if (!d || d.v !== 2 || !E2.byId(d.homeland)) return false;      // v1 saves used a differently turned land grid
    if (!d.raid) d.raid = newRaidState(d.createdAt);
    d.xp = d.xp || 0;
    delete d.trophies;                                      // older saves had a trophy count that is no longer used
    d.army = Object.assign(emptyArmy(), d.army || {});
    d.colonies = d.colonies || [];
    if (!d.land) d.land = { [d.homeland]: { buildings: d.buildings || [] } };   // older saves
    for (const l of Object.values(d.land)) { l.cleared = l.cleared || []; l.jobs = l.jobs || []; }
    d.view = d.land[d.view] ? d.view : d.homeland;
    d.buildings = d.land[d.view].buildings;
    S = d; gridCache = null; enemyView = null;
    return true;
  } catch (e) { return false; }
}
function save() {
  if (!S) return;
  const copy = Object.assign({}, S);
  delete copy.buildings;                                  // derived from S.land[S.view]
  writeRaw(JSON.stringify(copy));
}
function reset() {
  S = null; gridCache = null; memorySave = null; enemyView = null;
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
}

// ---------- Views and grid ----------
const mkGrid = c => {
  const g = E2.isoGrid(c);                                  // north-up land grid (see defs.js)
  return { w: g.w, h: g.h, rows: g.rows, isLand: (x, y) => x >= 0 && y >= 0 && x < g.w && y < g.h && g.rows[y][x] === '1' };
};
function grid() {
  if (enemyView) return enemyView.grid;
  if (!gridCache) gridCache = mkGrid(E2.byId(S.view));
  return gridCache;
}
const viewId = () => enemyView ? enemyView.id : S.view;
const owned = () => [S.homeland].concat(S.colonies);
const all = () => Object.values(S.land).flatMap(l => l.buildings);
const homeBuildings = () => S.land[S.homeland].buildings;

function switchView(id) {
  if (!S.land[id]) return false;
  S.view = id; S.buildings = S.land[id].buildings; gridCache = null;
  save();
  return true;
}
function enterEnemy(enemy) {
  enemyView = { id: enemy.id, grid: mkGrid(E2.byId(enemy.id)), buildings: enemy.buildings };
  S.buildings = enemy.buildings;
}
function exitEnemy() {
  enemyView = null;
  S.buildings = S.land[S.view].buildings;
}
const inEnemyView = () => !!enemyView;

// Everything the raid engine needs about your homeland.
const raidView = () => ({ homeland: S.homeland, raid: S.raid, buildings: homeBuildings(), owned: owned() });

// ---------- Queries ----------
const get = () => S;
const hq = () => S.buildings.find(b => b.type === 'hq');
const hqLevel = () => homeBuildings().find(b => b.type === 'hq').level;
const caps = () => {
  let cap = E2.HQ.baseCap[hqLevel() - 1];
  for (const b of all()) if (b.type === 'vault' && b.level >= 1 && !b.ruined) cap += B.vault.storage[b.level - 1];
  return cap;
};
// Vaults keep part of your stock safe from raiders.
const protectedAmount = () => all().reduce((sum, b) => sum + (b.type === 'vault' && b.level >= 1 && !b.ruined ? B.vault.storage[b.level - 1] * 0.5 : 0), 0);
const maxLevelFor = type => type === 'hq' ? B.hq.levels.length : Math.min(B[type].levels.length, E2.HQ.levelCap[hqLevel() - 1]);
const maxCount = type => B[type].maxCount[hqLevel() - 1];
const countOf = type => S.buildings.filter(b => b.type === type).length;
const jobCount = () => Object.values(S.land).reduce((n, l) => n + l.jobs.length, 0);
const busy = () => all().filter(b => b.endAt).length + jobCount();      // a builder is busy on a building or clearing an obstacle
const freeBuilders = () => S.builders - busy();
const byUid = uid => S.buildings.find(b => b.uid === uid) || all().find(b => b.uid === uid);
const canAfford = cost => Object.entries(cost).every(([k, v]) => S.resources[k] >= v);
const missing = cost => Object.entries(cost).filter(([k, v]) => S.resources[k] < v).map(([k]) => k);

function occupant(x, y, skipUid) {
  for (const b of S.buildings) {
    if (b.uid === skipUid) continue;
    const s = B[b.type].size;
    if (x >= b.x && x < b.x + s && y >= b.y && y < b.y + s) return b;
  }
  return null;
}
// ---------- Obstacles (trees and rocks) ----------
// Remaining obstacles of the territory being viewed, by tile index. Cleared ones are gone for good.
const NO_OBSTACLES = new Map();
let obsCache = { id: null, n: -1, map: NO_OBSTACLES };
function obstacleMap() {
  if (enemyView) return NO_OBSTACLES;                       // enemy land is only scenery
  const L = S.land[S.view];
  if (obsCache.id !== S.view || obsCache.n !== L.cleared.length) {
    const gone = new Set(L.cleared), map = new Map();
    for (const o of E2.obstaclesOf(E2.byId(S.view))) if (!gone.has(o.cell)) map.set(o.cell, o);
    obsCache = { id: S.view, n: L.cleared.length, map };
  }
  return obsCache.map;
}
const obstacleAt = (x, y) => obstacleMap().get(y * grid().w + x) || null;
// What the map should draw: your remaining obstacles, or an enemy country's untouched scenery.
const visualObstacles = () => enemyView ? E2.obstaclesOf(E2.byId(enemyView.id)) : [...obstacleMap().values()];
const jobs = () => (enemyView ? [] : S.land[S.view].jobs);

function startClear(x, y, now = Date.now()) {
  const o = obstacleAt(x, y);
  if (!o) return { ok: false, reason: 'Nothing to clear here.' };
  const L = S.land[S.view];
  if (L.jobs.some(j => j.cell === o.cell)) return { ok: false, reason: 'Already being cleared.' };
  if (freeBuilders() < 1) return { ok: false, reason: 'All builders are busy.' };
  const def = E2.OBSTACLE[o.kind];
  if (!canAfford(def.cost)) return { ok: false, reason: 'Not enough resources.' };
  pay(def.cost);
  L.jobs.push({ cell: o.cell, kind: o.kind, startAt: now, endAt: now + def.time * 1000 });
  save();
  return { ok: true, o };
}

// Why a building cannot go here: 'land' (sea or edge), 'obstacle' (a tree or rock), 'building', or null if it fits.
// skipUid: a building being moved does not block its own new spot.
function placeBlock(type, x, y, gap = 0, ignoreObstacles = false, skipUid = null) {
  const s = B[type].size, g = grid();
  for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) if (!g.isLand(x + dx, y + dy)) return 'land';
  if (!ignoreObstacles) {
    const om = obstacleMap();
    for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) if (om.has((y + dy) * g.w + x + dx)) return 'obstacle';
  }
  for (let dy = -gap; dy < s + gap; dy++) for (let dx = -gap; dx < s + gap; dx++) if (occupant(x + dx, y + dy, skipUid)) return 'building';
  if (B[type].coast && !touchesSea(x, y, s, g)) return 'coast';
  return null;
}
// True when a footprint has open water right beside one of its sides (the edge of the map counts as sea).
function touchesSea(x, y, s, g) {
  for (let i = 0; i < s; i++) {
    if (!g.isLand(x - 1, y + i) || !g.isLand(x + s, y + i) || !g.isLand(x + i, y - 1) || !g.isLand(x + i, y + s)) return true;
  }
  return false;
}
// gap = extra empty cells required around the footprint (used for the starter layout).
const canPlace = (type, x, y, gap = 0, ignoreObstacles = false) => placeBlock(type, x, y, gap, ignoreObstacles) === null;

// ---------- Production ----------
function advance(b, t) {
  const def = B[b.type];
  if (def.produces && b.level >= 1 && !b.ruined && t > b.tickAt) {
    const cap = E2.holdCap(b.type, b.level);
    b.stored = Math.min(cap, b.stored + E2.rateOf(b.type, b.level) * (t - b.tickAt) / 3600000);
  }
  b.tickAt = Math.max(b.tickAt, t);
}

// Moves time forward: finishes constructions and fills collectors. Returns the buildings that finished.
function tick(now) {
  const done = [];
  for (const [id, L] of Object.entries(S.land)) {           // finished obstacle jobs: the tree or rock is gone for good
    for (const j of L.jobs.filter(j => j.endAt <= now)) {
      L.jobs.splice(L.jobs.indexOf(j), 1);
      L.cleared.push(j.cell);
      const before = E2.levelInfo(S.xp).level;
      S.xp += E2.OBSTACLE[j.kind].xp;
      if (E2.levelInfo(S.xp).level > before) done.leveled = E2.levelInfo(S.xp).level;
      done.push({ clear: { kind: j.kind, cell: j.cell, land: id } });
    }
  }
  for (const b of all()) {
    if (b.trip && b.trip.endAt <= now) {                  // the ship is back: the cargo has been sold
      const t = b.trip, room = Math.max(0, caps() - S.resources.gold), gained = Math.min(t.reward, Math.floor(room));
      S.resources.gold += gained;
      delete b.trip;
      done.push({ trade: { to: t.to, res: t.res, amount: t.amount, reward: t.reward, gained } });
    }
    if (b.endAt && b.endAt <= now) {
      advance(b, b.endAt);
      const wasNew = b.level === 0;
      b.level = b.upTo; b.upTo = null; b.endAt = null; b.startAt = null;
      const wasRepair = !!b.ruined;
      b.ruined = false;
      if (!wasRepair) {                                  // finishing work earns XP
        const secs = B[b.type].levels[b.level - 1].time;
        const before = E2.levelInfo(S.xp).level;
        S.xp += Math.max(5, Math.round(Math.sqrt(secs) * 1.2));
        if (E2.levelInfo(S.xp).level > before) done.leveled = E2.levelInfo(S.xp).level;
      }
      done.push({ b, wasNew, wasRepair });
    }
    advance(b, now);
  }
  S.savedAt = now;
  return done;
}

// ---------- Actions ----------
function pay(cost) { for (const [k, v] of Object.entries(cost)) S.resources[k] -= v; }

function startBuild(type, x, y, now = Date.now()) {
  const def = B[type];
  if (!def || def.noBuild) return { ok: false, reason: 'Cannot build that.' };
  if (countOf(type) >= maxCount(type)) return { ok: false, reason: 'Upgrade your HQ to build more.' };
  const why = placeBlock(type, x, y);
  if (why) return { ok: false, reason: why === 'coast' ? 'A harbor has to touch the sea.' : 'Not enough free land there.' };
  if (freeBuilders() < 1) return { ok: false, reason: 'All builders are busy.' };
  const lv = def.levels[0];
  if (!canAfford(lv.cost)) return { ok: false, reason: 'Not enough resources.' };
  pay(lv.cost);
  const b = { uid: S.nextUid++, type, x, y, level: 0, upTo: 1, startAt: now, endAt: now + lv.time * 1000, stored: 0, tickAt: now };
  S.buildings.push(b);
  save();
  return { ok: true, b };
}

// Moving a finished building to another free spot costs nothing and is saved at once.
function moveBlock(b) {
  if (inEnemyView()) return 'You can only rearrange your own land.';
  if (b.level < 1) return 'Wait until it is built.';
  return null;
}
function moveBuilding(uid, x, y) {
  const b = byUid(uid), block = b ? moveBlock(b) : 'Building not found.';
  if (block) return { ok: false, reason: block };
  const why = placeBlock(b.type, x, y, 0, false, uid);
  if (why) return { ok: false, reason: why === 'coast' ? 'A harbor has to touch the sea.' : 'Not enough free land there.' };
  b.x = x; b.y = y;
  save();
  return { ok: true, b };
}

function upgradeBlock(b) {
  if (b.endAt) return 'Already under construction.';
  if (b.ruined) return 'Repair it first.';
  const next = b.level + 1;
  if (next > maxLevelFor(b.type)) {
    return b.type === 'hq' || next > B[b.type].levels.length ? 'Max level reached.' : 'Upgrade your HQ first.';
  }
  if (freeBuilders() < 1) return 'All builders are busy.';
  if (!canAfford(B[b.type].levels[next - 1].cost)) return 'Not enough resources.';
  return null;
}
function startUpgrade(uid, now = Date.now()) {
  const b = byUid(uid);
  if (!b) return { ok: false, reason: 'Building not found.' };
  const block = upgradeBlock(b);
  if (block) return { ok: false, reason: block };
  const lv = B[b.type].levels[b.level];
  pay(lv.cost);
  b.upTo = b.level + 1; b.startAt = now; b.endAt = now + lv.time * 1000;
  save();
  return { ok: true, b };
}

// Ruined buildings cost about half of their level price and a short timer to bring back.
function repairCost(b) {
  if (b.type === 'hq') return { gold: 400 * b.level, steel: 100 * b.level };
  const cost = {};
  for (const [k, v] of Object.entries(B[b.type].levels[b.level - 1].cost)) cost[k] = Math.ceil(v / 2);
  return cost;
}
const repairTime = b => b.type === 'hq' ? 60 * b.level : Math.max(10, Math.round(B[b.type].levels[b.level - 1].time * 0.2));

function repairBlock(b) {
  if (!b.ruined) return 'Not damaged.';
  if (b.endAt) return 'Already being repaired.';
  if (freeBuilders() < 1) return 'All builders are busy.';
  if (!canAfford(repairCost(b))) return 'Not enough resources.';
  return null;
}
function startRepair(uid, now = Date.now()) {
  const b = byUid(uid);
  if (!b) return { ok: false, reason: 'Building not found.' };
  const block = repairBlock(b);
  if (block) return { ok: false, reason: block };
  pay(repairCost(b));
  b.upTo = b.level; b.startAt = now; b.endAt = now + repairTime(b) * 1000;
  save();
  return { ok: true, b };
}

function finishNow(uid, now = Date.now()) {
  const b = byUid(uid);
  if (!b || !b.endAt) return [];
  b.endAt = now;
  const done = tick(now);
  save();
  return done;
}

// Moves a collector's stored output into the treasury (up to the storage cap).
function collect(uid, now = Date.now()) {
  const b = byUid(uid);
  const def = b && B[b.type];
  if (!def || !def.produces || b.ruined) return { res: null, amount: 0, full: false };
  advance(b, now);
  const k = def.produces, cap = caps();
  const room = Math.max(0, cap - S.resources[k]);
  const avail = Math.floor(b.stored);
  const amount = Math.min(avail, Math.floor(room));
  S.resources[k] += amount;
  b.stored -= amount;
  save();
  return { res: k, amount, full: amount < avail };
}

function collectAll(now = Date.now()) {
  const totals = {};
  for (const b of all()) {
    if (!B[b.type].produces || b.level < 1 || b.ruined) continue;
    const r = collect(b.uid, now);
    if (r.amount) totals[r.res] = (totals[r.res] || 0) + r.amount;
  }
  return totals;
}

// ---------- Trade ----------
// A harbor loads oil or steel onto a ship that sails to another country and comes back with gold.
// The trip is stored on the harbor: b.trip = { to, res, amount, reward, startAt, endAt }.
const harborCapacity = b => B.harbor.capacity[b.level - 1] || 0;
const tradeTargets = () => E2.reachable(owned());
const landOf = b => Object.keys(S.land).find(id => S.land[id].buildings.includes(b));

function tradeBlock(b, res, amount, to) {
  if (b.type !== 'harbor' || b.level < 1) return 'Build the harbor first.';
  if (b.ruined) return 'Repair the harbor first.';
  if (b.endAt) return 'The harbor is under construction.';
  if (b.trip) return 'The ship is already at sea.';
  if (!E2.TRADE.price[res]) return 'Choose a cargo.';
  if (!(amount >= 1) || amount > harborCapacity(b)) return 'The ship cannot carry that much.';
  if (S.resources[res] < amount) return `Not enough ${E2.RES[res].name.toLowerCase()}.`;
  if (!tradeTargets().includes(to)) return 'Choose a destination.';
  return null;
}
function startTrade(uid, res, amount, to, now = Date.now()) {
  const b = byUid(uid), block = b ? tradeBlock(b, res, amount, to) : 'Harbor not found.';
  if (block) return { ok: false, reason: block };
  const q = E2.tradeQuote(res, amount, landOf(b), to);
  S.resources[res] -= amount;
  b.trip = { to, res, amount, reward: q.reward, startAt: now, endAt: now + q.secs * 1000 };
  save();
  return { ok: true, trip: b.trip };
}
// Every ship at sea, for drawing on the world map.
const trips = () => all().filter(b => b.trip && b.level >= 1).map(b => ({ uid: b.uid, from: landOf(b), tier: b.level, ...b.trip }));

// ---------- Army ----------
const armyCapacity = () => all().reduce((s, b) => s + (b.type === 'barracks' && b.level >= 1 && !b.ruined ? B.barracks.capacity[b.level - 1] : 0), 0);
const armyUsed = () => E2.ARMY_KEYS.reduce((s, k) => s + S.army[k] * E2.ARMY[k].space, 0);
const labLevel = () => all().reduce((m, b) => b.type === 'researchLab' && b.level >= 1 && !b.ruined ? Math.max(m, b.level) : m, 0);

function trainBlock(type, n = 1) {
  const u = E2.ARMY[type];
  if (labLevel() < u.lab) return `Needs a Research Lab level ${u.lab}.`;
  if (armyUsed() + u.space * n > armyCapacity()) return 'Not enough barracks room.';
  const cost = {};
  for (const [k, v] of Object.entries(u.cost)) cost[k] = v * n;
  if (!canAfford(cost)) return 'Not enough resources.';
  return null;
}
function train(type, n = 1) {
  const block = trainBlock(type, n);
  if (block) return { ok: false, reason: block };
  for (const [k, v] of Object.entries(E2.ARMY[type].cost)) S.resources[k] -= v * n;
  S.army[type] += n;
  save();
  return { ok: true };
}
function disband(type) {
  if (S.army[type] < 1) return false;
  S.army[type]--;
  const u = E2.ARMY[type];
  for (const [k, v] of Object.entries(u.cost)) S.resources[k] = Math.min(caps(), S.resources[k] + Math.floor(v * 0.5));
  save();
  return true;
}

// ---------- New game and conquest ----------
function findSpot(type, cx, cy, gap) {
  const g = grid(), s = B[type].size;
  let best = null, bestD = Infinity;
  for (let y = 0; y <= g.h - s; y++) for (let x = 0; x <= g.w - s; x++) {
    if (!canPlace(type, x, y, gap, true)) continue;          // the starting HQ ignores trees and rocks: they are cleared around it
    const d = (x + s / 2 - cx) ** 2 + (y + s / 2 - cy) ** 2;
    if (d < bestD) { bestD = d; best = { x, y }; }
  }
  return best;
}
function centroid() {
  const g = grid();
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (g.isLand(x, y)) { sx += x + 0.5; sy += y + 0.5; n++; }
  return { x: sx / n, y: sy / n };
}
function placeStarter(type, level, gap, fx, fy, now) {
  const spot = findSpot(type, fx, fy, gap) || (gap ? findSpot(type, fx, fy, 0) : null);
  if (!spot) return null;
  const b = { uid: S.nextUid++, type, x: spot.x, y: spot.y, level, upTo: null, startAt: null, endAt: null, stored: 0, tickAt: now };
  S.buildings.push(b);
  // The land around a starting building is already cleared.
  const g = grid(), s = B[type].size, L = S.land[S.view], done = new Set(L.cleared);
  for (let dy = -1; dy <= s; dy++) for (let dx = -1; dx <= s; dx++) {
    const cell = (spot.y + dy) * g.w + spot.x + dx;
    if (!done.has(cell)) { L.cleared.push(cell); done.add(cell); }
  }
  return b;
}

function create(countryId, now = Date.now()) {
  S = {
    v: 2, homeland: countryId, view: countryId, createdAt: now, savedAt: now,
    resources: Object.assign({}, E2.START_RES),
    builders: E2.BUILDERS, nextUid: 1, xp: 0,
    army: emptyArmy(), colonies: [], land: { [countryId]: { buildings: [], cleared: [], jobs: [] } },
    raid: newRaidState(now), won: false,
  };
  S.buildings = S.land[countryId].buildings;
  gridCache = null; enemyView = null;

  // The country starts empty: only the headquarters, in the real capital city (the middle of the land if none is on file).
  const cap = E2.capitalSpot(E2.byId(countryId)), mid = centroid();
  placeStarter('hq', 1, 0, cap ? cap.x + 0.5 : mid.x, cap ? cap.y + 0.5 : mid.y, now);
  save();
  return S;
}

// A conquered country becomes a territory: empty land (trees and rocks) for you to build on.
function addColony(id) {
  if (S.land[id]) return false;
  S.land[id] = { buildings: [], cleared: [], jobs: [] };
  S.colonies.push(id);
  save();
  return true;
}

// ---------- Raids against you ----------
// Applies a finished battle to the empire: ruins, loot or bounty, shield and the next raid time.
// `outcome` comes from E2.raid (win, destroyed uids, rating...). Returns a report for the UI.
function applyRaid(raid, outcome, now = Date.now()) {
  const R = S.raid, att = E2.byId(raid.attackerId);
  const report = { attackerId: raid.attackerId, win: outcome.win, rating: outcome.rating, destroyed: outcome.destroyed.slice(), loot: {}, bounty: 0, shielded: false };

  const home = homeBuildings();
  for (const uid of outcome.destroyed) { const b = home.find(x => x.uid === uid); if (b) b.ruined = true; }

  if (outcome.win) {
    const bounty = 60 + 20 * (att ? att.power : 1);
    const room = Math.max(0, caps() - S.resources.gold);
    report.bounty = Math.min(bounty, Math.floor(room));
    S.resources.gold += report.bounty;
  } else {
    const prot = protectedAmount();
    for (const k of E2.RES_KEYS) {
      const lootable = Math.max(0, S.resources[k] - prot);
      let take = Math.floor(lootable * 0.25);
      S.resources[k] -= take;
      for (const b of all()) {                          // stock sitting in collectors is raided too
        if (B[b.type].produces === k && b.level >= 1) { const t = Math.floor(b.stored * 0.3); b.stored -= t; take += t; }
      }
      if (take > 0) report.loot[k] = take;
    }
    R.shieldUntil = now + E2.RAID.lossShield;
    report.shielded = true;
  }

  R.faced++;
  R.pending = null;
  const [lo, hi] = E2.RAID.gap;
  R.nextAt = Math.max(now, R.shieldUntil) + lo + Math.random() * (hi - lo);
  R.history.push({ at: now, from: raid.attackerId, win: outcome.win, kind: 'defence' });
  if (R.history.length > 30) R.history.shift();
  save();
  return report;
}

// ---------- Your attacks ----------
// outcome: from E2.raid.attackOutcome. enemy: from E2.enemy.generate. Returns a report for the UI.
function applyAttack(enemy, outcome, now = Date.now()) {
  const report = { targetId: enemy.id, win: outcome.win, stars: outcome.stars, pct: outcome.pct, loot: {}, captured: false, lost: {}, ranked: null };

  for (const k of E2.ARMY_KEYS) {                       // survivors and units never sent go home
    const had = S.army[k], sent = outcome.deployed[k] || 0, back = outcome.survivors[k] || 0;
    S.army[k] = had - sent + back;
    if (sent - back > 0) report.lost[k] = sent - back;
  }

  if (outcome.stars >= 1) {
    const share = [0, 0.4, 0.7, 1][outcome.stars];
    for (const k of E2.RES_KEYS) {
      const room = Math.max(0, caps() - S.resources[k]);
      const take = Math.min(Math.floor(enemy.loot[k] * share), Math.floor(room));
      S.resources[k] += take;
      if (take > 0) report.loot[k] = take;
    }
  }
  if (outcome.hqDown && !S.land[enemy.id]) {
    addColony(enemy.id, now);
    report.captured = true;
    S.xp += 50 + 10 * E2.byId(enemy.id).power;
    report.ranked = E2.rankOf(S.colonies.length);
  }
  S.raid.history.push({ at: now, from: enemy.id, win: outcome.stars >= 1, kind: 'attack' });
  if (S.raid.history.length > 30) S.raid.history.shift();
  save();
  return report;
}

// Debug only (needs ?debug=1): plenty of everything so attacks and battles can be tested.
function cheat() {
  if (!E2.DEBUG || !S) return;
  for (const k of E2.RES_KEYS) S.resources[k] = Math.max(S.resources[k], 999999);
  for (const k of E2.ARMY_KEYS) S.army[k] = Math.max(S.army[k] || 0, 25);
  save();
}

// ---------- A strike force on its way to another country ----------
// S.strike = { target, from, km, startAt, groups: { unitType: { n, secs, arriveAt } } }. Units stay in S.army until the battle is settled.
function strikePlan(targetId) {
  const t = E2.byId(targetId);
  let from = null, km = Infinity;
  for (const id of owned()) {                              // launch from the nearest territory
    const d = E2.distanceKm(E2.byId(id), t);
    if (d < km) { km = d; from = id; }
  }
  const groups = {};
  for (const k of E2.ARMY_KEYS) if (S.army[k] > 0) groups[k] = { n: S.army[k], secs: E2.travelSecs(k, km) };
  return { target: targetId, from, km: Math.round(km), groups };
}
function startStrike(targetId, now = Date.now()) {
  if (S.strike) return null;
  const plan = strikePlan(targetId);
  if (!Object.keys(plan.groups).length) return null;
  for (const g of Object.values(plan.groups)) g.arriveAt = now + g.secs * 1000;
  S.strike = Object.assign(plan, { startAt: now });
  save();
  return S.strike;
}
const strike = () => (S && S.strike) || null;
function endStrike() { if (S) { S.strike = null; save(); } }

E2.state = {
  cheat, strikePlan, startStrike, strike, endStrike,  get, load, save, reset, create, grid, tick, viewId, owned, all, homeBuildings, switchView, enterEnemy, exitEnemy, inEnemyView, raidView,
  hq, hqLevel, caps, maxLevelFor, maxCount, countOf, busy, freeBuilders, byUid,
  canAfford, missing, occupant, canPlace, placeBlock, upgradeBlock, obstacleAt, visualObstacles, jobs, startClear,
  startBuild, moveBlock, moveBuilding, startUpgrade, finishNow, collect, collectAll,
  harborCapacity, tradeTargets, tradeBlock, startTrade, trips,
  repairCost, repairTime, repairBlock, startRepair, applyRaid,
  armyCapacity, armyUsed, labLevel, trainBlock, train, disband, applyAttack, addColony,
};
})();
