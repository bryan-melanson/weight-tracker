/* The on-device backend: the same API surface static/js/app.js already calls,
   served from IndexedDB instead of the Python server. This is what runs when
   the app is installed to a phone's home screen, with no server to talk to.

   It plays the part tracker/api.py plays on the desktop — validate, then
   store — minus the HTTP envelope, since there is no wire here. */

import { readImport, writeCsv } from './csv.js';
import { openIdb } from './idb.js';
import { createStore } from './store.js';
import { ValidationError, validateDate, validateEntryPatch, validateSettingsPatch } from './validate.js';

export function createLocalApi(adapter) {
  const store = createStore(adapter);

  return {
    async getState() {
      const [settings, entries] = await Promise.all([store.getSettings(), store.listEntries()]);
      return { settings, entries };
    },

    async saveSettings(patch) {
      return store.updateSettings(validateSettingsPatch(patch));
    },

    async saveEntry(rawDate, patch) {
      const date = validateDate(rawDate);
      return store.upsertEntry(date, validateEntryPatch(patch));
    },

    async deleteEntry(rawDate) {
      const date = validateDate(rawDate);
      if (!(await store.deleteEntry(date))) {
        throw new ValidationError(`No entry recorded for ${date}.`);
      }
      return { date, deleted: true };
    },

    /* The whole file is validated before any of it is written, so a bad row
       late in the file cannot leave a half-applied import behind. */
    async importCsv(text) {
      const staged = readImport(text);
      for (const { date, patch } of staged) {
        await store.upsertEntry(date, patch);
      }
      return { imported: staged.length };
    },

    async exportCsv() {
      return writeCsv(await store.listEntries());
    },
  };
}

export const localApi = createLocalApi(openIdb());
