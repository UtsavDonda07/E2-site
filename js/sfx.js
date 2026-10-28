// Tiny synthesized sound effects (no audio files). Mute is remembered on this device.
(function () {
'use strict';
const E2 = window.E2;
const KEY = 'e2.mute';
let ctx = null, muted = false, lastAt = {};
try { muted = localStorage.getItem(KEY) === '1'; } catch (e) { /* storage blocked */ }

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch (e) { return null; }
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// notes: [freq Hz, start s, length s, volume, wave]
const SOUNDS = {
  tap: [[520, 0, 0.05, 0.08, 'square']],
  collect: [[660, 0, 0.07, 0.12, 'triangle'], [880, 0.07, 0.09, 0.12, 'triangle'], [1180, 0.15, 0.12, 0.1, 'triangle']],
  build: [[180, 0, 0.09, 0.2, 'square'], [140, 0.1, 0.12, 0.2, 'square']],
  boom: [[90, 0, 0.25, 0.25, 'sawtooth'], [55, 0.05, 0.3, 0.2, 'sawtooth']],
  win: [[523, 0, 0.14, 0.14, 'triangle'], [659, 0.14, 0.14, 0.14, 'triangle'], [784, 0.28, 0.14, 0.14, 'triangle'], [1046, 0.42, 0.3, 0.14, 'triangle']],
  lose: [[392, 0, 0.2, 0.14, 'sawtooth'], [330, 0.2, 0.2, 0.14, 'sawtooth'], [262, 0.4, 0.4, 0.14, 'sawtooth']],
};

function play(name) {
  if (muted) return;
  const now = performance.now();
  if (now - (lastAt[name] || 0) < 90) return;               // no machine-gun repeats
  lastAt[name] = now;
  const a = audio(), notes = SOUNDS[name];
  if (!a || !notes) return;
  const t0 = a.currentTime;
  for (const [f, s, d, v, w] of notes) {
    const o = a.createOscillator(), g = a.createGain();
    o.type = w; o.frequency.value = f;
    g.gain.setValueAtTime(v, t0 + s); g.gain.exponentialRampToValueAtTime(0.001, t0 + s + d);
    o.connect(g); g.connect(a.destination);
    o.start(t0 + s); o.stop(t0 + s + d + 0.02);
  }
}

function setMuted(m) {
  muted = !!m;
  try { localStorage.setItem(KEY, muted ? '1' : '0'); } catch (e) { /* storage blocked */ }
}

// A click on any button makes a soft tap (this also unlocks audio on the first touch).
document.addEventListener('click', ev => { if (ev.target.closest && ev.target.closest('button')) play('tap'); }, true);

E2.sfx = { play, setMuted, isMuted: () => muted };
})();
