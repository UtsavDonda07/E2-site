// World map screen: choose a country to attack, manage your army, review territories.
(function () {
'use strict';
const E2 = window.E2;
const $ = id => document.getElementById(id);
const canvas = $('worldMapCanvas'), ctx = canvas.getContext('2d');

let view = null, sel = null, order = [];
const paths = new Map();
let reach = new Set();
const cam = { z: 1, tx: 0, ty: 0 };            // zoom and pan, applied on top of the base projection
const MAP_W = 1440, MAP_H = 568;               // base projection: 4 px per degree
const proj = (lon, lat) => ({ x: (lon + 180) * 4, y: (84 - lat) * 4 });

// ---------- Map ----------
function layout() {
  const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  if (!r.width || !r.height) return;
  canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
  view = { dpr, w: r.width, h: r.height };
  if (!paths.size) {
    for (const c of order) {
      const p = new Path2D();
      for (const ring of c.outline) {
        for (let i = 0; i < ring.length; i += 2) { const q = proj(ring[i], ring[i + 1]); i ? p.lineTo(q.x, q.y) : p.moveTo(q.x, q.y); }
        p.closePath();
      }
      paths.set(c.id, p);
    }
  }
  const st = E2.state.strike();
  fitTo(st ? [st.from, st.target] : E2.state.owned().concat([...reach]));
}

// Zoom so the given countries fill the view.
function fitTo(ids) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const id of ids) {
    const c = E2.byId(id);
    if (!c) continue;
    for (const ring of c.outline) for (let i = 0; i < ring.length; i += 2) {
      const q = proj(ring[i], ring[i + 1]);
      x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y);
    }
  }
  if (!isFinite(x0)) { x0 = 0; x1 = MAP_W; y0 = 0; y1 = MAP_H; }
  const pad = 40, bw = x1 - x0 + 2 * pad, bh = y1 - y0 + 2 * pad;
  cam.z = Math.min(12, Math.max(view.w / MAP_W, Math.min(view.w / bw, view.h / bh)));
  cam.tx = view.w / 2 - ((x0 + x1) / 2) * cam.z;
  cam.ty = view.h / 2 - ((y0 + y1) / 2) * cam.z;
  clamp(); draw();
}
function clamp() {
  const minZ = Math.min(view.w / MAP_W, view.h / MAP_H);
  cam.z = Math.min(16, Math.max(minZ, cam.z));
  cam.tx = Math.min(80, Math.max(view.w - MAP_W * cam.z - 80, cam.tx));
  cam.ty = Math.min(80, Math.max(view.h - MAP_H * cam.z - 80, cam.ty));
  if (MAP_H * cam.z + 160 < view.h) cam.ty = (view.h - MAP_H * cam.z) / 2;       // the whole world fits: keep it in the middle
}

function colorOf(c) {
  const S = E2.state.get();
  if (sel && c.id === sel.id) return '#ffffff';
  if (c.id === S.homeland) return '#ffd23a';
  if (S.colonies.includes(c.id)) return '#f0a81c';
  if (reach.has(c.id)) return '#e2553f';
  return c.playable ? '#79b84c' : '#9bab8c';                     // neutral land: game green
}

const setCam = () => ctx.setTransform(view.dpr * cam.z, 0, 0, view.dpr * cam.z, view.dpr * cam.tx, view.dpr * cam.ty);

