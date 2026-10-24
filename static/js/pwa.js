/* Installing the app.

   The service worker exists to make the server-less app open offline, so it is
   registered exactly when that backend is in use. The desktop app skips it:
   the Python server sends Cache-Control: no-store and should always be read
   straight from disk, never from a cached shell. */

import { mode } from './api.js';

export function registerServiceWorker() {
  if (mode !== 'local' || !('serviceWorker' in navigator)) return;
  // Registration failing is not worth surfacing: the app still works, it just
  // will not open offline until a later visit succeeds.
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
