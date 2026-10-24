/* Which backend the app talks to.

   On loopback the page was served by the Python server, so it uses that and
   its SQLite file. Anywhere else — the installed web app on a phone, served
   from a static host with no server behind it — it stores data on the device
   in IndexedDB.

   The two expose the same methods, so nothing downstream of here knows or
   cares which one it is holding. */

import { httpApi } from './backend/http.js';
import { localApi } from './backend/local.js';

/* Mirrors config.ALLOWED_HOST_NAMES: the only hosts the Python server will
   answer to, so the only hosts that can have served this page. */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/* `?backend=local` runs the on-device backend against a plain static server on
   localhost, which is the only way to exercise it — and its service worker —
   without deploying. Deliberately not remembered: the installed app's
   start_url carries no query, so this can never leak into normal use, and a
   reload of the desktop app is always back on the server. */
function requested() {
  const value = new URLSearchParams(window.location.search).get('backend');
  return value === 'local' || value === 'http' ? value : null;
}

export const mode = requested() || (LOOPBACK.has(window.location.hostname) ? 'http' : 'local');

export const api = mode === 'http' ? httpApi : localApi;