function draw() {
  if (!view) return;
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  const g = ctx.createLinearGradient(0, 0, 0, view.h);
  g.addColorStop(0, '#2a7fb0'); g.addColorStop(1, '#1d5f8a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, view.w, view.h);
  setCam();
  ctx.lineWidth = Math.max(0.5, 1.2 / cam.z); ctx.strokeStyle = 'rgba(28,58,20,.85)'; ctx.lineJoin = 'round';
  for (const c of order) { ctx.fillStyle = colorOf(c); ctx.fill(paths.get(c.id)); ctx.stroke(paths.get(c.id)); }
  drawStrike();
  drawShips();
}

// The attack force: a dashed route from your base to the target, and every unit group moving along it at its own speed.
function drawStrike() {
  const st = E2.state.strike();
  if (!st) return;
  const a = E2.byId(st.from), b = E2.byId(st.target);
  if (!a || !b) return;
  const pa = proj(a.label[0], a.label[1]), pb = proj(b.label[0], b.label[1]), now = Date.now();
  ctx.save();
  setCam();
  ctx.setLineDash([7 / cam.z, 6 / cam.z]); ctx.lineWidth = 2.4 / cam.z; ctx.strokeStyle = 'rgba(255,255,255,.85)';
  ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
  ctx.restore();
  ctx.save();
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);                              // screen space: icons keep their size at every zoom
  const sx = p => cam.tx + p.x * cam.z, sy = p => cam.ty + p.y * cam.z;
  marker(sx(pa), sy(pa), '#4aa3ff', 'BASE');
  marker(sx(pb), sy(pb), '#ff5a45', 'TARGET');
  const dx = pb.x - pa.x, dy = pb.y - pa.y, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;     // route normal
  const groups = Object.entries(st.groups).sort((g, h) => g[1].secs - h[1].secs);
  groups.forEach(([k, g], i) => {
    const p = Math.min(1, Math.max(0, (now - st.startAt) / (g.arriveAt - st.startAt)));
    const air = E2.AIR_UNITS.includes(k), lift = air ? Math.sin(Math.PI * p) * len * 0.1 : 0;                  // aircraft and missiles fly an arc
    const side = (i - (groups.length - 1) / 2) * 24 / cam.z;                                                 // keep the groups apart
    const x = sx({ x: pa.x + dx * p + nx * side, y: pa.y + dy * p + ny * side }), y = sy({ x: 0, y: pa.y + dy * p + ny * side - lift });
    if (air && p > 0 && p < 1) {                                                                                 // fading trail
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 3; ctx.beginPath();
      for (let s = 0; s <= 6; s++) { const q = Math.max(0, p - s * 0.012), l2 = Math.sin(Math.PI * q) * len * 0.1; const tx = sx({ x: pa.x + dx * q + nx * side, y: 0 }), ty = sy({ x: 0, y: pa.y + dy * q + ny * side - l2 }); s ? ctx.lineTo(tx, ty) : ctx.moveTo(tx, ty); }
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.ellipse(x, y + 14 + (air ? lift * cam.z * 0.3 : 0), 11, 4, 0, 0, 7); ctx.fill();   // shadow
    const img = E2.art.unitSprite(k, true);
    if (img) ctx.drawImage(img, x - 15, y - 15, 30, 30);
    else { ctx.font = '24px system-ui, "Segoe UI Emoji", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(E2.ARMY[k].icon, x, y); }
    ctx.font = '900 12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.strokeText('×' + g.n, x, y + 21); ctx.fillStyle = '#fff'; ctx.fillText('×' + g.n, x, y + 21);
  });
  ctx.restore();
}
function marker(x, y, color, label) {
  ctx.fillStyle = color; ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(x, y, 8, 0, 7); ctx.stroke(); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fill();
  ctx.font = '900 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.strokeText(label, x, y - 13); ctx.fillStyle = '#fff'; ctx.fillText(label, x, y - 13);
}

// Trade ships sail out to their buyer and back. They keep the same size on screen at every zoom.
function drawShips() {
  const trips = E2.state.trips();
  if (!trips.length) return;
  const now = Date.now();
  for (const t of trips) {
    const a = E2.byId(t.from), b = E2.byId(t.to);
    if (!a || !b) continue;
    const pa = proj(a.label[0], a.label[1]), pb = proj(b.label[0], b.label[1]);
    const p = Math.min(1, Math.max(0, (now - t.startAt) / (t.endAt - t.startAt))), out = p < 0.5, f = out ? p * 2 : (1 - p) * 2;
    const x = pa.x + (pb.x - pa.x) * f, y = pa.y + (pb.y - pa.y) * f;
    ctx.save();
    setCam();
    ctx.setLineDash([4 / cam.z, 5 / cam.z]); ctx.lineWidth = 1.6 / cam.z; ctx.strokeStyle = 'rgba(255,255,255,.55)';
    ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);                              // screen space from here
    const dirX = (pb.x - pa.x) * (out ? 1 : -1);
    E2.art.drawShip(ctx, t.tier, cam.tx + x * cam.z, cam.ty + y * cam.z + 8, dirX < 0, 1, 0.3);
    ctx.restore();
  }
}
let shipTimer = 0;
const sailing = () => { if (visible() && (E2.state.trips().length || E2.state.strike())) draw(); if (visible()) tickStrikeCard(); };

// The test point is in device pixels; the path is placed by the current transform.
function pickAt(cssX, cssY) {
  setCam();
  const px = cssX * view.dpr, py = cssY * view.dpr;
  for (let i = order.length - 1; i >= 0; i--) if (ctx.isPointInPath(paths.get(order[i].id), px, py)) return order[i];
  return null;
}
const local = ev => { const r = canvas.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };

// ---------- Pan and zoom ----------
const ptrs = new Map();
let moved = false, pdist = 0;
function bindInput() {
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', ev => {
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* some WebViews report touches without a capturable pointer */ }
    const p = local(ev); ptrs.set(ev.pointerId, { x: p.x, y: p.y, sx: p.x, sy: p.y });
    moved = ptrs.size > 1; pdist = 0;
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pdist = Math.hypot(a.x - b.x, a.y - b.y); }
  });
  canvas.addEventListener('pointermove', ev => {
    const q = ptrs.get(ev.pointerId); if (!q) return;
    const p = local(ev);
    if (ptrs.size === 1) {
      if (!moved && Math.hypot(p.x - q.sx, p.y - q.sy) > 8) moved = true;
      if (moved) { cam.tx += p.x - q.x; cam.ty += p.y - q.y; clamp(); draw(); }
      q.x = p.x; q.y = p.y;
    } else if (ptrs.size === 2) {
      q.x = p.x; q.y = p.y;
      const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pdist > 0 && d > 0) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pdist);
      pdist = d; moved = true;
    }
  });
  const up = (ev, cancel) => {
    const q = ptrs.get(ev.pointerId); if (!q) return;
    ptrs.delete(ev.pointerId);
    if (!cancel && !moved && ptrs.size === 0) tap(q.x, q.y);
    if (ptrs.size === 1) { moved = true; pdist = 0; }
  };
  canvas.addEventListener('pointerup', ev => up(ev, false));
  canvas.addEventListener('pointercancel', ev => up(ev, true));
  canvas.addEventListener('wheel', ev => { ev.preventDefault(); const p = local(ev); zoomAt(p.x, p.y, ev.deltaY < 0 ? 1.2 : 1 / 1.2); }, { passive: false });
}
function zoomAt(sx, sy, f) {
  const wx = (sx - cam.tx) / cam.z, wy = (sy - cam.ty) / cam.z;
  cam.z *= f; clamp();
  cam.tx = sx - wx * cam.z; cam.ty = sy - wy * cam.z;
  clamp(); draw();
}
function tap(x, y) {
  const c = pickAt(x, y);
  if (c) { sel = c; $('wSheet').classList.add('hidden'); draw(); renderCard(); }
  else if (sel && E2.state.strike()) { sel = null; draw(); renderCard(); }
}

