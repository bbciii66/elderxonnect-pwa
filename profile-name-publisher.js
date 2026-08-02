/* Obsolete troubleshooting control removed. Profile sharing is automatic. */
(() => {
  'use strict';

  function removeControl() {
    document.getElementById('publishCaregiverNameCard')?.remove();
  }

  function boot() {
    removeControl();
    new MutationObserver(removeControl).observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
