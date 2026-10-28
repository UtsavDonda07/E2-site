// Loading screen: shows until the game's pictures are ready (at least a moment, so it never just flashes).
(function () {
'use strict';
const el = document.getElementById('loading');
if (!el) return;
const fill = document.getElementById('ldFill'), tipEl = document.getElementById('ldTip');
const MIN_MS = 1400, MAX_MS = 9000, t0 = performance.now();

const TIPS = [
  'Build a Barracks to house your troops.',
  'Gold Mines and Oil Refineries fill up while you are away. Tap to collect.',
  'Towers fire on their own. Use an airstrike when a raid hits.',
  'Conquer 10 countries to become Emperor of Emperors.',
  'A Research Lab unlocks tanks, jets and missiles.',
  'Upgrade your Command HQ to unlock higher building levels.',
  'Your Vault protects what you earn from raiders.',
  'Ships from your Harbor sell oil and steel abroad for gold.',
];
tipEl.textContent = TIPS[Math.floor(Math.random() * TIPS.length)];

// Pictures to wait for: the building sprites plus the splash art and the advisor.
const urls = ['art/advisor.webp'];
for (const s of Object.values(window.E2_SPRITES || {})) if (s && s.src) urls.push(s.src);
let done = 0;
const total = urls.length;
function tick() { done++; }
for (const u of urls) { const im = new Image(); im.onload = im.onerror = tick; im.src = u; }

let shown = 0, closing = false;
function close() {
  if (closing) return;
  closing = true;
  fill.style.width = '100%';
  el.classList.add('out');
  setTimeout(() => el.remove(), 450);
}
setTimeout(close, MAX_MS + 500);                                   // safety net if animation frames are throttled
function frame(now) {
  const real = total ? done / total : 1, elapsed = now - t0;
  const target = Math.min(real, elapsed / MIN_MS);                 // never faster than the minimum time
  shown += (target - shown) * 0.18;
  fill.style.width = Math.round(Math.max(4, shown * 100)) + '%';
  if (!closing && ((real >= 1 && elapsed >= MIN_MS && shown > 0.97) || elapsed > MAX_MS)) { close(); return; }
  if (!closing) requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
})();