// ---------- Target card ----------
function renderCard() {
  const el = $('wCard'), S = E2.state.get();
  if (!sel && S.strike) return renderStrikeCard();
  if (!sel) {
    el.innerHTML = `<div class="hint">Tap a <b style="color:#d2392a">red</b> country to scout it. Conquer ${E2.WIN_COUNT} to become Emperor of Emperors.</div>`;
    return;
  }
  if (S.land[sel.id]) {
    const home = sel.id === S.homeland;
    el.innerHTML = `<div class="wc-name">${sel.name}</div><div class="wc-sub">${home ? 'Your homeland' : 'Your territory'}</div>
      <button class="btn primary" id="wVisit">Visit</button>`;
    $('wVisit').onclick = () => E2.app.goView(sel.id);
    return;
  }
  if (!reach.has(sel.id)) {
    el.innerHTML = `<div class="wc-name">${sel.name}</div><div class="wc-sub">${sel.playable ? 'Out of reach. Conquer a neighbour first.' : 'Not a country you can attack.'}</div>`;
    return;
  }
  const enemy = E2.enemy.generate(sel.id, S.colonies.length), d = E2.enemy.describe(enemy);
  const army = E2.ARMY_KEYS.map(k => S.army[k] ? `${S.army[k]}× ${E2.armyIcon(k)}` : '').filter(Boolean).join('  ') || 'No army';
  const loot = E2.RES_KEYS.map(k => `${E2.icon(k)}${E2.fmtNum(enemy.loot[k])}`).join(' ');
  el.innerHTML = `<div class="wc-name">${sel.name} <span class="wc-pw">⚡ ${sel.power}/10 · ${E2.powerLabel(sel.power)}</span></div>
    <div class="wc-sub">Defences: ${d.guns} guns · ${d.missiles} missile · ${d.aa} anti-air · level ${d.level}</div>
    <div class="wc-sub">Loot up to ${loot}</div>
    <div class="wc-sub">Your army: ${army}</div>
    <div class="wc-sub">${travelLine(sel.id)}</div>
    <div class="wc-btns"><button class="btn" id="wTrain">🪖 Army</button><button class="btn primary" id="wGo" ${E2.ARMY_KEYS.some(k => S.army[k] > 0) && !S.strike ? '' : 'disabled'}>${S.strike ? 'Force en route' : '⚔ Attack!'}</button></div>`;
  $('wTrain').onclick = openArmy;
  $('wGo').onclick = () => { if (E2.raidview.launch(sel.id)) sel = null; };
}

