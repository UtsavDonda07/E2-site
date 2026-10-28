// DOM UI: HUD, shop, selection buttons, building sheet, settings, toasts and modals.
(function () {
'use strict';
const E2 = window.E2;
const B = E2.BUILDINGS;
const $ = id => document.getElementById(id);

let sheetMode = null;           // 'shop' | 'info' | null
let infoUid = null;
let shopTab = 'economy';
let ctxSig = '';

// ---------- Toast / modal ----------
function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 2700);
}

// x: true adds a red close icon on the top right corner (use it for dialogs that only need "close").
function modal({ title, body, buttons, x }) {
  $('modalBox').innerHTML = `<h3>${title}</h3><div class="body">${body}</div><div class="row"></div>`;
  if (x) addModalX();
  const row = $('modalBox').querySelector('.row');
  for (const b of buttons) {
    const btn = document.createElement('button');
    btn.className = 'btn ' + (b.cls || '');
    btn.textContent = b.label;
    btn.onclick = () => { closeModal(); if (b.onClick) b.onClick(); };
    row.appendChild(btn);
  }
  $('modal').classList.remove('hidden');
}
function addModalX() {
  const b = document.createElement('button');
  b.className = 'modal-x'; b.setAttribute('aria-label', 'Close'); b.textContent = '✕';
  b.onclick = closeModal;
  $('modalBox').appendChild(b);
}
function closeModal() { $('modal').classList.add('hidden'); }
const modalOpen = () => !$('modal').classList.contains('hidden');

// ---------- Helpers ----------
const raiding = () => !!(E2.raidview && E2.raidview.active());
const costHtml = cost => Object.entries(cost).map(([k, v]) => {
  const ok = E2.state.get().resources[k] >= v;
  return `<span class="cost ${ok ? '' : 'bad'}">${E2.icon(k)}${E2.fmtNum(v)}</span>`;
}).join(' ') || '<span class="cost">Free</span>';

// ---------- HUD ----------
function init() {
  // Top bars only show real numbers: no buttons that do nothing.
  $('resRow').innerHTML = E2.RES_KEYS.map(k =>
    `<div class="rbar ${k}" id="chip-${k}"><div class="fill"></div><span class="v">0</span>${E2.icon(k)}</div>`
  ).join('');
  $('btnSettings').innerHTML = E2.icon('gear');
  $('atkIco').innerHTML = E2.icon('map');
  $('shopIco').innerHTML = E2.icon('coins');

  $('btnBuild').onclick = openShop;
  $('btnSettings').onclick = settings;
  $('btnAttack').onclick = () => { if (!raiding()) E2.app.showWorld(); };
  $('placeCancel').onclick = () => E2.base.cancelPlacing();
  $('placeOk').onclick = () => E2.base.confirmPlacing();
}

function updateHud() {
  const S = E2.state.get();
  if (!S) return;
  const cap = E2.state.caps();
  for (const k of E2.RES_KEYS) {
    const bar = $('chip-' + k);
    if (!bar) continue;
    bar.querySelector('.v').textContent = E2.fmtNum(S.resources[k]);
    bar.querySelector('.fill').style.width = `calc(${Math.min(100, S.resources[k] / cap * 100)}% - 4px)`;
    bar.classList.toggle('full', S.resources[k] >= cap);
  }
  $('builders').innerHTML = `${E2.icon('hammer')}<span class="t">${E2.state.freeBuilders()}/${S.builders}</span>`;
  const now = Date.now(), left = S.raid.shieldUntil - now;
  $('shieldPill').classList.toggle('hidden', left <= 0);                     // the shield only shows while it is active
  if (left > 0) $('shieldPill').innerHTML = `${E2.icon('shield')}<span class="t">${E2.fmtTime(left / 1000)}</span>`;

  const lv = E2.levelInfo(S.xp);
  $('lvlBadge').textContent = lv.level;
  $('xpFill').style.width = (lv.into / lv.need * 100) + '%';

  const ban = $('banner'), info = E2.raidview && E2.raidview.bannerText(now);
  if (info && left <= 0) { ban.textContent = info.text; ban.classList.remove('hidden'); } else ban.classList.add('hidden');
}

