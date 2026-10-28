// Static game definitions: resources, buildings, formulas, formatters.
(function () {
'use strict';
const E2 = window.E2 = window.E2 || {};
const M = 60, H = 3600;

E2.COUNTRIES = window.E2_COUNTRIES || [];
E2.byId = id => E2.COUNTRIES.find(c => c.id === id);
// Stable pseudo-random number in [0,1) for a tile, so the same country always gets the same trees and rocks.
E2.hash = (x, y, s) => {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// Trees and rocks block building until you remove them (cost in gold, a builder, a short job).
E2.OBSTACLE = {
  tree: { name: 'Tree', cost: { gold: 20 }, time: 8, xp: 2 },
  rock: { name: 'Rock', cost: { gold: 40 }, time: 15, xp: 4 },
};
const obsCache = {};
// Every tree and rock a country starts with. Positions are tiles on its isometric land grid.
E2.obstaclesOf = c => {
  if (obsCache[c.id]) return obsCache[c.id];
  const g = E2.isoGrid(c), seed = Array.from(c.id).reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7);
  const list = [];
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    if (g.rows[y][x] !== '1' || E2.hash(x, y, seed) > 0.11) continue;
    list.push({
      cell: y * g.w + x, tx: x, ty: y, kind: E2.hash(x, y, seed + 1) < 0.7 ? 'tree' : 'rock',
      jx: (E2.hash(x, y, seed + 2) - 0.5) * 0.5, jy: (E2.hash(x, y, seed + 3) - 0.5) * 0.5,
      k: 0.8 + 0.4 * E2.hash(x, y, seed + 4), v: E2.hash(x, y, seed + 5),
    });
  }
  return (obsCache[c.id] = list);
};

// The base is drawn isometrically, which turns the ground 45 degrees. To keep every country the right way up
// (north at the top, west on the left, like a world map) the country's land grid is re-sampled once so that,
// after the isometric turn, north points straight up. One new tile covers about one old cell, so sizes stay the same.
// A rough size on the world map (outline bounding boxes), used to draw big countries first so small ones stay tappable.
const areaCache = {};
E2.areaOf = c => areaCache[c.id] ?? (areaCache[c.id] = c.outline.reduce((sum, ring) => {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < ring.length; i += 2) { x0 = Math.min(x0, ring[i]); x1 = Math.max(x1, ring[i]); y0 = Math.min(y0, ring[i + 1]); y1 = Math.max(y1, ring[i + 1]); }
  return sum + (x1 - x0) * (y1 - y0);
}, 0));
E2.popText = n => n >= 1e9 ? (n / 1e9).toFixed(1) + ' billion' : n >= 1e6 ? Math.round(n / 1e6) + ' million' : n >= 1e3 ? Math.round(n / 1e3) + ' thousand' : String(n);

// The data file stores each country's land as run lengths per row (empty, land, empty...); this expands them once into
// strings of 0/1. Every country has about the same number of land cells, whatever its real size.
E2.gridRows = c => c.grid._rows || (c.grid._rows = c.grid.runs.map(r => {
  let s = '', v = '0';
  for (const n of r) { s += v.repeat(n); v = v === '0' ? '1' : '0'; }
  return s;
}));

const isoCache = {};
E2.isoGrid = c => {
  if (isoCache[c.id]) return isoCache[c.id];
  const g = c.grid, src = E2.gridRows(c), CW = 45.25, CH = 22.63;   // one old cell as it appears on screen (2:1 squash)
  const W = g.w * CW, Hh = g.h * CH, N = Math.ceil(W / 64 + Hh / 32) + 2;
  const land = [];
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const sx = (x - y) * 32, sy = (x + y) * 16 + 16;        // centre of this isometric tile
    const X = (sx + W / 2) / CW, Y = (sy - (N * 16 - Hh / 2)) / CH;
    if (X < 0 || Y < 0 || X >= g.w || Y >= g.h || src[Math.floor(Y)][Math.floor(X)] !== '1') continue;
    land.push(x, y);
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const rows = Array.from({ length: h }, () => new Array(w).fill('0'));
  for (let i = 0; i < land.length; i += 2) rows[land[i + 1] - y0][land[i] - x0] = '1';
  // Where a position on the old (north-up) grid lands on the new one, as a tile index.
  const tileOf = (X, Y) => {
    const sx = X * CW - W / 2, sy = Y * CH + N * 16 - Hh / 2;
    return { x: Math.round(((sx / 32 + (sy - 16) / 16) / 2) - x0), y: Math.round((((sy - 16) / 16 - sx / 32) / 2) - y0) };
  };
  return (isoCache[c.id] = { w, h, rows: rows.map(r => r.join('')), land: land.length / 2, tileOf });
};

