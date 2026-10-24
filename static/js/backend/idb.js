/* IndexedDB plumbing for the on-device backend. Deliberately thin: it moves
   records in and out and nothing more, so the behaviour worth testing lives in
   store.js behind an adapter this one implements.

   The database is opened lazily on first use, never at import time, so this
   module is safe to load where there is no IndexedDB at all (the Python-served
   desktop app, and the Node test runner). */

const DB_NAME = 'weight-tracker';
const DB_VERSION = 1;
const SETTINGS = 'settings';
const ENTRIES = 'entries';
const SETTINGS_KEY = 1;

const promisify = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

/* ISO dates sort lexicographically, which is also chronologically, so a key
   range over the date keys reproduces the server's
   "WHERE date >= ? AND date <= ? ORDER BY date ASC" exactly. */
function dateRange(from, to) {
  if (from && to) return IDBKeyRange.bound(from, to);
  if (from) return IDBKeyRange.lowerBound(from);
  if (to) return IDBKeyRange.upperBound(to);
  return null;
}

export function openIdb() {
  let opening = null;

  function database() {
    if (!opening) {
      opening = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(SETTINGS)) db.createObjectStore(SETTINGS, { keyPath: 'id' });
          if (!db.objectStoreNames.contains(ENTRIES)) db.createObjectStore(ENTRIES, { keyPath: 'date' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('Another tab is holding the database open.'));
      }).catch((error) => {
        opening = null; // let a later call retry rather than cache the failure
        throw error;
      });
    }
    return opening;
  }

  async function withStore(name, mode, work) {
    const db = await database();
    const transaction = db.transaction(name, mode);
    const result = await work(transaction.objectStore(name));
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    return result;
  }

  return {
    async getSettings() {
      const record = await withStore(SETTINGS, 'readonly', (store) => promisify(store.get(SETTINGS_KEY)));
      if (!record) return null;
      const { id, ...settings } = record;
      return settings;
    },

    async putSettings(record) {
      await withStore(SETTINGS, 'readwrite', (store) =>
        promisify(store.put({ ...record, id: SETTINGS_KEY })),
      );
    },

    async getEntry(date) {
      return (await withStore(ENTRIES, 'readonly', (store) => promisify(store.get(date)))) || null;
    },

    async listEntries(from = null, to = null) {
      const range = dateRange(from, to);
      return withStore(ENTRIES, 'readonly', (store) => promisify(store.getAll(range)));
    },

    async putEntry(record) {
      await withStore(ENTRIES, 'readwrite', (store) => promisify(store.put(record)));
    },

    /* Reports whether there was an entry to remove, like DELETE's rowcount.
       The read and the delete share one transaction, so the answer cannot be
       made stale by a write from another tab in between. */
    async deleteEntry(date) {
      return withStore(ENTRIES, 'readwrite', async (store) => {
        const existing = await promisify(store.get(date));
        if (!existing) return false;
        await promisify(store.delete(date));
        return true;
      });
    },
  };
}
