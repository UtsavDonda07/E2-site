// Country select: a small dialog with a search / dropdown. The choice becomes the permanent homeland.
(function () {
'use strict';
const E2 = window.E2;
const $ = id => document.getElementById(id);

let sel = null, onChoose = null;

function renderList() {
  const q = $('search').value.trim().toLowerCase();
  const list = E2.COUNTRIES.filter(c => c.playable && c.name.toLowerCase().includes(q));
  $('countryList').innerHTML = list.length
    ? list.map(c => `<li data-id="${c.id}" class="${sel && sel.id === c.id ? 'sel' : ''}"><span class="nm">${c.name}</span></li>`).join('')
    : '<li class="none">No country found</li>';
}
function openList() { renderList(); $('countryList').classList.remove('hidden'); }
function closeList() { $('countryList').classList.add('hidden'); }

function renderButton() {
  const b = $('btnChoose');
  b.disabled = !sel;
}

function select(c) {
  sel = c;
  $('search').value = c.name;
  closeList();
  renderButton();
  $('search').blur();
}

function confirmChoice() {
  const c = sel;
  E2.ui.modal({
    title: `Rule ${c.name}?`,
    body: `<b>${c.name}</b> becomes your homeland.<br>This choice is <b>permanent</b>.`,
    buttons: [{ label: 'Go back' }, { label: 'Rule!', cls: 'primary', onClick: () => onChoose && onChoose(c.id) }],
  });
}

function init(cb) {
  onChoose = cb;
  const search = $('search');
  search.addEventListener('focus', () => { search.select(); openList(); });
  search.addEventListener('click', openList);                                            // tapping an already-focused field reopens the list
  search.addEventListener('input', () => { sel = null; renderButton(); openList(); });   // typing starts a new search
  $('countryList').addEventListener('click', ev => {
    const li = ev.target.closest('li[data-id]');
    if (li) select(E2.byId(li.dataset.id));
  });
  document.addEventListener('pointerdown', ev => { if (!ev.target.closest('.dd')) closeList(); });
  $('btnChoose').onclick = () => { if (sel) confirmChoice(); };
}

function show() { $('screenSelect').classList.remove('hidden'); }
function hide() { $('screenSelect').classList.add('hidden'); }

E2.select = { init, show, hide };
})();