// ---------- Travel ----------
function travelLine(targetId) {
  const plan = E2.state.strikePlan(targetId), secs = Object.values(plan.groups).map(g => g.secs);
  if (!secs.length) return `Distance ${E2.fmtNum(plan.km)} km`;
  const lo = Math.min(...secs), hi = Math.max(...secs);
  return `🚀 ${E2.fmtNum(plan.km)} km · arrives in ${E2.fmtTime(lo)}${hi > lo ? ' to ' + E2.fmtTime(hi) : ''}`;
}

let strikeSig = '';
function renderStrikeCard() {
  const el = $('wCard'), ss = E2.raidview.strikeState(Date.now());
  if (!ss) return;
  const { st } = ss;
  strikeSig = ss.groups.map(g => g.k + (g.left <= 0 ? 1 : 0)).join();
  const rows = ss.groups.sort((a, b) => a.at - b.at).map(g => `<div class="sk-g ${g.left <= 0 ? 'in' : ''}" data-k="${g.k}"><span class="sk-i">${E2.armyIcon(g.k)}</span><b>×${g.n}</b><span class="sk-eta">${g.left <= 0 ? 'Arrived ✓' : '⏱ ' + E2.fmtTime(g.left)}</span></div>`).join('');
  el.innerHTML = `<div class="wc-name">🚀 Attack on ${E2.byId(st.target).name}</div>
    <div class="wc-sub">From ${E2.byId(st.from).name} · ${E2.fmtNum(st.km)} km</div>
    <div class="sk-groups">${rows}</div>
    <div class="wc-btns"><button class="btn" id="skRecall">Recall</button><button class="btn primary" id="skFight" ${ss.ready ? '' : 'disabled'}>⚔ Fight!</button></div>
    ${E2.DEBUG ? '<div class="wc-btns"><button class="btn" id="skSkip">⏩ Skip travel (debug)</button></div>' : ''}`;
  $('skRecall').onclick = () => E2.raidview.recall();
  $('skFight').onclick = () => { hide(); E2.raidview.engage(); };
  if ($('skSkip')) $('skSkip').onclick = () => { for (const g of Object.values(st.groups)) g.arriveAt = Date.now(); E2.state.save(); renderStrikeCard(); draw(); };
}
// Once a second: update the countdowns in place, and rebuild the card only when a group arrives.
function tickStrikeCard() {
  const S = E2.state.get();
  if (!S || !S.strike || sel) return;
  const ss = E2.raidview.strikeState(Date.now());
  if (!ss) return;
  if (ss.groups.map(g => g.k + (g.left <= 0 ? 1 : 0)).join() !== strikeSig || !$('skFight')) return renderStrikeCard();
  for (const g of ss.groups) {
    const row = $('wCard').querySelector(`.sk-g[data-k="${g.k}"] .sk-eta`);
    if (row) row.textContent = g.left <= 0 ? 'Arrived ✓' : '⏱ ' + E2.fmtTime(g.left);
  }
}
// Called after a force is launched or recalled: re-frame the map and rebuild the card.
function refresh() {
  sel = null;
  $('wSheet').classList.add('hidden');
  if (view) layout();
  renderCard();
}

