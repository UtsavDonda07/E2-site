// Country select screen: world map + searchable list. The choice becomes the permanent homeland.
(function () {
'use strict';
const E2 = window.E2;
const $ = id => document.getElementById(id);

const canvas = $('worldCanvas'), ctx = canvas.getContext('2d');
let view = null, sel = null, onChoose = null;
let order = [];                 // draw order: big countries first so small ones stay tappable
const paths = new Map();

function layout() {
  const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  if (!r.width || !r.height) return;
  canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
  const s = Math.min(r.width / 360, r.height / 142);       // equirectangular, lat 84 .. -58
  view = { dpr, s, ox: (r.width - 360 * s) / 2, oy: (r.height - 142 * s) / 2, w: r.width, h: r.height };
  paths.clear();
  for (const c of order) {
    const p = new Path2D();
    for (const ring of c.outline) {
      for (let i = 0; i < ring.length; i += 2) {
        const x = view.ox + (ring[i] + 180) * s, y = view.oy + (84 - ring[i + 1]) * s;
        i ? p.lineTo(x, y) : p.moveTo(x, y);
      }
      p.closePath();
    }
    paths.set(c.id, p);
  }
  draw();
}

function draw() {
  if (!view) return;
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.clearRect(0, 0, view.w, view.h);
  ctx.lineWidth = 0.5; ctx.strokeStyle = '#0a1b2e';
  for (const c of order) {
    ctx.fillStyle = sel && c.id === sel.id ? '#e0b23c' : '#35506b';
    ctx.fill(paths.get(c.id));
    ctx.stroke(paths.get(c.id));
  }
}

function pick(ev) {
  const r = canvas.getBoundingClientRect();
  const px = (ev.clientX - r.left) * view.dpr, py = (ev.clientY - r.top) * view.dpr;
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);          // the paths are in CSS pixels, the test point in device pixels
  for (let i = order.length - 1; i >= 0; i--) {
    if (ctx.isPointInPath(paths.get(order[i].id), px, py)) return order[i];
  }
  return null;
}

function select(c, scroll) {
  sel = c;
  draw();
  renderCard();
  document.querySelectorAll('#countryList li').forEach(li => li.classList.toggle('sel', li.dataset.id === c.id));
  if (scroll) {
    const li = document.querySelector(`#countryList li[data-id="${c.id}"]`);
    if (li) li.scrollIntoView({ block: 'nearest' });
  }
}

function renderCard() {
  const card = $('pickCard');
  if (!sel) { card.textContent = 'Tap a country on the map, or search below.'; return; }
  const nb = sel.land.map(id => E2.byId(id)).filter(Boolean).map(c => c.name);
  card.innerHTML = `<div class="pn">${sel.name}</div>
    <div><span class="tag">⚡ ${sel.power}/10 · ${E2.powerLabel(sel.power)}</span> · ${E2.popText(sel.pop)} people</div>
    <div>Neighbours: ${nb.length ? nb.join(', ') : 'none by land (island nation)'}</div>
    <button class="btn primary choose" id="btnChoose">Rule ${sel.name}</button>`;
  $('btnChoose').onclick = confirmChoice;
}

function confirmChoice() {
  const c = sel;
  E2.ui.modal({
    title: `Rule ${c.name}?`,
    body: `<b>${c.name}</b> becomes your homeland. This choice is <b>permanent</b>: you will build your empire on its land.`,
    buttons: [{ label: 'Go back' }, { label: 'Confirm', cls: 'primary', onClick: () => onChoose && onChoose(c.id) }],
  });
}

function renderList() {
  const q = $('search').value.trim().toLowerCase();
  const list = E2.COUNTRIES.filter(c => c.playable && c.name.toLowerCase().includes(q));
  $('countryList').innerHTML = list.map(c =>
    `<li data-id="${c.id}" class="${sel && sel.id === c.id ? 'sel' : ''}"><span class="nm">${c.name}</span><span class="pw">⚡ ${c.power}</span></li>`
  ).join('');
}

function init(cb) {
  onChoose = cb;
  order = E2.COUNTRIES.slice().sort((a, b) => E2.areaOf(b) - E2.areaOf(a));
  canvas.addEventListener('click', ev => { if (!view) return; const c = pick(ev); if (c && c.playable) select(c, true); });
  $('countryList').addEventListener('click', ev => {
    const li = ev.target.closest('li');
    if (li) select(E2.byId(li.dataset.id), false);
  });
  $('search').addEventListener('input', renderList);
  window.addEventListener('resize', layout);
  renderList();
}

function show() {
  $('screenSelect').classList.remove('hidden');
  requestAnimationFrame(layout);
}
function hide() { $('screenSelect').classList.add('hidden'); }

E2.select = { init, show, hide };
})();
