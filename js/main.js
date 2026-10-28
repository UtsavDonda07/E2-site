// Boot: pick the right screen, run the game clock, autosave. Also the small screen router (E2.app).
(function () {
'use strict';
const E2 = window.E2;
const $ = id => document.getElementById(id);

// ---------- Screen router ----------
function showBase() {
  E2.select.hide();
  E2.worldmap.hide();
  E2.ui.setHome();
  E2.ui.updateHud();
  E2.base.enter();
  const done = E2.state.tick(Date.now());           // catch up on time spent away
  if (done.length) E2.ui.announce(done);
  E2.ui.updateHud();
}

function showWorld(openArmy) {
  E2.ui.closeSheet();
  E2.base.leave();
  E2.worldmap.show(openArmy);
}

function goView(id) {
  const S = E2.state.get();
  if (id !== S.view) E2.state.switchView(id);
  showBase();
  if (id !== S.homeland) E2.ui.toast(`${E2.byId(id).name}: your territory`);
}

E2.app = { showBase, showWorld, goView };

// ---------- Game clock ----------
function clock() {
  if (!E2.state.get()) return;
  const done = E2.state.tick(Date.now());
  if (done.length) { E2.ui.announce(done); E2.state.save(); }
  E2.raidview.checkStrike(Date.now());
  if ($('screenBase').classList.contains('hidden')) return;
  E2.ui.tick();
  E2.raidview.check(Date.now());
}

function boot() {
  E2.ui.init();
  E2.raidview.init();
  E2.worldmap.init();
  E2.select.init(countryId => {
    E2.state.create(countryId);
    E2.bridge.event('homeland_chosen', { country: countryId });
    showBase();
    E2.tutorial && E2.tutorial.start();
  });

  if (E2.state.load()) { showBase(); E2.tutorial.start(); }
  else E2.select.show();

  setInterval(clock, 500);
  setInterval(() => { if (E2.state.get() && !E2.state.inEnemyView()) E2.state.save(); }, 5000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (E2.state.get()) E2.state.save(); }
    else clock();
  });
  window.addEventListener('pagehide', () => { if (E2.state.get()) E2.state.save(); });

  E2.onBack = () => {
    if (E2.worldmap.visible()) { E2.worldmap.hide(); showBase(); return true; }
    return E2.ui.back();
  };
}

boot();
})();