function setHome() {
  const S = E2.state.get(), c = E2.byId(S.view);
  $('homeName').textContent = `${c.name}${S.view === S.homeland ? '' : ' (territory)'}`;
}

// ---------- Sheet ----------
const sheet = () => $('sheet');
function closeSheet() {
  sheetMode = null; infoUid = null;
  sheet().classList.add('hidden');
  sheet().classList.remove('shop');
  renderCtx(true);
}
const sheetOpen = () => sheetMode !== null;

// ----- Shop: a framed panel with tabs and building cards -----
const SHOP_TABS = { economy: ['goldMine', 'oilRefinery', 'steelMill', 'vault', 'harbor'], defence: ['gunTurret', 'missileBattery', 'antiAir'], military: ['barracks', 'researchLab'] };
const TAB_NAMES = { economy: 'Economy', defence: 'Defence', military: 'Military' };
const TAB_ICONS = { economy: 'coins', defence: 'shield', military: 'hammer' };

function openShop() {
  if (E2.base.isPlacing() || raiding()) return;
  closeSheet();
  sheetMode = 'shop';
  renderShop();
}

// The price on the green button: every resource with its icon, grey when you cannot pay.
const priceHtml = cost => Object.entries(cost).map(([k, v]) => {
  const ok = E2.state.get().resources[k] >= v;
  return `<span class="p ${ok ? '' : 'bad'}">${E2.icon(k)}${E2.fmtNum(v)}</span>`;
}).join('');

function renderShop() {
  const S = E2.state.get(), free = E2.state.freeBuilders();
  const cards = SHOP_TABS[shopTab].map(type => {
    const def = B[type], lv = def.levels[0];
    const count = E2.state.countOf(type), max = E2.state.maxCount(type);
    const afford = E2.state.canAfford(lv.cost);
    const off = count >= max ? 'Max built' : free < 1 ? 'Builders busy' : '';
    return `<div class="scard ${off ? 'off' : ''}" data-type="${type}" ${off ? '' : 'role="button"'}>
      <div class="scard-top"><b>${def.name}</b><button class="info-i" data-info="${type}" aria-label="Info">i</button></div>
      <div class="scard-thumb" data-thumb="${type}"><span class="count">${count}/${max}</span></div>
      <div class="scard-time">⏱ ${E2.fmtTime(lv.time)}</div>
      <button class="pbtn ${afford ? '' : 'poor'}" ${off || !afford ? 'disabled' : ''}>${off || priceHtml(lv.cost)}</button>
    </div>`;
  }).join('');
  sheet().classList.add('shop');
  sheet().innerHTML = `<div class="shop-panel">
    <div class="shop-art" data-thumb="hq"></div>
    <button class="shop-x" data-close aria-label="Close">✕</button>
    <div class="shop-head"><b>Shop</b><small>Build and upgrade to grow your empire</small><span class="meta">HQ level ${E2.state.hqLevel()} · builders free ${free}/${S.builders}</span></div>
    <div class="shop-tabs">${Object.keys(SHOP_TABS).map(t => `<button class="stab ${shopTab === t ? 'on' : ''}" data-tab="${t}">${E2.icon(TAB_ICONS[t])}<span>${TAB_NAMES[t]}</span></button>`).join('')}</div>
    <div class="shop-grid">${cards}</div></div>`;
  sheet().classList.remove('hidden');
  sheet().querySelectorAll('[data-thumb]').forEach(el => el.insertBefore(E2.art.thumb(el.dataset.thumb, el.classList.contains('shop-art') ? 104 : 86), el.firstChild));
  sheet().querySelector('[data-close]').onclick = closeSheet;
  sheet().onclick = ev => { if (ev.target === sheet()) closeSheet(); };         // tap the dim area to close
  sheet().querySelectorAll('.stab').forEach(t => t.onclick = () => { shopTab = t.dataset.tab; renderShop(); });
  sheet().querySelectorAll('.info-i').forEach(b => b.onclick = ev => { ev.stopPropagation(); showBuildingInfo(b.dataset.info); });
  sheet().querySelectorAll('.scard').forEach(el => el.onclick = () => {
    if (el.classList.contains('off') || el.querySelector('.pbtn').disabled) return toast(el.classList.contains('off') ? 'You cannot build another one yet.' : 'Not enough resources.');
    const type = el.dataset.type; closeSheet(); E2.base.startPlacing(type);
  });
}