// The capital city's tile on the country's land grid (the HQ starts there), or null if the country has no capital on file.
E2.capitalSpot = c => {
  const g = c.grid, cap = c.capital, src = E2.gridRows(c);
  if (!cap) return null;
  let lon = cap.lon;
  if (lon < 0 && g.ox > 100) lon += 360;                    // countries that cross the date line were shifted east
  const X = Math.min(g.w - 1, Math.max(0, Math.floor((lon - g.ox) / g.csx)));
  const Y = Math.min(g.h - 1, Math.max(0, Math.floor((g.oy - cap.lat) / g.csy)));
  let best = null, bd = Infinity;                           // a coastal capital can fall just offshore: use the nearest land cell
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    if (src[y][x] !== '1') continue;
    const d = (x - X) ** 2 + (y - Y) ** 2;
    if (d < bd) { bd = d; best = { x, y }; }
  }
  return best ? E2.isoGrid(c).tileOf(best.x + 0.5, best.y + 0.5) : null;
};

E2.DEBUG = /[?&]debug=1/.test(location.search);       // debug tools only with ?debug=1 (the app serves from localhost, so no host check)

// Countries you can attack from the ones you own: neighbours by land or a short sea hop.
// A country with no playable neighbour (an island nation) can reach the four nearest instead.
E2.reachable = owned => {
  const have = new Set(owned), pool = new Set();
  for (const id of owned) {
    const c = E2.byId(id);
    for (const n of c.land.concat(c.sea)) { const t = E2.byId(n); if (t && t.playable && !have.has(n)) pool.add(n); }
  }
  if (pool.size < 1) {
    const home = E2.byId(owned[0]);
    E2.COUNTRIES.filter(c => c.playable && !have.has(c.id))
      .map(c => ({ id: c.id, d: Math.hypot(c.label[0] - home.label[0], c.label[1] - home.label[1]) }))
      .sort((a, b) => a.d - b.d).slice(0, 4).forEach(c => pool.add(c.id));
  }
  return [...pool];
};

E2.WIN_COUNT = 10;                            // conquests needed to be Emperor of Emperors
E2.rankOf = n => n >= E2.WIN_COUNT ? 'Emperor of Emperors' : n >= 6 ? 'Grand Emperor' : n >= 3 ? 'Emperor' : n >= 1 ? 'Warlord' : 'King';

E2.RES = {
  gold:  { name: 'Gold',  icon: '🪙' },
  oil:   { name: 'Oil',   icon: '🛢️' },
  steel: { name: 'Steel', icon: '⚙️' },
};
E2.RES_KEYS = Object.keys(E2.RES);
E2.START_RES = { gold: 1500, oil: 600, steel: 300 };
E2.BUILDERS = 2;

// Indexed by HQ level - 1.
E2.HQ = {
  baseCap: [2000, 5000, 12000],   // storage per resource before vaults
  levelCap: [3, 4, 5],            // highest level any other building may reach
};