// ---------- Army sheet ----------
function openArmy() {
  const S = E2.state.get(), box = $('wSheet');
  const used = E2.state.armyUsed(), cap = E2.state.armyCapacity(), lab = E2.state.labLevel();
  let html = `<div class="sheet-head"><div class="ttl"><b>Army</b><small>Barracks room ${used}/${cap} · Research Lab level ${lab}</small></div><button class="icon-btn" data-close>✕</button></div>
    <div class="progress"><i style="width:${cap ? Math.min(100, used / cap * 100) : 0}%"></i></div>`;
  if (!cap) html += `<p>You have no barracks yet. Build a Barracks from the Shop (Military tab) to house troops.</p>`;
  for (const k of E2.ARMY_KEYS) {
    const u = E2.ARMY[k], block = E2.state.trainBlock(k, 1);
    const cost = Object.entries(u.cost).map(([r, v]) => `<span class="cost ${S.resources[r] >= v ? '' : 'bad'}">${E2.icon(r)}${E2.fmtNum(v)}</span>`).join(' ');
    html += `<div class="army-row"><span class="aico">${E2.armyIcon(k)}</span>
      <span class="ainfo"><b>${u.name}</b> <small>room ${u.space}</small><span class="costs">${cost}</span>${block && block.startsWith('Needs') ? `<small class="bad">${block}</small>` : ''}</span>
      <span class="acount">${S.army[k]}</span>
      <button class="icon-btn" data-dis="${k}" ${S.army[k] ? '' : 'disabled'}>−</button>
      <button class="icon-btn plusbtn" data-train="${k}" ${block ? 'disabled' : ''}>+</button></div>`;
  }
  html += `<p>Units you send are lost if they fall; survivors come home. Disbanding refunds half the cost.</p>`;
  box.innerHTML = html;
  box.classList.remove('hidden');
  box.querySelector('[data-close]').onclick = () => { box.classList.add('hidden'); renderCard(); };
  box.querySelectorAll('[data-train]').forEach(b => b.onclick = () => { const r = E2.state.train(b.dataset.train, 1); if (!r.ok) E2.ui.toast(r.reason); E2.ui.updateHud(); openArmy(); });
  box.querySelectorAll('[data-dis]').forEach(b => b.onclick = () => { E2.state.disband(b.dataset.dis); E2.ui.updateHud(); openArmy(); });
}

// ---------- Show / hide ----------
function show(openArmySheet) {
  const S = E2.state.get();
  reach = new Set(E2.reachable(E2.state.owned()));
  sel = null;
  $('screenWorld').classList.remove('hidden');
  $('wRank').textContent = `${E2.rankOf(S.colonies.length)} · conquered ${S.colonies.length}/${E2.WIN_COUNT}`;
  $('wSheet').classList.add('hidden');
  renderCard();
  requestAnimationFrame(() => { layout(); if (openArmySheet) openArmy(); });
  clearInterval(shipTimer); shipTimer = setInterval(sailing, 100);
}
function hide() { $('screenWorld').classList.add('hidden'); clearInterval(shipTimer); }
const visible = () => !$('screenWorld').classList.contains('hidden');

function init() {
  order = E2.COUNTRIES.slice().sort((a, b) => E2.areaOf(b) - E2.areaOf(a));
  $('wArmyIco').innerHTML = E2.icon('shield');
  bindInput();
  $('wBack').onclick = () => { hide(); E2.app.showBase(); };
  $('wArmy').onclick = openArmy;
  window.addEventListener('resize', () => { if (visible()) layout(); });
}

E2.worldmap = {
  init, show, hide, visible, openArmy, refresh,
  select: id => { sel = E2.byId(id); draw(); renderCard(); },
  // Helpers for tests: where a country's label sits on screen, and which country is at a point.
  screenOf: id => { const c = E2.byId(id), q = proj(c.label[0], c.label[1]); return { x: cam.tx + q.x * cam.z, y: cam.ty + q.y * cam.z }; },
  pickAt: (x, y) => { const c = pickAt(x, y); return c && c.id; },
};
})();
