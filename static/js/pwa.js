/* Installing the app.

   The service worker exists to make the server-less app open offline, so it is
   registered exactly when that backend is in use. The desktop app skips it:
   the Python server sends Cache-Control: no-store and should always be read
   straight from disk, never from a cached shell. */

import { mode } from './api.js';

/* A worker that has just taken over is serving a newer version than the page
   it inherited, so the page replaces itself rather than run on half of each.

   It waits for the app to be put away first. An update is never worth losing a
   half-typed entry over, and reloading while hidden means the new version is
   simply what is there the next time the app is looked at. Should iOS discard
   the page while it is in the background, nothing is lost either way: the new
   worker is already in charge, so the next launch is the new version too. */
function reloadWhenHidden() {
  const reload = () => {
    if (document.visibilityState !== 'hidden') return;
    document.removeEventListener('visibilitychange', reload);
    window.location.reload();
  };
  if (document.visibilityState === 'hidden') window.location.reload();
  else document.addEventListener('visibilitychange', reload);
}

export function registerServiceWorker() {
  if (mode !== 'local' || !('serviceWorker' in navigator)) return;

  /* Whether a worker was in charge when the page loaded. Without this, the
     very first registration — no controller, then one — would look like an
     update and reload a page that is already perfectly current. */
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) reloadWhenHidden();
  });

  // Registration failing is not worth surfacing: the app still works, it just
  // will not open offline until a later visit succeeds.
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