// What a building is for, shown from the "i" on its card.
function showBuildingInfo(type) {
  const def = B[type], lines = [`Build time: ${E2.fmtTime(def.levels[0].time)}`, `Levels: up to ${E2.state.maxLevelFor(type)} with your current HQ`];
  if (def.produces) lines.push(`Makes ${E2.fmtNum(E2.rateOf(type, 1))} ${E2.RES[def.produces].name.toLowerCase()} per hour at level 1`);
  if (def.tower) lines.push(`Hit points ${def.tower.hp[0]} · damage ${def.tower.dmg[0]} · range ${def.tower.range} · ${def.tower.targets === 'air' ? 'shoots air only' : 'shoots ground only'}`);
  if (type === 'vault') lines.push(`Adds ${E2.fmtNum(def.storage[0])} storage for each resource`);
  if (type === 'barracks') lines.push(`Houses ${def.capacity[0]} troops at level 1`);
  if (type === 'harbor') lines.push(`Ship carries ${def.capacity[0]} oil or steel at level 1`, 'Trips take 2 to 10 minutes');
  modal({ title: def.name, body: `${def.desc}<br><br>${lines.join('<br>')}`, buttons: [{ label: 'OK', cls: 'primary' }] });
}

// ----- Building info -----
function openInfo(uid) {
  const b = E2.state.byUid(uid);
  if (!b) return closeSheet();
  sheetMode = 'info'; infoUid = uid;
  sheet().classList.remove('shop'); sheet().onclick = null;
  const def = B[b.type];
  const building = !!b.endAt;
  const lvLabel = b.ruined ? (building ? `Repairing · Level ${b.level}` : `💥 Ruined · Level ${b.level}`)
    : b.level === 0 ? 'Under construction' : `Level ${b.level}` + (building ? ` → ${b.upTo}` : '');

  let html = `<div class="sheet-head"><span class="ico">${def.icon}</span><div class="ttl"><b>${def.name}</b><small>${lvLabel}</small></div><button class="icon-btn" data-close>✕</button></div><p>${def.desc}</p>`;

  if (def.tower && b.level >= 1) {
    const t = def.tower;
    html += `<div class="stat"><span>Hit points</span><span>${E2.hpOf(b.type, b.level)}</span></div>
             <div class="stat"><span>Damage</span><span>${t.dmg[b.level - 1]}${t.splash ? ' (area)' : ''} / ${t.rate}s</span></div>
             <div class="stat"><span>Range · Targets</span><span>${t.range} cells · ${t.targets === 'air' ? 'Air only' : 'Ground only'}</span></div>`;
  } else if (b.level >= 1 && !def.produces) {
    html += `<div class="stat"><span>Hit points</span><span>${E2.hpOf(b.type, b.level)}</span></div>`;
  }
  if (def.produces && b.level >= 1 && !b.ruined) {
    const k = def.produces;
    html += `<div class="stat"><span>Production</span><span>${E2.icon(k)} ${E2.fmtNum(E2.rateOf(b.type, b.level))}/h</span></div>
             <div class="stat"><span>Stored</span><span id="liveStored"></span></div>`;
  }
  if (b.type === 'vault' && b.level >= 1) html += `<div class="stat"><span>Adds storage</span><span>+${E2.fmtNum(def.storage[b.level - 1])} each</span></div>`;
  if (b.type === 'harbor' && b.level >= 1) html += `<div class="stat"><span>Ship carries</span><span>${E2.state.harborCapacity(b)} per trip</span></div>`;
  if (b.type === 'harbor' && b.level >= 1 && !b.ruined && !building) html += harborHtml(b);
  if (b.type === 'barracks' && b.level >= 1) html += `<div class="stat"><span>Army room</span><span>+${def.capacity[b.level - 1]}</span></div>`;
  if (b.type === 'researchLab' && b.level >= 1) html += `<div class="stat"><span>Unlocks</span><span>${E2.ARMY_KEYS.filter(k => E2.ARMY[k].lab > 0 && E2.ARMY[k].lab <= b.level).map(k => E2.ARMY[k].icon + ' ' + E2.ARMY[k].name).join(', ') || 'nothing yet'}</span></div>`;
  if (b.type === 'hq') html += `<div class="stat"><span>Base storage</span><span>${E2.fmtNum(E2.HQ.baseCap[b.level - 1])} each</span></div>
                                 <div class="stat"><span>Max building level</span><span>${E2.HQ.levelCap[b.level - 1]}</span></div>`;

  if (building) {
    html += `<div class="progress"><i id="liveBar"></i></div><div class="stat"><span>Time left</span><span id="liveTime"></span></div>
             <button class="btn primary" data-finish>📺 Finish now (watch ad)</button>`;
  } else if (b.ruined) {
    const block = E2.state.repairBlock(b), cost = E2.state.repairCost(b);
    html += `<button class="btn primary" data-repair ${block ? 'disabled' : ''}>🔧 Repair <span>${costHtml(cost)}</span><span class="cost">⏱ ${E2.fmtTime(E2.state.repairTime(b))}</span></button>`;
    if (block) html += `<div class="reason">${block}</div>`;
  } else {
    if (def.produces && b.level >= 1) html += `<button class="btn primary" data-collect>💰 Collect</button>`;
    const block = E2.state.upgradeBlock(b), next = def.levels[b.level];
    if (next) {
      html += `<button class="btn" data-upgrade ${block ? 'disabled' : ''}>⬆ Upgrade to Lv ${b.level + 1} <span>${costHtml(next.cost)}</span><span class="cost">⏱ ${E2.fmtTime(next.time)}</span></button>`;
      if (block) html += `<div class="reason">${block}</div>`;
    }
  }
  sheet().innerHTML = html;
  sheet().classList.remove('hidden');
  const q = s => sheet().querySelector(s);
  q('[data-close]').onclick = closeSheet;
  if (q('[data-collect]')) q('[data-collect]').onclick = () => collectOne(uid);
  if (q('[data-upgrade]')) q('[data-upgrade]').onclick = () => upgrade(uid);
  if (q('[data-repair]')) q('[data-repair]').onclick = () => repair(uid);
  if (q('[data-finish]')) q('[data-finish]').onclick = () => finishWithAd(uid);
  bindHarbor(b);
  tickInfo();
  renderCtx(true);
}

