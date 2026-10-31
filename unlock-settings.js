/* Me → "Opening the app": Face ID / fingerprint, PIN, or just open. Works with the Auth engine in index.html. */
(function () {
  'use strict';
  var card = document.getElementById('unlockCard');
  if (!card || typeof Auth === 'undefined') return;
  var note = document.getElementById('unlockNote');
  var bioBtn = card.querySelector('[data-unlock="bio"]');

  function user() { return Auth.getUsers()[0]; }
  function say(text) { note.textContent = text || ''; note.hidden = !text; }
  function current() {
    var m = Auth.getUnlock(), u = user();
    if (m === 'bio' && !(u && u.credentialId)) m = 'pin';
    return m;
  }
  function mark() {
    var m = current();
    card.querySelectorAll('[data-unlock]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.unlock === m)); });
  }

  // Only offer Face ID / fingerprint when this phone can do it.
  function checkBio() {
    var P = window.PublicKeyCredential;
    if (!P || !P.isUserVerifyingPlatformAuthenticatorAvailable) return;
    P.isUserVerifyingPlatformAuthenticatorAvailable().then(function (ok) { if (ok) bioBtn.hidden = false; }).catch(function () {});
  }

  card.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-unlock]');
    if (!b) return;
    var want = b.dataset.unlock, u = user();
    if (!u) return;
    if (want === 'bio') {
      if (u.credentialId) { Auth.setUnlock('bio'); mark(); say('Face ID or fingerprint is on.'); return; }
      say('Your phone will ask you to look at it or touch the sensor.');
      setupBiometric(u).then(function (ok) {
        if (ok) { Auth.setUnlock('bio'); say('Done. Next time, ElderXonnect opens with Face ID or fingerprint.'); }
        else say('Face ID was not set up. You can try again, or keep using your PIN.');
        mark();
      });
      return;
    }
    if (want === 'none') {
      Auth.setUnlock('none'); Auth.setSession(u);
      say('ElderXonnect will open without asking. Make sure the phone itself is locked.');
    } else {
      Auth.setUnlock('pin'); Auth.setSession(u);
      say('ElderXonnect will ask for your PIN after 12 hours of not using it.');
    }
    mark();
  });

  checkBio();
  mark();
})();
