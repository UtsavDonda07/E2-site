// Bridge to the Flutter WebView wrapper. In a plain browser everything is simulated.
// Flutter side: register a handler named "e2" (flutter_inappwebview) that receives {type, ...}.
// Flutter calls window.E2.onBack() for the Android back button; it returns true if handled.
(function () {
'use strict';
const E2 = window.E2;

function native(type, payload) {
  const w = window.flutter_inappwebview;
  if (w && typeof w.callHandler === 'function') return w.callHandler('e2', Object.assign({ type }, payload));
  return null;
}

E2.bridge = {
  isNative: () => !!(window.flutter_inappwebview && window.flutter_inappwebview.callHandler),

  // Resolves true when the player earned the reward.
  rewardedAd(reason) {
    const p = native('rewardedAd', { reason });
    if (p) return Promise.resolve(p).then(r => !!r).catch(() => false);
    E2.ui && E2.ui.toast('📺 Ad watched (simulated in browser)');
    return new Promise(res => setTimeout(() => res(true), 700));
  },

  // Tell Flutter to schedule a local notification (e.g. "Your Gold Mine is ready").
  notifyAt(ts, title, body) { native('notifyAt', { ts, title, body }); },

  // Fire-and-forget analytics / lifecycle events.
  event(name, data) { native('event', { name, data }); },
};
})();
