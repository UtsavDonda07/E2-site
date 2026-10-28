// Battle flow: raid warnings, defending, attacking other countries, away resolution and reports.
(function () {
'use strict';
const E2 = window.E2;
const $ = id => document.getElementById(id);
const DT = E2.raid.DT;

let live = null;                // { kind:'defend'|'attack', sim, raid|enemy, speed, acc, last, armed, sel, endAt }
let prompting = false;          // an "incoming raid" or report modal is up

const active = () => !!live;
const rv = () => E2.state.raidView();

function ensurePlanned() {
  const S = E2.state.get();
  if (!S.raid.pending) { S.raid.pending = E2.raid.plan(rv(), E2.state.hqLevel()); E2.state.save(); }
  return S.raid.pending;
}

const countryName = id => E2.byId(id).name;
const sideName = s => ({ N: 'northern', S: 'southern', E: 'eastern', W: 'western' })[s];

// ---------- Banner (called every clock tick from ui.updateHud) ----------
function bannerText(now) {
  const S = E2.state.get();
  if (!S || live) return null;
  const ss = strikeState(now);
  if (ss) return { strike: true, cls: '', text: ss.ready ? `🚀 Troops reached ${countryName(ss.st.target)}: open the World map` : `🚀 Troops reach ${countryName(ss.st.target)} in ${E2.fmtTime(ss.nextLeft)}` };
  const R = S.raid;
  if (R.pending && now < R.nextAt && R.nextAt - now <= 15 * 60 * 1000) {
    const s = Math.ceil((R.nextAt - now) / 1000);
    return { text: `⚠ Raid from ${countryName(R.pending.attackerId)} in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, cls: '' };
  }
  return null;
}

// ---------- Scheduler (called every clock tick) ----------
function check(now) {
  const S = E2.state.get();
  if (!S || live || prompting || E2.state.inEnemyView()) return;
  if ($('screenBase').classList.contains('hidden')) return;
  ensurePlanned();
  const R = S.raid;
  if (now < R.nextAt) return;
  if (now - R.nextAt > E2.RAID.awayGrace) resolveAway(now);
  else incoming();
}

function resolveAway(now) {
  const raid = ensurePlanned();
  const sim = E2.raid.makeSim(rv(), raid);
  const out = E2.raid.runHeadless(sim, true);
  const report = E2.state.applyRaid(raid, out, now);
  showDefenceReport(report, raid, true);
}

function incoming() {
  const raid = ensurePlanned();
  prompting = true;
  E2.ui.closeSheet();
  if (E2.base.isPlacing()) E2.base.cancelPlacing();
  E2.ui.modal({
    title: '⚠ Raid incoming!',
    body: `<b>${countryName(raid.attackerId)}</b> is attacking your homeland from the ${sideName(raid.side)} coast with <b>${raid.units.length}</b> units.<br><br>Your towers fire on their own. Tap <b>Airstrike</b> then the map to blast the enemy.`,
    buttons: [
      { label: 'Auto-resolve', onClick: () => { prompting = false; resolveAway(Date.now()); } },
      { label: 'Defend!', cls: 'primary', onClick: () => { prompting = false; startLive(raid); } },
    ],
  });
}

// ---------- Shared battle plumbing ----------
function begin(kind, sim, extra, title) {
  live = Object.assign({ kind, sim, speed: 1, acc: 0, last: performance.now(), armed: false, endAt: 0, sel: null }, extra);
  $('bottomBar').classList.add('hidden');
  $('raidBar').classList.remove('hidden');
  $('banner').classList.add('hidden');
  $('raidTitle').textContent = title;
  $('tray').classList.toggle('hidden', kind !== 'attack');
  $('btnSkip').textContent = kind === 'attack' ? 'End' : 'Skip';
  if (kind === 'attack') { live.sel = E2.ARMY_KEYS.find(k => sim.reserve[k] > 0); sim.expecting = (live.arrivals || []).length; buildTray(); }
  E2.base.setRaid(sim);
  syncBar();
  requestAnimationFrame(loop);
}

function loop(ts) {
  if (!live) return;
  const { sim } = live;
  const dt = Math.min(0.1, (ts - live.last) / 1000);
  live.last = ts;
  if (live.arrivals && live.arrivals.length) landArrivals();
  if (!sim.done) {
    const t0 = sim.t;
    live.acc += dt * live.speed;
    while (live.acc >= DT && !sim.done) { E2.raid.step(sim); live.acc -= DT; }
    if (sim.effects.some(e => e.kind === 'boom' && e.t0 > t0)) E2.sfx.play('boom');
  } else if (!live.endAt) live.endAt = ts + 1300;           // let the last explosions play
  else if (ts >= live.endAt) return live.kind === 'attack' ? finishAttack() : finishDefence();
  syncBar();
  requestAnimationFrame(loop);
}

function buildTray() {
  const { sim } = live, t = $('tray');
  t.innerHTML = '';
  for (const k of E2.ARMY_KEYS) {
    if (!(sim.deployed[k] || 0) && !(sim.reserve[k] > 0) && !(live.arrivals || []).some(a => a.k === k)) continue;
    const b = document.createElement('button');
    b.className = 'tray-btn'; b.dataset.k = k;
    b.innerHTML = `<span>${E2.armyIcon(k)}</span><span class="n"></span>`;
    b.onclick = () => { live.sel = k; live.armed = false; syncBar(); };
    t.appendChild(b);
  }
}

function syncBar() {
  if (!live) return;
  const { sim } = live, a = sim.ability, atk = live.kind === 'attack';
  const alive = sim.units.filter(u => u.alive).length;
  if (atk) {
    const reserve = Object.values(sim.reserve).reduce((x, y) => x + y, 0);
    const inbound = (live.arrivals || []).length, now = Date.now();
    $('raidStatus').textContent = `${reserve} in reserve · ${alive} fighting · ${inbound ? `${inbound} inbound · ` : ''}${E2.fmtTime(Math.max(0, sim.limit - sim.t))}`;
    $('tray').querySelectorAll('.tray-btn').forEach(b => {
      const k = b.dataset.k, coming = (live.arrivals || []).find(a => a.k === k);
      b.querySelector('.n').textContent = !(sim.reserve[k] > 0) && coming ? `⏱${E2.fmtTime(Math.max(0, (coming.at - now) / 1000))}` : (sim.reserve[k] || 0);
      b.disabled = !(sim.reserve[k] > 0);
      b.classList.toggle('on', live.sel === k && !live.armed && sim.reserve[k] > 0);
    });
    if (live.sel && !(sim.reserve[live.sel] > 0)) live.sel = E2.ARMY_KEYS.find(k => sim.reserve[k] > 0) || null;
  } else {
    $('raidStatus').textContent = `${sim.pending.length + alive} raiders · ${E2.fmtTime(E2.RAID.maxTime - sim.t)}`;
  }
  $('raidProg').style.width = Math.min(100, sim.t / (sim.limit || E2.RAID.maxTime) * 100) + '%';
  const b = $('btnStrike'), noun = atk ? '💣 Bomb' : '✈ Airstrike';
  b.disabled = sim.done || a.charges <= 0 || a.cd > 0;
  b.classList.toggle('armed', live.armed && !b.disabled);
  b.textContent = a.charges <= 0 ? `${noun}: none left` : a.cd > 0 ? `${noun} in ${Math.ceil(a.cd)}s (×${a.charges})` : live.armed ? '🎯 Tap the map' : `${noun} ×${a.charges}`;
  $('btnSpeed').textContent = live.speed + 'x';
}

// A tap on the battlefield: aim a strike or, when attacking, land troops.
function mapTap(cx, cy) {
  if (!live || live.sim.done) return;
  const { sim } = live;
  if (live.armed) { if (E2.raid.fireStrike(sim, cx, cy)) live.armed = false; syncBar(); return; }
  if (live.kind !== 'attack') return;
  if (!live.sel) return E2.ui.toast('No troops left to send.');
  if (!E2.raid.canDeploy(sim, cx, cy)) return E2.ui.toast('Land your troops outside the enemy base.');
  for (let i = 0; i < 3; i++) E2.raid.deploy(sim, live.sel, cx + (i - 1) * 0.5, cy + (i % 2) * 0.4);
  syncBar();
}

function skip() {
  if (!live) return;
  const { sim } = live;
  if (live.kind === 'attack') { for (const k of Object.keys(sim.reserve)) sim.reserve[k] = 0; live.arrivals = []; sim.expecting = 0; }   // keep the rest at home
  let n = 0;
  while (!sim.done && n++ < 5000) E2.raid.step(sim);
  live.endAt = performance.now();
}

// ---------- Defending ----------
function startLive(raid) {
  const S = E2.state.get();
  if (S.view !== S.homeland) E2.app.goView(S.homeland);
  const sim = E2.raid.makeSim(rv(), raid);
  begin('defend', sim, { raid }, `⚔ Defend vs ${countryName(raid.attackerId)}`);
}

function finishDefence() {
  const { raid, sim } = live;
  const out = E2.raid.outcome(sim);
  endBattle();
  const report = E2.state.applyRaid(raid, out, Date.now());
  showDefenceReport(report, raid, false);
}

function endBattle() {
  live = null;
  $('raidBar').classList.add('hidden');
  $('bottomBar').classList.remove('hidden');
  E2.base.clearRaid();
}

function showDefenceReport(report, raid, away) {
  prompting = true;
  ensurePlanned();
  const att = countryName(raid.attackerId);
  const lost = report.destroyed.length;
  const stars = report.win ? '★'.repeat(report.rating) + '☆'.repeat(3 - report.rating) : '☆☆☆';
  let body = `<div class="stars">${stars}</div>`;
  body += away ? `While you were away, <b>${att}</b> raided you.<br>` : `Attacker: <b>${att}</b><br>`;
  body += report.win ? 'Your defences held the line.<br>' : 'Your base was overrun.<br>';
  body += `Buildings ruined: <b>${lost}</b>${lost ? ' (repair them from the building menu)' : ''}<br>`;
  if (report.win) body += `Bounty: <b>+${E2.fmtNum(report.bounty)} ${E2.icon('gold')}</b>`;
  else {
    const parts = Object.entries(report.loot).map(([k, v]) => `-${E2.fmtNum(v)} ${E2.icon(k)}`);
    body += `Stolen: <b>${parts.join('  ') || 'nothing'}</b><br>🛡 Shield: ${E2.fmtTime(E2.RAID.lossShield / 1000)}`;
  }
  E2.ui.modal({
    title: report.win ? '🛡 Raid repelled!' : '💥 Base raided!',
    body,
    buttons: [{ label: 'OK', cls: 'primary', onClick: () => { prompting = false; E2.ui.afterChange(); } }],
  });
  E2.ui.afterChange();
  E2.sfx && E2.sfx.play(report.win ? 'win' : 'lose');
}

// ---------- Attacking ----------
// 1. launch(): the force leaves your nearest territory and travels (see the World map). 2. arrival: the first units to land open the
// live battle. 3. startAttack(): the rest of the force joins the battle as it arrives.
let notifiedFor = 0;            // startAt of the strike whose arrival prompt was already shown

function strikeState(now) {
  const st = E2.state.strike();
  if (!st) return null;
  const groups = Object.entries(st.groups).map(([k, g]) => ({ k, n: g.n, at: g.arriveAt, left: Math.max(0, (g.arriveAt - now) / 1000) }));
  const arrived = groups.filter(g => g.left <= 0), next = Math.min(...groups.map(g => g.at));
  return { st, groups, arrived, ready: arrived.length > 0, allIn: arrived.length === groups.length, nextLeft: Math.max(0, (next - now) / 1000) };
}

function launch(targetId) {
  if (E2.state.strike()) { E2.ui.toast('A force is already on its way.'); return false; }
  if (!E2.state.startStrike(targetId)) { E2.ui.toast('Train some troops first.'); return false; }
  E2.sfx && E2.sfx.play('boom');
  E2.worldmap.refresh();
  E2.ui.updateHud();
  return true;
}

function recall() {
  E2.state.endStrike();
  notifiedFor = 0;
  E2.ui.toast('Force recalled');
  E2.worldmap.refresh();
  E2.ui.updateHud();
}

// Called every clock tick, also while the World map is open: tell the player when the first units land.
function checkStrike(now) {
  const S = E2.state.get();
  if (!S || live || prompting || E2.state.inEnemyView()) return;
  const ss = strikeState(now);
  if (!ss || !ss.ready || notifiedFor === ss.st.startAt) return;
  notifiedFor = ss.st.startAt;
  prompting = true;
  const names = ss.arrived.map(g => `${g.n}× ${E2.armyIcon(g.k)}`).join(' ');
  const more = ss.allIn ? '' : '<br>The rest of your force is still on its way and will join the battle as it lands.';
  E2.ui.closeSheet();
  E2.ui.modal({
    title: '🚀 Your force has arrived!',
    body: `${names} reached <b>${countryName(ss.st.target)}</b>.${more}`,
    buttons: [
      { label: 'Later', onClick: () => { prompting = false; } },
      { label: 'Fight!', cls: 'primary', onClick: () => { prompting = false; engage(); } },
    ],
  });
}

// Open the battle for the current strike (only once some units have arrived).
function engage() {
  const ss = strikeState(Date.now());
  if (!ss || !ss.ready) return E2.ui.toast('Your troops have not arrived yet.');
  startAttack(ss.st.target);
}

function landArrivals() {
  const { sim } = live, now = Date.now(), landed = [];
  live.arrivals = live.arrivals.filter(a => {
    if (now < a.at) return true;
    sim.reserve[a.k] = (sim.reserve[a.k] || 0) + a.n;
    landed.push(a);
    return false;
  });
  if (!landed.length) return;
  sim.expecting = live.arrivals.length;
  sim.limit = Math.max(sim.limit, sim.t + 90);                // every arrival gives the battle more time
  if (!live.sel || !(sim.reserve[live.sel] > 0)) live.sel = landed[0].k;
  E2.ui.toast(`${landed.map(a => E2.ARMY[a.k].name).join(', ')} arrived!`);
  E2.sfx && E2.sfx.play('boom');
  buildTray();
}

function startAttack(targetId) {
  const S = E2.state.get(), now = Date.now(), st = S.strike && S.strike.target === targetId ? S.strike : null;
  const enemy = E2.enemy.generate(targetId, S.colonies.length);
  const army = {}, arrivals = [];
  if (st) {
    for (const [k, g] of Object.entries(st.groups)) {
      const n = Math.min(g.n, S.army[k] || 0);
      if (!n) continue;
      if (g.arriveAt <= now) army[k] = n; else arrivals.push({ k, n, at: g.arriveAt });
    }
  } else Object.assign(army, S.army);                          // no strike (debug use): everything is already there
  if (!Object.values(army).some(n => n > 0)) { E2.ui.toast('Train some troops first.'); return E2.app.showWorld(); }
  E2.ui.closeSheet();
  E2.state.enterEnemy(enemy);
  E2.app.showBase();
  const sim = E2.raid.makeAttackSim(enemy, army);
  begin('attack', sim, { enemy, arrivals }, `⚔ Attack ${countryName(targetId)}`);
  E2.ui.toast('Pick a unit, then tap the map outside the base to land troops.');
}

function finishAttack() {
  const { enemy, sim } = live;
  const out = E2.raid.attackOutcome(sim);
  endBattle();
  E2.state.endStrike();
  E2.state.exitEnemy();
  const report = E2.state.applyAttack(enemy, out, Date.now());
  E2.app.goView(E2.state.get().view);
  showAttackReport(report);
}

function showAttackReport(report) {
  prompting = true;
  const S = E2.state.get(), c = E2.byId(report.targetId);
  const stars = '★'.repeat(report.stars) + '☆'.repeat(3 - report.stars);
  let body = `<div class="stars">${stars}</div>Target: <b>${c.name}</b> · destroyed ${Math.round(report.pct * 100)}%<br>`;
  const loot = Object.entries(report.loot).map(([k, v]) => `+${E2.fmtNum(v)} ${E2.icon(k)}`).join('  ');
  body += report.win ? `Loot: <b>${loot || 'none (your storage is full)'}</b><br>` : 'Your attack failed. Train a bigger army and try again.<br>';
  const lost = Object.entries(report.lost).map(([k, v]) => `${v}× ${E2.armyIcon(k)}`).join(' ');
  body += `Troops lost: ${lost || 'none'}<br>`;
  if (report.captured) body += `<br>🏴 <b>${c.name} is yours!</b> It is now a territory you can build on. Rank: <b>${report.ranked}</b>.`;
  else if (report.win) body += '<br>Destroy the enemy HQ to conquer the country.';
  E2.ui.modal({
    title: report.captured ? '🏴 Country conquered!' : report.win ? '⚔ Victory!' : '💥 Attack failed',
    body,
    buttons: [{ label: 'OK', cls: 'primary', onClick: () => { prompting = false; E2.ui.afterChange(); checkVictory(); } }],
  });
  E2.sfx && E2.sfx.play(report.win ? 'win' : 'lose');
  E2.ui.afterChange();
}

function checkVictory() {
  const S = E2.state.get();
  if (S.won || S.colonies.length < E2.WIN_COUNT) return;
  S.won = true; E2.state.save();
  prompting = true;
  E2.ui.modal({
    title: '👑 EMPEROR OF EMPERORS',
    body: `You have conquered ${S.colonies.length} countries. Every rival bows before you.<br><br>You may keep playing: there is still the rest of the world.`,
    buttons: [{ label: 'Continue', cls: 'primary', onClick: () => { prompting = false; } }],
  });
}

// ---------- Dev helper ----------
function debugTrigger() {
  const S = E2.state.get();
  ensurePlanned();
  S.raid.nextAt = Date.now();
  E2.state.save();
  check(Date.now());
}

function init() {
  $('btnStrike').onclick = () => { if (live) { live.armed = !live.armed; syncBar(); } };
  $('btnSpeed').onclick = () => { if (live) { live.speed = live.speed === 1 ? 2 : 1; syncBar(); } };
  $('btnSkip').onclick = skip;
}

E2.raidview = { init, check, active, bannerText, mapTap, debugTrigger, ensurePlanned, startAttack, launch, recall, engage, checkStrike, strikeState, sim: () => live && live.sim };
})();