// levels[i] = cost/time to reach level i+1 (seconds). rate = units per hour. storage = extra cap per resource.
E2.BUILDINGS = {
  hq: {
    name: 'Command HQ', icon: '🏰', color: '#8a6a2f', size: 3, noBuild: true,
    desc: 'Your seat of power. Upgrade it to unlock more buildings, bigger storage and higher building levels.',
    maxCount: [1, 1, 1],
    levels: [
      { cost: {}, time: 0 },
      { cost: { gold: 1500, steel: 300 }, time: 5 * M },
      { cost: { gold: 6000, oil: 1500, steel: 1500 }, time: 40 * M },
    ],
  },
  goldMine: {
    name: 'Gold Mine', icon: '⛏️', color: '#9a7b22', size: 2, produces: 'gold', holdHours: 2.5,
    desc: 'Digs gold from your land. Tap the bubble to collect before it fills up.',
    maxCount: [2, 3, 4],
    rate: [300, 480, 700, 1000, 1400],
    levels: [
      { cost: { gold: 100 }, time: 15 },
      { cost: { gold: 300 }, time: 90 },
      { cost: { gold: 900 }, time: 10 * M },
      { cost: { gold: 2500, steel: 150 }, time: 1 * H },
      { cost: { gold: 6000, steel: 500 }, time: 3 * H },
    ],
  },
  oilRefinery: {
    name: 'Oil Refinery', icon: '🛢️', color: '#3e4a57', size: 2, produces: 'oil', holdHours: 2.5,
    desc: 'Pumps and refines crude oil, the fuel for vehicles and aircraft.',
    maxCount: [2, 3, 4],
    rate: [200, 320, 480, 700, 1000],
    levels: [
      { cost: { gold: 150 }, time: 20 },
      { cost: { gold: 400 }, time: 2 * M },
      { cost: { gold: 1100 }, time: 12 * M },
      { cost: { gold: 3000, steel: 200 }, time: 90 * M },
      { cost: { gold: 7000, steel: 600 }, time: 4 * H },
    ],
  },
  steelMill: {
    name: 'Steel Mill', icon: '🏭', color: '#5a4a52', size: 2, produces: 'steel', holdHours: 2.5,
    desc: 'Smelts steel for towers, tanks and missiles.',
    maxCount: [1, 2, 3],
    rate: [120, 200, 300, 450, 650],
    levels: [
      { cost: { gold: 250, oil: 100 }, time: 30 },
      { cost: { gold: 600, oil: 200 }, time: 3 * M },
      { cost: { gold: 1500, oil: 500 }, time: 15 * M },
      { cost: { gold: 3500, oil: 900 }, time: 2 * H },
      { cost: { gold: 8000, oil: 1800 }, time: 5 * H },
    ],
  },
  vault: {
    name: 'Vault', icon: '🏦', color: '#2f5b7a', size: 2,
    desc: 'Raises how much gold, oil and steel your country can store.',
    maxCount: [1, 2, 3],
    storage: [1500, 3000, 5000, 8000, 12000],
    levels: [
      { cost: { gold: 300, steel: 60 }, time: 45 },
      { cost: { gold: 800, steel: 150 }, time: 4 * M },
      { cost: { gold: 2000, steel: 400 }, time: 20 * M },
      { cost: { gold: 4500, steel: 900 }, time: 2 * H },
      { cost: { gold: 9000, steel: 1800 }, time: 6 * H },
    ],
  },

  // ----- Defence towers. hp/dmg per level; range in cells; rate = seconds between shots. -----
  gunTurret: {
    name: 'Gun Turret', icon: '🔫', color: '#6b4a3a', size: 1,
    desc: 'Cheap and quick. Shoots ground units at short range.',
    maxCount: [3, 5, 7],
    tower: { hp: [250, 400, 600], dmg: [12, 20, 30], range: 5, rate: 0.6, targets: 'ground', splash: 0 },
    levels: [
      { cost: { gold: 150 }, time: 30 },
      { cost: { gold: 400, steel: 80 }, time: 3 * M },
      { cost: { gold: 1000, steel: 250 }, time: 20 * M },
    ],
  },
  missileBattery: {
    name: 'Missile Battery', icon: '🚀', color: '#4a5a3a', size: 2,
    desc: 'Long range and slow, but its blast hits groups of ground units.',
    maxCount: [1, 2, 3],
    tower: { hp: [300, 500, 800], dmg: [60, 100, 150], range: 8, rate: 2.5, targets: 'ground', splash: 1.5 },
    levels: [
      { cost: { gold: 350, steel: 100, oil: 50 }, time: 60 },
      { cost: { gold: 900, steel: 250, oil: 150 }, time: 6 * M },
      { cost: { gold: 2200, steel: 600, oil: 400 }, time: 30 * M },
    ],
  },
  antiAir: {
    name: 'Anti-Air', icon: '📡', color: '#3a4f6a', size: 2,
    desc: 'The only defence that can hit jets and incoming missiles.',
    maxCount: [1, 2, 3],
    tower: { hp: [200, 350, 550], dmg: [22, 36, 55], range: 7, rate: 0.5, targets: 'air', splash: 0 },
    levels: [
      { cost: { gold: 300, steel: 80 }, time: 45 },
      { cost: { gold: 800, steel: 200 }, time: 5 * M },
      { cost: { gold: 2000, steel: 500 }, time: 25 * M },
    ],
  },
};
// ----- Military buildings -----
E2.BUILDINGS.barracks = {
  name: 'Barracks', icon: '⛺', color: '#5a6b3f', size: 2,
  desc: 'Houses your army. More barracks and higher levels mean a bigger army you can send to attack.',
  maxCount: [2, 3, 4],
  capacity: [30, 55, 90, 135, 190],
  levels: [
    { cost: { gold: 300, steel: 50 }, time: 60 },
    { cost: { gold: 800, steel: 150 }, time: 4 * M },
    { cost: { gold: 2000, steel: 400 }, time: 20 * M },
    { cost: { gold: 4500, steel: 900 }, time: 2 * H },
    { cost: { gold: 9000, steel: 1800 }, time: 6 * H },
  ],
};
E2.BUILDINGS.researchLab = {
  name: 'Research Lab', icon: '🔬', color: '#3f5a6b', size: 2,
  desc: 'Unlocks stronger weapons: tanks at level 1, jets at level 2 and missiles at level 3.',
  maxCount: [1, 1, 1],
  levels: [
    { cost: { gold: 500, oil: 100, steel: 100 }, time: 90 },
    { cost: { gold: 2000, oil: 500, steel: 400 }, time: 25 * M },
    { cost: { gold: 6000, oil: 1500, steel: 1200 }, time: 3 * H },
  ],
};
// ----- Harbor: ships your goods to another country and sells them for gold -----
E2.BUILDINGS.harbor = {
  name: 'Harbor', icon: '⚓', color: '#2f6a7a', size: 2, coast: true,
  desc: 'Load oil or steel onto a trade ship and sail it to another country to sell it for gold. It has to touch the sea.',
  maxCount: [1, 1, 2],
  capacity: [150, 400, 900],                                   // cargo per trip
  levels: [
    { cost: { gold: 400, steel: 80 }, time: 60 },
    { cost: { gold: 1200, steel: 250 }, time: 6 * M },
    { cost: { gold: 3000, steel: 700 }, time: 30 * M },
  ],
};
E2.BUILD_ORDER = ['goldMine', 'oilRefinery', 'steelMill', 'vault', 'harbor', 'gunTurret', 'missileBattery', 'antiAir', 'barracks', 'researchLab'];

