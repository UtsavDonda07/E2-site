// First-run guide: an original advisor, Mira, talks you through the game in a speech bubble.
// Progress is saved with the game (S.tut). To use your own art, drop a transparent PNG at www/art/advisor.png.
(function () {
'use strict';
const E2 = window.E2;
const $ = id => document.getElementById(id);

// What Mira says, one bubble per step. Written the way she would say it, not as a manual.
const home = () => { const c = E2.byId(E2.state.get().homeland); return { country: c.name, capital: c.capital ? c.capital.name : 'the capital' }; };
const SPEECH = [
  () => `Hello, Emperor! I'm Mira, your advisor. This is ${home().capital}, the capital of ${home().country}, and right now it's all we have: just the headquarters. Don't worry, we'll start small. Open the Shop and build a Gold Mine and an Oil Refinery. If a tree or rock is in the way, just tap it and remove it first.`,
  "Lovely! Once they're running you'll see little coin bubbles above them. Tap one to collect, and tap any building to make it stronger. And a word of warning: our neighbours will raid us soon, so build a few guns and an anti-air from the Defence tab.",
  "When you feel strong enough, build a Barracks from the Military tab. Then press Attack, train some troops, and go after a weak neighbour first. Trust me, it's the smart way to start.",
  "Destroy an enemy headquarters and the whole country becomes ours, with new land to build on. Take ten countries and you'll be the Emperor of Emperors! I'll be right here if you need me.",
];

// Original character (SVG). The mouth is the element with class "mo"; CSS makes it move while she talks.
const MIRA = `<svg viewBox="0 0 120 170" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="skin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6cfa8"/><stop offset="1" stop-color="#e9ab80"/></linearGradient>
    <linearGradient id="coat" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2a4d7e"/><stop offset="1" stop-color="#1a3358"/></linearGradient>
  </defs>
  <path d="M16 170L21 120Q24 103 44 99L76 99Q96 103 99 120L104 170Z" fill="url(#coat)" stroke="#0e1d33" stroke-width="3" stroke-linejoin="round"/>
  <path d="M48 99L60 128L72 99Z" fill="#f4f1ea" stroke="#0e1d33" stroke-width="2.5" stroke-linejoin="round"/>
  <rect x="53" y="84" width="14" height="18" rx="5" fill="#e4a679"/>
  <rect x="24" y="106" width="20" height="8" rx="3" fill="#e5b93c" stroke="#7a5a0e" stroke-width="2"/>
  <rect x="76" y="106" width="20" height="8" rx="3" fill="#e5b93c" stroke="#7a5a0e" stroke-width="2"/>
  <circle cx="60" cy="140" r="3.5" fill="#e5b93c" stroke="#7a5a0e" stroke-width="1.5"/>
  <circle cx="60" cy="154" r="3.5" fill="#e5b93c" stroke="#7a5a0e" stroke-width="1.5"/>
  <path d="M26 64Q22 22 60 20Q98 22 94 64L94 90Q88 96 82 90L82 60L38 60L38 90Q32 96 26 90Z" fill="#3a2416" stroke="#1c110a" stroke-width="2.5" stroke-linejoin="round"/>
  <ellipse cx="60" cy="62" rx="27" ry="30" fill="url(#skin)" stroke="#a8693f" stroke-width="2"/>
  <path d="M34 52Q44 36 60 38Q78 36 86 52Q74 46 60 48Q46 46 34 52Z" fill="#3a2416"/>
  <path d="M30 40Q32 10 60 10Q88 10 90 40Z" fill="#1f3a63" stroke="#0e1d33" stroke-width="2.5" stroke-linejoin="round"/>
  <path d="M26 41Q60 33 94 41L91 48Q60 42 29 48Z" fill="#162c4d" stroke="#0e1d33" stroke-width="2" stroke-linejoin="round"/>
  <circle cx="60" cy="25" r="6" fill="#e5b93c" stroke="#7a5a0e" stroke-width="2"/>
  <ellipse cx="48" cy="64" rx="4.2" ry="5.6" fill="#2a1a12"/><ellipse cx="72" cy="64" rx="4.2" ry="5.6" fill="#2a1a12"/>
  <circle cx="49.5" cy="62" r="1.6" fill="#fff"/><circle cx="73.5" cy="62" r="1.6" fill="#fff"/>
  <path d="M41 55Q48 51 55 55M65 55Q72 51 79 55" stroke="#3a2416" stroke-width="2.4" fill="none" stroke-linecap="round"/>
  <circle cx="40" cy="74" r="5" fill="#f08a7a" opacity=".45"/><circle cx="80" cy="74" r="5" fill="#f08a7a" opacity=".45"/>
  <path d="M60 66Q58 72 61 73" stroke="#b97a52" stroke-width="2" fill="none" stroke-linecap="round"/>
  <path d="M52 79Q60 85 68 79" stroke="#8a3d33" stroke-width="2.6" fill="none" stroke-linecap="round"/>
  <ellipse class="mo" cx="60" cy="80" rx="6" ry="4.5" fill="#7a2b2b" stroke="#4a1a1a" stroke-width="1.5"/>
</svg>`;

let timer = null, typer = null, state = null;      // state = { step, text, shown }

// The advisor picture: art/advisor.webp, else art/advisor.png, else the drawn Mira below.
const PICTURES = ['art/advisor.webp', 'art/advisor.png'];
function portrait() {
  const el = document.querySelector('#tip .adv');
  if (!el) return;
  el.innerHTML = MIRA;
  (function tryNext(i) {
    if (i >= PICTURES.length) return;
    const img = new Image();
    img.onload = () => { el.innerHTML = ''; el.appendChild(img); };
    img.onerror = () => tryNext(i + 1);
    img.src = PICTURES[i];
  })(0);
}

function finishTyping() {
  clearInterval(typer); typer = null;
  const bubble = document.querySelector('#tip .say-text');
  if (bubble && state) bubble.textContent = state.text;
  const adv = document.querySelector('#tip .adv');
  if (adv) adv.classList.remove('talking');
  const btn = document.querySelector('#tip button');
  if (btn) btn.classList.remove('hidden');
}

function say(step) {
  const S = E2.state.get();
  const el = $('tip');
  const line = SPEECH[step];
  state = { step, text: typeof line === 'function' ? line() : line };
  el.innerHTML = `<div class="adv"></div>
    <div class="say"><div class="say-text"></div>
      <button class="btn primary hidden">${step === SPEECH.length - 1 ? 'Got it!' : 'Thanks, Mira'}</button></div>`;
  portrait();
  el.classList.remove('hidden');
  const adv = el.querySelector('.adv'), txt = el.querySelector('.say-text');
  adv.classList.add('talking');
  let i = 0;
  typer = setInterval(() => {
    i += 2;
    txt.textContent = state.text.slice(0, i);
    if (i >= state.text.length) finishTyping();
  }, 28);
  el.onclick = ev => { if (typer && !ev.target.closest('button')) finishTyping(); };     // tap to skip the typing
  el.querySelector('button').onclick = () => {
    el.classList.add('hidden');
    S.tut = step + 1; E2.state.save();
    if (S.tut < SPEECH.length) timer = setTimeout(show, 30000);
  };
}

function show() {
  const S = E2.state.get();
  if (!S || S.tut == null || S.tut >= SPEECH.length) return;
  const busy = $('screenBase').classList.contains('hidden') || E2.raidview.active() || !$('modal').classList.contains('hidden');
  if (busy) { timer = setTimeout(show, 4000); return; }
  say(S.tut);
}

function start() {
  const S = E2.state.get();
  if (!S) return;
  if (S.tut == null) S.tut = 0;
  clearTimeout(timer);
  timer = setTimeout(show, 1500);
}

E2.tutorial = { start };
})();