// ----- Harbor: pick a cargo and a destination, then the ship sails and comes back with gold -----
const trade = { res: 'oil', frac: 1, to: null };
const FRACS = [[0.25, '¼'], [0.5, '½'], [1, 'Full']];
function tradeAmount(b) {
  const room = Math.min(E2.state.harborCapacity(b), Math.floor(E2.state.get().resources[trade.res]));
  return Math.floor(room * trade.frac);
}
function harborHtml(b) {
  const S = E2.state.get(), home = E2.state.viewId();
  if (b.trip) {
    const t = b.trip;
    return `<div class="trade"><div class="stat"><span>🚢 Sailing to</span><span>${E2.byId(t.to).name}</span></div>
      <div class="stat"><span>Cargo</span><span>${E2.fmtNum(t.amount)} ${E2.icon(t.res)}</span></div>
      <div class="stat"><span>Returns with</span><span>${E2.icon('gold')} ${E2.fmtNum(t.reward)}</span></div>
      <div class="progress"><i id="liveTrip"></i></div><div class="stat"><span>Back in</span><span id="liveTripTime"></span></div></div>`;
  }
  const targets = E2.state.tradeTargets();
  if (!targets.some(id => id === trade.to)) trade.to = targets[0] || null;
  const amount = tradeAmount(b);
  const cargo = E2.TRADE_KEYS.map(k => `<button class="chip ${trade.res === k ? 'on' : ''}" data-res="${k}">${E2.icon(k)} ${E2.RES[k].name}<small>${E2.fmtNum(S.resources[k])}</small></button>`).join('');
  const sizes = FRACS.map(([f, label]) => `<button class="chip ${trade.frac === f ? 'on' : ''}" data-frac="${f}">${label}</button>`).join('');
  const dests = targets.map(id => {
    const c = E2.byId(id), q = E2.tradeQuote(trade.res, amount, home, id);
    return `<button class="dest ${trade.to === id ? 'on' : ''}" data-to="${id}"><b>${c.name}</b><small>${E2.powerLabel(c.power)}</small>
      <span class="cost">${E2.icon('gold')}${E2.fmtNum(q.reward)}</span><span class="cost">⏱ ${E2.fmtTime(q.secs)}</span></button>`;
  }).join('');
  return `<div class="trade"><div class="trade-h">Sell cargo abroad</div>
    <div class="chips">${cargo}</div>
    <div class="chips">${sizes}<span class="amt">${E2.fmtNum(amount)} ${E2.icon(trade.res)}</span></div>
    <div class="dests">${dests || '<small>No country to trade with yet.</small>'}</div>
    <button class="btn primary" data-sail ${amount < 1 || !trade.to ? 'disabled' : ''}>🚢 Send ship</button></div>`;
}
function bindHarbor(b) {
  if (b.type !== 'harbor') return;
  const root = sheet();
  const redo = () => openInfo(b.uid);
  root.querySelectorAll('[data-res]').forEach(e => e.onclick = () => { trade.res = e.dataset.res; redo(); });
  root.querySelectorAll('[data-frac]').forEach(e => e.onclick = () => { trade.frac = Number(e.dataset.frac); redo(); });
  root.querySelectorAll('[data-to]').forEach(e => e.onclick = () => { trade.to = e.dataset.to; redo(); });
  const go = root.querySelector('[data-sail]');
  if (go) go.onclick = () => {
    const r = E2.state.startTrade(b.uid, trade.res, tradeAmount(b), trade.to);
    toast(r.ok ? `🚢 Ship sailing to ${E2.byId(trade.to).name}` : r.reason);
    if (r.ok) E2.sfx.play('collect');
    afterChange();
    redo();
  };
}

