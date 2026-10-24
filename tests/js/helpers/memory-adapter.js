/* An in-memory stand-in for static/js/backend/idb.js, so the store's CRUD and
   merge semantics are testable under `node --test` with no IndexedDB and no
   dependencies. It holds the same contract: plain records in, plain records
   out, entries listed in ascending date order. */

export function memoryAdapter() {
  let settings = null;
  const entries = new Map();

  return {
    async getSettings() {
      return settings ? { ...settings } : null;
    },
    async putSettings(record) {
      settings = { ...record };
    },
    async getEntry(date) {
      const entry = entries.get(date);
      return entry ? { ...entry } : null;
    },
    async listEntries(from = null, to = null) {
      return [...entries.keys()]
        .filter((date) => (!from || date >= from) && (!to || date <= to))
        .sort()
        .map((date) => ({ ...entries.get(date) }));
    },
    async putEntry(record) {
      entries.set(record.date, { ...record });
    },
    async deleteEntry(date) {
      return entries.delete(date);
    },
  };
}