// ----- Pacing: there is no server, so nobody should have to wait long -----
// Every build, upgrade and research timer is squeezed so the longest is MAX_WAIT (15 minutes).
// Timers up to 2 minutes stay as written; longer ones are spread on a log scale up to the cap.
E2.MAX_WAIT = 15 * M;
const SHORT = 2 * M, LONGEST = 6 * H;                       // the longest timer in the tables above is 6 hours
const squeeze = t => t <= SHORT ? t
  : Math.round((SHORT + (E2.MAX_WAIT - SHORT) * Math.log(t / SHORT) / Math.log(LONGEST / SHORT)) / 5) * 5;
// Income is raised to match, so a step costs about the same number of minutes of play as it takes to build.
const INCOME_BOOST = 4, HOLD_HOURS = 0.75;
for (const def of Object.values(E2.BUILDINGS)) {
  for (const lv of def.levels) lv.time = Math.min(E2.MAX_WAIT, squeeze(lv.time));
  if (def.produces) { def.rate = def.rate.map(r => r * INCOME_BOOST); def.holdHours = HOLD_HOURS; }
}

// Army units you train and send out. space = barracks room, lab = Research Lab level needed.
E2.ARMY = {
  infantry: { name: 'Infantry', icon: '🪖', space: 1, lab: 0, cost: { gold: 30 } },
  tank:     { name: 'Tank',     icon: '🛡️', space: 4, lab: 1, cost: { gold: 150, oil: 20, steel: 30 } },
  jet:      { name: 'Jet',      icon: '✈️', space: 6, lab: 2, cost: { gold: 300, oil: 60, steel: 80 } },
  missile:  { name: 'Missile',  icon: '🚀', space: 3, lab: 3, cost: { gold: 200, oil: 100, steel: 100 } },
  drone:    { name: 'Drone',    icon: '🛸', space: 2, lab: 2, cost: { gold: 120, oil: 30, steel: 30 } },
  satellite: { name: 'Satellite', icon: '🛰️', space: 8, lab: 3, cost: { gold: 500, oil: 150, steel: 250 } },
};
E2.ARMY_KEYS = Object.keys(E2.ARMY);

