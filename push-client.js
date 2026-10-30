/* "Tell me when someone hasn't checked in" button for the circle page. Talks to the browser's push service
   and saves this device's address in the user's own push_subscriptions row. Sends nothing by itself. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);

  function keyToBytes(b64) {
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  }
  const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  async function currentSub() {
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
  }

  function setText(msg, kind) { const el = $('alertsStatus'); el.textContent = msg; el.className = 'status ' + (kind || 'unknown'); }

  async function turnOn(client) {
    const key = window.EXC_PUSH_PUBLIC_KEY;
    if (!key) return setText('Alerts are not switched on yet. Ask Ben to finish setup.');
    if (Notification.permission === 'denied') return setText('Notifications are blocked for this site in your phone settings.', 'warn');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return setText('Alerts stay off because notifications were not allowed.', 'warn');
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) ||
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(key) }));
    const j = sub.toJSON();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const { error } = await client.from('push_subscriptions').upsert(
      { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, tz }, { onConflict: 'endpoint' });
    if (error) return setText('Could not save this phone: ' + error.message, 'warn');
    setText('Alerts are on for this device.', 'ok'); $('alertsBtn').textContent = 'Turn alerts off';
  }

  async function turnOff(client) {
    const sub = await currentSub();
    if (sub) { await client.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe(); }
    setText('Alerts are off for this device.'); $('alertsBtn').textContent = 'Turn on alerts';
  }

  window.initPushCard = async function (client) {
    const card = $('alertsCard'); if (!card) return;
    if (!supported()) { card.classList.remove('hidden'); setText('This browser can’t show alerts. On iPhone, add the app to the Home Screen first.'); $('alertsBtn').classList.add('hidden'); return; }
    card.classList.remove('hidden');
    if (!window.EXC_PUSH_PUBLIC_KEY) { setText('Alerts are not switched on yet.'); $('alertsBtn').classList.add('hidden'); return; }
    const on = !!(await currentSub()) && Notification.permission === 'granted';
    setText(on ? 'Alerts are on for this device.' : 'Get a nudge if someone hasn’t checked in by 11am.', on ? 'ok' : 'unknown');
    $('alertsBtn').textContent = on ? 'Turn alerts off' : 'Turn on alerts';
    $('alertsBtn').onclick = async () => {
      $('alertsBtn').disabled = true;
      try { (await currentSub()) && Notification.permission === 'granted' ? await turnOff(client) : await turnOn(client); }
      catch (e) { setText('Something went wrong: ' + (e.message || e), 'warn'); }
      $('alertsBtn').disabled = false;
    };
  };
})();
