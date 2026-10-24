/* The repository for the browser backend — the port of tracker/store.py.
   A thin layer: callers pass already-validated patches and get plain objects
   back. No validation and no transport concerns live here.

   Persistence arrives as an adapter (static/js/backend/idb.js in the browser,
   an in-memory stand-in under test), so these semantics are testable without
   IndexedDB. */

import { DEFAULT_SETTINGS } from './limits.js';
import { ENTRY_COLUMNS, SETTINGS_COLUMNS } from './validate.js';

const now = () => `${new Date().toISOString().slice(0, 19)}+00:00`;

/* A day absent from the patch is null, matching the NULL a fresh SQLite row
   carries for a column the insert never named. */
const blankEntry = (date) => ({
  date,
  ...Object.fromEntries(ENTRY_COLUMNS.map((column) => [column, null])),
});

export function createStore(adapter) {
  /* Write the defaults once. An existing record is left exactly as it is. */
  async function settingsRecord() {
    const stored = await adapter.getSettings();
    if (stored) return stored;
    const seeded = { ...DEFAULT_SETTINGS };
    await adapter.putSettings(seeded);
    return seeded;
  }

  return {
    async getSettings() {
      const record = await settingsRecord();
      return Object.fromEntries(SETTINGS_COLUMNS.map((column) => [column, record[column] ?? null]));
    },

    async updateSettings(patch) {
      const current = await settingsRecord();
      const changes = Object.fromEntries(
        SETTINGS_COLUMNS.filter((column) => column in patch).map((column) => [column, patch[column]]),
      );
      await adapter.putSettings({ ...current, ...changes });
      return this.getSettings();
    },

    async getEntry(date) {
      return adapter.getEntry(date);
    },

    async listEntries(dateFrom = null, dateTo = null) {
      return adapter.listEntries(dateFrom, dateTo);
    },

    /* Create or merge a day's entry. Fields absent from the patch are kept. */
    async upsertEntry(date, patch) {
      const existing = (await adapter.getEntry(date)) || blankEntry(date);
      const changes = Object.fromEntries(
        ENTRY_COLUMNS.filter((column) => column in patch).map((column) => [column, patch[column]]),
      );
      const record = { ...existing, ...changes, date, updated_at: now() };
      await adapter.putEntry(record);
      return record;
    },

    async deleteEntry(date) {
      return adapter.deleteEntry(date);
    },
  };
}