function tickInfo() {
  if (sheetMode !== 'info') return;
  const b = E2.state.byUid(infoUid);
  if (!b) return closeSheet();
  const tb = $('liveTrip');
  if (tb && b.trip) {
    const total = b.trip.endAt - b.trip.startAt, left = Math.max(0, b.trip.endAt - Date.now());
    tb.style.width = (1 - left / total) * 100 + '%';
    $('liveTripTime').textContent = E2.fmtTime(left / 1000);
  }
  const stored = $('liveStored');
  if (stored) stored.innerHTML = `${E2.icon(B[b.type].produces)} ${E2.fmtNum(b.stored)} / ${E2.fmtNum(E2.holdCap(b.type, b.level))}`;
  const bar = $('liveBar');
  if (bar && b.endAt) {
    const total = b.endAt - b.startAt, left = Math.max(0, b.endAt - Date.now());
    bar.style.width = (total ? (1 - left / total) * 100 : 100) + '%';
    $('liveTime').textContent = E2.fmtTime(left / 1000);
  }
}

// ---------- Actions ----------
function upgrade(uid) {
  const b = E2.state.byUid(uid), r = E2.state.startUpgrade(uid);
  toast(r.ok ? `⏱ Upgrading ${B[b.type].name}` : r.reason);
  afterChange();
  if (sheetMode === 'info') openInfo(uid);
}
function repair(uid) {
  const b = E2.state.byUid(uid), r = E2.state.startRepair(uid);
  toast(r.ok ? `🔧 Repairing ${B[b.type].name}` : r.reason);
  afterChange();
  if (sheetMode === 'info') openInfo(uid);
}
function finishWithAd(uid) {
  E2.bridge.rewardedAd('finish_building').then(ok => {
    if (!ok) return toast('Ad not completed.');
    announce(E2.state.finishNow(uid));
    afterChange();
    if (sheetMode === 'info' && E2.state.byUid(uid)) openInfo(uid);
  });
}
function collectOne(uid) {
  const b = E2.state.byUid(uid);
  if (!b) return;
  const r = E2.state.collect(uid);
  if (!r.res) return;
  if (r.amount > 0) { E2.base.floatText(`+${E2.fmtNum(r.amount)}`, b); E2.sfx.play('collect'); }
  if (r.full) toast('Storage full! Build a Vault or upgrade your HQ.');
  afterChange();
  if (sheetMode === 'info' && infoUid === uid) openInfo(uid);
}
function announce(done) {
  for (const { b, wasNew, wasRepair, clear, trade: sale } of done) {
    if (sale) {                                            // a trade ship came home
      toast(`🚢 ${E2.byId(sale.to).name} bought your cargo: +${E2.fmtNum(sale.gained)} gold${sale.gained < sale.reward ? ' (storage full)' : ''}`);
      E2.sfx.play('collect');
      if (sheetMode === 'info' && E2.state.byUid(infoUid)) openInfo(infoUid);
      continue;
    }
    if (clear) {                                           // a tree or rock was removed
      toast(`${clear.kind === 'tree' ? '🌳' : '🪨'} ${E2.OBSTACLE[clear.kind].name} removed`);
      if (clear.land === E2.state.viewId()) E2.base.refreshDecor();
      continue;
    }
    const def = B[b.type];
    toast(wasRepair ? `🔧 ${def.name} repaired` : wasNew ? `✅ ${def.name} built` : `✅ ${def.name} upgraded to Lv ${b.level}`);
  }
  if (done.leveled) toast(`⭐ Level up! You are now level ${done.leveled}`);
}
function afterChange() { updateHud(); renderCtx(true); }