// Pictures of the flying units (Kenney "Space Shooter Extension", CC0). Yours are blue, the enemy's are red and yellow.
E2.UNIT_IMG = { jet: 'art/space/jet.png', drone: 'art/space/drone.png', missile: 'art/space/missile-blue.png', satellite: 'art/space/satellite-blue.png' };
E2.UNIT_IMG_ENEMY = { jet: 'art/space/jet.png', drone: 'art/space/drone.png', missile: 'art/space/missile-red.png', satellite: 'art/space/satellite-yellow.png' };
// Small picture (or the emoji for ground units) for lists and buttons.
E2.armyIcon = k => E2.UNIT_IMG[k] ? `<img class="uimg" alt="" draggable="false" src="${E2.UNIT_IMG[k]}">` : E2.ARMY[k].icon;

// Hit points of a building at a level (towers carry their own table).
const BASE_HP = { goldMine: 220, oilRefinery: 220, steelMill: 260, vault: 300, barracks: 260, researchLab: 240, harbor: 240 };
E2.hpOf = (type, level) => {
  const def = E2.BUILDINGS[type];
  if (def.tower) return def.tower.hp[level - 1];
  if (type === 'hq') return [800, 1400, 2200][level - 1];
  return Math.round(BASE_HP[type] * (1 + 0.25 * (level - 1)));
};

// Raiding units. air units can only be hit by Anti-Air (and the airstrike).
E2.UNITS = {
  infantry: { name: 'Infantry', hp: 60,  dmg: 6,   rate: 1.0, range: 0.9, speed: 1.6, air: false, cost: 10, minPower: 1, weight: 50 },
  tank:     { name: 'Tank',     hp: 240, dmg: 28,  rate: 1.6, range: 1.8, speed: 1.0, air: false, cost: 40, minPower: 3, weight: 25 },
  jet:      { name: 'Jet',      hp: 110, dmg: 16,  rate: 1.0, range: 1.4, speed: 3.2, air: true,  cost: 45, minPower: 5, weight: 15 },
  missile:  { name: 'Missile',  hp: 25,  dmg: 120, rate: 0,   range: 0.6, speed: 4.5, air: true,  cost: 25, minPower: 7, weight: 10, splash: 1.6 },
  // Small fast swarm flyer: weak, but only Anti-Air can shoot it.
  drone:    { name: 'Drone',    hp: 45,  dmg: 5,   rate: 0.5, range: 1.0, speed: 3.6, air: true,  cost: 12, minPower: 4, weight: 18 },
  // Orbits high above the battlefield: it stays where it is dropped, beams the nearest building from far away
  // (out of the towers' reach if you drop it far enough) and burns up after `ttl` seconds. Only you can send one.
  satellite: { name: 'Satellite', hp: 160, dmg: 22, rate: 1.6, range: 12, speed: 0, air: true, cost: 60, minPower: 99, weight: 0, ttl: 50 },
};

