// Battle flow: raid warnings, defending, attacking other countries, away resolution and reports.
(function () {
'use strict';
const E2 = window.E2;
const $ = id => document.getElementById(id);
const DT = E2.raid.DT;

let live = null;                // { kind:'defend'|'war', sim, raid|enemy+from, speed, acc, last, armed, sel, endAt }
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
  $('tray').classList.toggle('hidden', kind !== 'war');
  $('btnSkip').textContent = kind === 'war' ? 'End' : 'Skip';
  if (kind === 'war') { live.sel = E2.ARMY_KEYS.find(k => sim.reserve[k] > 0); buildTray(); }
  E2.base.setRaid(sim);
  syncBar();
  requestAnimationFrame(loop);
}

function loop(ts) {
  if (!live) return;
  const { sim } = live;
  const dt = Math.min(0.1, (ts - live.last) / 1000);
  live.last = ts;
  if (!sim.done) {
    const t0 = sim.t;
    live.acc += dt * live.speed;
    while (live.acc >= DT && !sim.done) { E2.raid.step(sim); live.acc -= DT; }
    if (sim.effects.some(e => e.kind === 'boom' && e.t0 > t0)) E2.sfx.play('boom');
  } else if (!live.endAt) live.endAt = ts + 1300;           // let the last explosions play
  else if (ts >= live.endAt) return live.kind === 'war' ? finishWar() : finishDefence();
  syncBar();
  requestAnimationFrame(loop);
}

function buildTray() {
  const { sim } = live, t = $('tray');
  t.innerHTML = '';
  for (const k of E2.ARMY_KEYS) {
    if (!(sim.deployed[k] || 0) && !(sim.reserve[k] > 0)) continue;
    const b = document.createElement('button');
    b.className = 'tray-btn'; b.dataset.k = k;
    b.innerHTML = `<span>${E2.armyIcon(k)}</span><span class="n"></span>`;
    b.onclick = () => { live.sel = k; live.armed = false; syncBar(); };
    t.appendChild(b);
  }
}

function syncBar() {
  if (!live) return;
  const { sim } = live, a = sim.ability, atk = live.kind === 'war';
  const alive = sim.units.filter(u => u.alive).length;
  if (atk) {
    const reserve = Object.values(sim.reserve).reduce((x, y) => x + y, 0), mine = sim.units.filter(u => u.alive && u.side === 'us').length;
    $('raidStatus').textContent = `${reserve} ready · ${mine} fighting · ${alive - mine} enemy · ${E2.fmtTime(Math.max(0, sim.limit - sim.t))}`;
    $('tray').querySelectorAll('.tray-btn').forEach(b => {
      const k = b.dataset.k;
      b.querySelector('.n').textContent = sim.reserve[k] || 0;
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

// A tap on the battlefield: aim a bomb or, in a war, send troops out from your base (towards the building you tapped).
function mapTap(cx, cy) {
  if (!live || live.sim.done) return;
  const { sim } = live;
  if (live.armed) { if (E2.raid.fireStrike(sim, cx, cy)) live.armed = false; syncBar(); return; }
  if (live.kind !== 'war') return;
  if (!live.sel) return E2.ui.toast('No troops left to send.');
  if (!E2.raid.canDeploy(sim)) return E2.ui.toast('You have no base left to send troops from.');
  for (let i = 0; i < 3; i++) E2.raid.deploy(sim, live.sel, cx, cy);
  syncBar();
}

function skip() {
  if (!live) return;
  const { sim } = live;
  if (live.kind === 'war') { for (const k of Object.keys(sim.reserve)) sim.reserve[k] = 0; }   // keep the rest at home
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

// ---------- Wars you start ----------
// Tap Attack on the World map and the war opens on one map that shows your country and theirs side by side. Both sides have
// buildings and towers, both send troops. Tap your own land to send units; destroy the enemy HQ to conquer the country.
function startAttack(targetId) {
  const S = E2.state.get();
  const enemy = E2.enemy.generate(targetId, S.colonies.length);
  const army = Object.assign({}, S.army);
  if (!Object.values(army).some(n => n > 0)) { E2.ui.toast('Train some troops first.'); return E2.app.showWorld(); }
  const from = S.homeland;                                  // your side of the war is always your homeland, with your own base
  E2.ui.closeSheet();
  E2.state.enterWar(enemy, from);
  E2.app.showBase();
  const sim = E2.raid.makeWarSim(E2.state.get().buildings, E2.state.warLayout(), enemy, army);
  begin('war', sim, { enemy, from }, `⚔ ${countryName(from)} vs ${countryName(targetId)}`);
  E2.ui.toast(sim.connected ? 'Tap to send troops from your base. They march over the border!' : 'Tap to send troops. Soldiers sail to their coast; planes fly straight there.');
}

function finishWar() {
  const { enemy, from, sim } = live;
  const out = E2.raid.warOutcome(sim);
  endBattle();
  E2.state.exitEnemy();
  const report = E2.state.applyWar(enemy, from, out, Date.now());
  E2.app.goView(E2.state.get().view);
  showAttackReport(report);
}

function showAttackReport(report) {
  prompting = true;
  const S = E2.state.get(), c = E2.byId(report.targetId);
  const stars = '★'.repeat(report.stars) + '☆'.repeat(3 - report.stars);
  let body = report.defeated ? '' : `<div class="stars">${stars}</div>`;
  body += `Enemy: <b>${c.name}</b> · destroyed ${Math.round(report.pct * 100)}%<br>`;
  const loot = Object.entries(report.loot).map(([k, v]) => `+${E2.fmtNum(v)} ${E2.icon(k)}`).join('  ');
  if (report.defeated) {
    const stolen = Object.entries(report.stolen).map(([k, v]) => `-${E2.fmtNum(v)} ${E2.icon(k)}`).join('  ');
    body += `<b>${c.name}</b> overran your headquarters!<br>Stolen: <b>${stolen || 'nothing'}</b><br>🛡 Shield: ${E2.fmtTime(E2.RAID.lossShield / 1000)}<br>`;
  } else body += report.win ? `Loot: <b>${loot || 'none (your storage is full)'}</b><br>` : 'Your attack failed. Train a bigger army and try again.<br>';
  const lost = Object.entries(report.lost).map(([k, v]) => `${v}× ${E2.armyIcon(k)}`).join(' ');
  body += `Troops lost: ${lost || 'none'}<br>`;
  if (report.ruined) body += `Your buildings ruined: <b>${report.ruined}</b> (repair them from the building menu)<br>`;
  if (report.captured) body += `<br>🏴 <b>${c.name} is yours!</b> It is now a territory you can build on. Rank: <b>${report.ranked}</b>.`;
  else if (report.win) body += '<br>Destroy the enemy HQ to conquer the country.';
  E2.ui.modal({
    title: report.captured ? '🏴 Country conquered!' : report.defeated ? '💥 Defeated!' : report.win ? '⚔ Victory!' : '💥 Attack failed',
    body,
    buttons: [{ label: 'OK', cls: 'primary', onClick: () => { prompting = false; E2.ui.afterChange(); checkVictory(); } }],
  });
  E2.sfx && E2.sfx.play(report.win && !report.defeated ? 'win' : 'lose');
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

E2.raidview = { init, check, active, bannerText, mapTap, debugTrigger, ensurePlanned, startAttack, sim: () => live && live.sim };
})();