// ---------- Selection buttons ----------
function ctxButton(cls, icon, label, sub, handler, disabled) {
  const b = document.createElement('button');
  b.className = 'ctx-btn ' + cls;
  b.innerHTML = `${icon}<span>${label}</span>${sub ? `<span class="sub">${sub}</span>` : ''}`;
  b.disabled = !!disabled;
  b.onclick = handler;
  return b;
}

// Buttons for a selected tree or rock: remove it (gold, a free builder and a short wait).
function renderObstacleCtx(bar, ob, force) {
  const def = E2.OBSTACLE[ob.kind];
  const working = E2.state.jobs().some(j => j.cell === ob.cell);
  const block = working ? 'Being removed…' : E2.state.freeBuilders() < 1 ? 'All builders are busy.' : !E2.state.canAfford(def.cost) ? 'Not enough resources.' : null;
  const sig = ['ob', ob.cell, working ? 1 : 0, block].join('|');
  if (!force && sig === ctxSig) return;
  ctxSig = sig;
  bar.innerHTML = '';
  const sub = `${costHtml(def.cost)} <span class="cost">⏱ ${E2.fmtTime(def.time)}</span>`;
  bar.append(ctxButton('green', E2.icon('hammer'), working ? 'Removing…' : `Remove ${def.name}`, working ? '' : sub, () => {
    const r = E2.state.startClear(ob.tx, ob.ty);
    toast(r.ok ? `🔨 Removing the ${def.name.toLowerCase()}` : r.reason);
    afterChange();
  }, !!block));
  bar.classList.remove('hidden');
}