E2.RAID = {
  firstDelay: 30 * 60 * 1000,                 // first raid after 30 minutes
  gap: [3 * 3600 * 1000, 6 * 3600 * 1000],    // time between raids
  lossShield: 4 * 3600 * 1000,                // no raids after a loss
  awayGrace: 90 * 1000,                       // raid landed this long ago = player was away (auto-resolved)
  maxTime: 180,                               // battle length in seconds
  strike: { charges: 2, cooldown: 20, delay: 1.0, radius: 3, dmg: 150 },
  warTime: 300, waveFirst: 45, waveGap: 35, waveBudget: 8,    // a war lasts 5 minutes; the enemy sends a wave every 35 s
  bomb: { radius: 2.5, dmg: 220 },            // your airstrike when you attack: hits buildings
};

// ----- Trade by sea (Kenney "Watercraft Kit" ships, CC0). Cargo is sold for gold; richer countries pay more. -----
E2.TRADE = {
  price: { oil: 1.6, steel: 2.4 },                             // gold per unit before the destination's bonus
  ship: ['ship-small', 'ship-cargo', 'ship-liner'],            // by harbor level
  minSecs: 120, maxSecs: 600,                                  // a trip is never longer than 10 minutes
};
E2.TRADE_KEYS = Object.keys(E2.TRADE.price);
E2.tradeQuote = (res, amount, fromId, toId) => {
  const a = E2.byId(fromId), b = E2.byId(toId);
  const bonus = 1 + (b.power - 1) * 0.06;
  const deg = Math.hypot(a.label[0] - b.label[0], a.label[1] - b.label[1]);
  return {
    reward: Math.round(amount * E2.TRADE.price[res] * bonus),
    secs: Math.round(Math.min(E2.TRADE.maxSecs, Math.max(E2.TRADE.minSecs, 90 + deg * 9)) / 5) * 5,
  };
};

E2.rateOf = (type, level) => (E2.BUILDINGS[type].rate || [])[level - 1] || 0;
E2.holdCap = (type, level) => E2.rateOf(type, level) * (E2.BUILDINGS[type].holdHours || 0);

