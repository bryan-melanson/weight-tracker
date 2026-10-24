/* The desktop backend: a thin client for the Python server. Every mutating
   call carries the CSRF header the server requires, and every response is
   unwrapped from the {ok, data} envelope.

   static/js/api.js picks between this and local.js; see there for which runs
   when. */

const CSRF = { 'X-Requested-With': 'weight-tracker' };

async function request(method, path, body) {
  const options = { method, headers: { ...CSRF } };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const response = await fetch(path, options);
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Server returned ${response.status} with an unreadable body.`);
  }
  if (!response.ok || payload.ok === false) {
    const error = new Error(payload.error || `Request failed (${response.status}).`);
    error.field = payload.field || null;
    throw error;
  }
  return payload;
}

const send = async (method, path, body) => (await request(method, path, body)).data;

export const httpApi = {
  getState: () => send('GET', '/api/state'),
  saveSettings: (patch) => send('PUT', '/api/settings', patch),
  saveEntry: (date, patch) => send('PUT', `/api/entries/${encodeURIComponent(date)}`, patch),
  deleteEntry: (date) => send('DELETE', `/api/entries/${encodeURIComponent(date)}`),
  importCsv: (csv) => send('POST', '/api/import.csv', { csv }),
  /* The server sends this one as a text/csv attachment rather than a JSON
     envelope, so it is read as text. Both backends return CSV text and
     neither needs a URL to navigate to. */
  exportCsv: async () => {
    const response = await fetch('/api/export.csv', { headers: { ...CSRF } });
    if (!response.ok) throw new Error(`Could not export (${response.status}).`);
    return response.text();
  },
};