function renderCtx(force) {
  const bar = $('ctxBar');
  const uid = E2.base && E2.base.selected();
  const b = uid && E2.state.byUid(uid);
  const ob = !b && E2.base && E2.base.selectedObstacle();
  const hide = E2.base.isPlacing() || raiding() || sheetMode === 'shop' || sheetMode === 'info';
  if (ob && !hide) return renderObstacleCtx(bar, ob, force);
  if (!b || hide) { bar.classList.add('hidden'); ctxSig = ''; return; }

  const def = B[b.type], S = E2.state.get();
  const upBlock = E2.state.upgradeBlock(b), repBlock = b.ruined ? E2.state.repairBlock(b) : null;
  const sig = [b.uid, b.level, b.endAt ? 1 : 0, b.ruined ? 1 : 0, upBlock, repBlock, def.produces && b.stored >= 1 ? 1 : 0, b.trip ? 1 : 0, E2.state.freeBuilders()].join('|');
  if (!force && sig === ctxSig) return;
  ctxSig = sig;
  bar.innerHTML = '';
  const info = ctxButton('blue', '<span style="font-size:24px">ℹ️</span>', 'Info', '', () => openInfo(b.uid));

  if (b.endAt) {
    bar.append(info, ctxButton('green', E2.icon('hammer'), 'Finish', '📺 ad', () => finishWithAd(b.uid)));
  } else if (b.ruined) {
    const cost = E2.state.repairCost(b);
    bar.append(info, ctxButton('', '<span style="font-size:24px">✋</span>', 'Move', '', () => E2.base.startMoving(b.uid)), ctxButton('green', E2.icon('hammer'), 'Repair', costHtml(cost), () => repair(b.uid), !!repBlock));
  } else {
    bar.append(info);
    if (b.level >= 1) bar.append(ctxButton('', '<span style="font-size:24px">✋</span>', 'Move', '', () => E2.base.startMoving(b.uid)));
    if (def.produces && b.level >= 1 && b.stored >= 1) bar.append(ctxButton('green', E2.icon(def.produces), 'Collect', '', () => collectOne(b.uid)));
    if (b.type === 'harbor' && b.level >= 1) bar.append(ctxButton('green', '<span style="font-size:24px">🚢</span>', 'Trade', b.trip ? 'at sea' : '', () => openInfo(b.uid)));
    const next = def.levels[b.level];
    if (next) bar.append(ctxButton('', '<span style="font-size:24px">⬆️</span>', 'Upgrade', costHtml(next.cost), () => upgrade(b.uid), !!upBlock));
  }
  bar.classList.remove('hidden');
}

function onSelect(uid) {
  if (sheetMode === 'info' && uid !== infoUid) { sheetMode = null; infoUid = null; sheet().classList.add('hidden'); }
  renderCtx(true);
}

// ---------- Placement bar ----------
let placingType = null, placingMove = false;
function showPlaceBar(type, moving) {
  placingType = type; placingMove = !!moving;
  $('placePop').classList.remove('hidden');
  setPlaceValid(true);
  renderCtx(true);
}
function hidePlaceBar() { $('placePop').classList.add('hidden'); renderCtx(true); }
// why: what blocks the spot ('obstacle', 'land', 'building') or empty when it fits.
const WHY = {
  obstacle: '<span style="color:#ff9b8f">A tree or rock is in the way. Cancel, tap it and remove it first.</span>',
  land: '<span style="color:#ff9b8f">Not enough free land here.</span>',
  coast: '<span style="color:#ff9b8f">A harbor has to touch the sea. Move it to the coast.</span>',
  building: '<span style="color:#ff9b8f">Another building is there.</span>',
};
function setPlaceValid(ok, why) {
  $('placeOk').disabled = !ok;
  const def = B[placingType];
  $('placeInfo').innerHTML = ok ? '' : (WHY[why] || WHY.land);      // only says something when the spot does not work
}

