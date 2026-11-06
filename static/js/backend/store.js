/* The repository for the browser backend — the port of tracker/store.py.
   A thin layer: callers pass already-validated patches and get plain objects
   back. No validation and no transport concerns live here.

   Persistence arrives as an adapter (static/js/backend/idb.js in the browser,
   an in-memory stand-in under test), so these semantics are testable without
   IndexedDB. */

import { DEFAULT_SETTINGS } from './limits.js';
import { ENTRY_COLUMNS, SETTINGS_COLUMNS, foodTotal } from './validate.js';

const now = () => `${new Date().toISOString().slice(0, 19)}+00:00`;

/* A day absent from the patch is null, matching the NULL a fresh SQLite row
   carries for a column the insert never named. */
const blankEntry = (date) => ({
  date,
  ...Object.fromEntries(ENTRY_COLUMNS.map((column) => [column, null])),
});

/* Keep one rule, whichever field the patch touches: a day with a food log has
   the log's total as its calories — the port of Store._with_food_total.

   Setting foods sets calories. Setting calories alone on a day that has foods
   is overruled by them. Clearing the log clears the total it had written,
   unless the same patch supplies a number of its own. */
function withFoodTotal(existing, patch) {
  if (!('foods' in patch) && !('calories' in patch)) return patch;
  const next = { ...patch };
  const hadFoods = Boolean(existing && existing.foods && existing.foods.length);
  if ('foods' in next) {
    next.foods = next.foods && next.foods.length ? next.foods : null; // an empty log is no log
    if (next.foods) next.calories = foodTotal(next.foods);
    else if (!('calories' in next) && hadFoods) next.calories = null;
  } else if (hadFoods) {
    next.calories = foodTotal(existing.foods);
  }
  return next;
}

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
      const stored = await adapter.getEntry(date);
      const existing = stored || blankEntry(date);
      const merged = withFoodTotal(stored, patch);
      const changes = Object.fromEntries(
        ENTRY_COLUMNS.filter((column) => column in merged).map((column) => [column, merged[column]]),
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