// ---------- Vector icons (SVG, used in the HUD and on the map) ----------
const svg = body => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">${body}</svg>`;
const grad = (id, a, b, c) => `<defs><radialGradient id="${id}" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="${a}"/><stop offset=".55" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></radialGradient></defs>`;
E2.ICON_SVG = {
  gold: svg(grad('g', '#fff3a0', '#f5c428', '#b9780f') + '<circle cx="24" cy="24" r="20" fill="url(#g)" stroke="#6e4106" stroke-width="3"/><circle cx="24" cy="24" r="13" fill="none" stroke="#d99a16" stroke-width="3"/><path d="M24 14v20M19 19h8a3 3 0 0 1 0 6h-6a3 3 0 0 0 0 6h8" stroke="#a8680c" stroke-width="3" fill="none" stroke-linecap="round"/>'),
  oil: svg(grad('o', '#7d83a8', '#2d3148', '#0d0e17') + '<path d="M24 4C24 4 9 20 9 30a15 15 0 0 0 30 0C39 20 24 4 24 4z" fill="url(#o)" stroke="#05060b" stroke-width="3" stroke-linejoin="round"/><path d="M17 31a7 7 0 0 0 5 7" stroke="#9aa0c8" stroke-width="3" fill="none" stroke-linecap="round"/>'),
  steel: svg(grad('s', '#f2f5f9', '#aab4c2', '#59616e') + '<path d="M24 4l16 9v22L24 44 8 35V13z" fill="url(#s)" stroke="#2b3038" stroke-width="3" stroke-linejoin="round"/><circle cx="24" cy="24" r="8" fill="#3c424d" stroke="#1d2026" stroke-width="2.5"/><circle cx="24" cy="24" r="3" fill="#aab4c2"/>'),
  hammer: svg('<rect x="21" y="17" width="7" height="27" rx="2" transform="rotate(35 24 30)" fill="#a8672c" stroke="#4a2a0c" stroke-width="2.5"/><rect x="6" y="8" width="26" height="12" rx="3" transform="rotate(35 19 14)" fill="#c9d1db" stroke="#2f3640" stroke-width="2.5"/>'),
  shield: svg(grad('h', '#ffffff', '#c3d0e0', '#7c8da3') + '<path d="M24 4l16 6v12c0 11-7 18-16 22C15 40 8 33 8 22V10z" fill="url(#h)" stroke="#2f3b4d" stroke-width="3" stroke-linejoin="round"/>'),
  gear: svg(grad('r', '#f4f6f8', '#b7c0cb', '#656e7a') + '<path d="M24 4l4 5 6-2 2 6 6 2-2 6 5 4-5 4 2 6-6 2-2 6-6-2-4 5-4-5-6 2-2-6-6-2 2-6-5-4 5-4-2-6 6-2 2-6 6 2z" fill="url(#r)" stroke="#2b3038" stroke-width="2.5" stroke-linejoin="round"/><circle cx="24" cy="24" r="7" fill="#3c424d" stroke="#1d2026" stroke-width="2.5"/>'),
  map: svg('<path d="M5 12l12-4 14 4 12-4v28l-12 4-14-4-12 4z" fill="#f2e3b8" stroke="#6a5326" stroke-width="3" stroke-linejoin="round"/><path d="M17 8v28M31 12v28" stroke="#c9b27a" stroke-width="2"/><path d="M33 8a6 6 0 0 1 6 6c0 5-6 11-6 11s-6-6-6-11a6 6 0 0 1 6-6z" fill="#e5382d" stroke="#6b130d" stroke-width="2.5"/><circle cx="33" cy="14" r="2.2" fill="#fff"/>'),
  coins: svg(grad('c', '#fff3a0', '#f5c428', '#b9780f') + '<ellipse cx="18" cy="35" rx="13" ry="6" fill="url(#c)" stroke="#6e4106" stroke-width="2.5"/><path d="M5 35v-6a13 6 0 0 0 26 0v6" fill="#e0a21a" stroke="#6e4106" stroke-width="2.5"/><ellipse cx="18" cy="27" rx="13" ry="6" fill="url(#c)" stroke="#6e4106" stroke-width="2.5"/><ellipse cx="32" cy="17" rx="11" ry="5" fill="url(#c)" stroke="#6e4106" stroke-width="2.5"/><path d="M21 17v6a11 5 0 0 0 22 0v-6" fill="#e0a21a" stroke="#6e4106" stroke-width="2.5"/><ellipse cx="32" cy="14" rx="11" ry="5" fill="url(#c)" stroke="#6e4106" stroke-width="2.5"/>'),
  star: svg(grad('x', '#fff3a0', '#f5c428', '#b9780f') + '<path d="M24 4l6 13 14 2-10 10 3 14-13-7-13 7 3-14L4 19l14-2z" fill="url(#x)" stroke="#6e4106" stroke-width="3" stroke-linejoin="round"/>'),
};
E2.iconUrl = key => 'data:image/svg+xml;utf8,' + encodeURIComponent(E2.ICON_SVG[key]);
E2.icon = (key, cls = 'ic') => `<img class="${cls}" alt="" draggable="false" src="${E2.iconUrl(key)}">`;

// Player level from XP: each level needs 35% more than the last.
E2.levelInfo = xp => {
  let level = 1, need = 100;
  while (xp >= need) { xp -= need; level++; need = Math.round(need * 1.35); }
  return { level, into: xp, need };
};

// ---------- Formatters ----------
E2.fmtNum = n => {
  n = Math.floor(n);
  if (n < 10000) return n.toLocaleString('en-US');
  if (n < 1e6) return (n / 1000).toFixed(n < 100000 ? 1 : 0) + 'K';
  return (n / 1e6).toFixed(2) + 'M';
};
E2.fmtTime = s => {
  s = Math.max(0, Math.ceil(s));
  if (s < 60) return s + 's';
  if (s < 600) return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h + 'h' + (m ? ' ' + m + 'm' : '');
};
E2.powerLabel = p => p >= 9 ? 'Superpower' : p >= 7 ? 'Great power' : p >= 5 ? 'Regional power' : p >= 3 ? 'Small nation' : 'Micro state';
})();