// ---------- Battle log, territories, settings ----------
function showLog() {
  const h = E2.state.get().raid.history.slice().reverse();
  const rows = h.map(r => {
    const c = E2.byId(r.from), ago = E2.fmtTime((Date.now() - r.at) / 1000);
    const what = r.kind === 'attack' ? (r.win ? '⚔ You won' : '⚔ You lost') : (r.win ? '🛡 Repelled' : '💥 Raided');
    return `<div class="stat"><span>${c.name}</span><span>${what} · ${ago} ago</span></div>`;
  }).join('');
  modal({ title: 'Battle log', body: rows || 'No battles yet. Build some towers!', buttons: [], x: true });
}

// Your homeland and every conquered country, each with its own land to build on.
function showTerritories() {
  const S = E2.state.get();
  $('modalBox').innerHTML = `<h3>Territories</h3><div class="body"></div><div class="row"></div>`;
  const body = $('modalBox').querySelector('.body');
  for (const id of E2.state.owned()) {
    const c = E2.byId(id), n = S.land[id].buildings.length;
    const b = document.createElement('button');
    b.className = 'btn'; b.style.cssText = 'width:100%;margin-bottom:6px;text-align:left';
    b.textContent = `${c.name}${id === S.homeland ? ' (home)' : ''} · ${n} buildings${id === S.view ? ' · viewing' : ''}`;
    b.onclick = () => { closeModal(); E2.app.goView(id); };
    body.appendChild(b);
  }
  addModalX();
  $('modal').classList.remove('hidden');
}

function settings() {
  const S = E2.state.get(), c = E2.byId(S.homeland);
  const buttons = [
    { label: '📜 Battle log', onClick: showLog },
    { label: E2.sfx.isMuted() ? '🔇 Sound off' : '🔊 Sound on', onClick: () => { E2.sfx.setMuted(!E2.sfx.isMuted()); toast(E2.sfx.isMuted() ? 'Sound off' : 'Sound on'); } },
  ];
  if (S.colonies.length) buttons.unshift({ label: '🏴 Territories', onClick: showTerritories });
  if (E2.DEBUG) buttons.push({ label: '⚔ Test raid (debug)', onClick: () => E2.raidview.debugTrigger() });
  buttons.push(
    { label: 'Erase save', cls: 'danger', onClick: () => modal({
      title: 'Erase everything?', body: 'This cannot be undone.',
      buttons: [{ label: 'Cancel' }, { label: 'Erase', cls: 'danger', onClick: () => { E2.state.reset(); location.reload(); } }],
    }) },
  );
  modal({
    title: 'Settings',
    body: `Homeland: <b>${c.name}</b> (permanent)<br>Conquered: <b>${S.colonies.length}</b> · Rank: <b>${E2.rankOf(S.colonies.length)}</b>`,
    buttons, x: true,
  });
}

// ---------- Back button ----------
function back() {
  if (raiding()) return true;                               // no leaving a battle
  if (modalOpen()) { closeModal(); return true; }
  if (E2.base && E2.base.isPlacing()) { E2.base.cancelPlacing(); return true; }
  if (sheetOpen()) { closeSheet(); return true; }
  if (E2.base && E2.base.selected()) { E2.base.select(null); return true; }
  return false;
}

// Called by the game clock once per tick.
function tick() { updateHud(); tickInfo(); renderCtx(false); }

E2.ui = {
  init, toast, modal, closeModal, updateHud, setHome, openShop, openInfo, closeSheet, sheetOpen, tickInfo, tick, showTerritories,
  collectOne, announce, afterChange, showPlaceBar, hidePlaceBar, setPlaceValid, back, onSelect, renderCtx,
};
})();
