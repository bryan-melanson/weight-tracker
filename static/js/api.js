/* Thin API client. Every mutating call carries the CSRF header the server
   requires, and every response is unwrapped from the {ok, data} envelope. */

const CSRF = { 'X-Requested-With': 'weight-tracker' };

async function send(method, path, body) {
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
  return payload.data;
}

export const api = {
  getState: () => send('GET', '/api/state'),
  saveSettings: (patch) => send('PUT', '/api/settings', patch),
  saveEntry: (date, patch) => send('PUT', `/api/entries/${encodeURIComponent(date)}`, patch),
  deleteEntry: (date) => send('DELETE', `/api/entries/${encodeURIComponent(date)}`),
  importCsv: (csv) => send('POST', '/api/import.csv', { csv }),
  exportUrl: () => '/api/export.csv',
};
