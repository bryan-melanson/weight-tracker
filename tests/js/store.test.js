import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULT_SETTINGS } from '../../static/js/backend/limits.js';
import { ValidationError } from '../../static/js/backend/validate.js';
import { createStore } from '../../static/js/backend/store.js';
import { createLocalApi } from '../../static/js/backend/local.js';
import { memoryAdapter } from './helpers/memory-adapter.js';

/* Mirrors tests/test_store.py and the routing cases in tests/test_api.py: the
   IndexedDB backend has to behave like the SQLite one it replaces. */

const newStore = () => createStore(memoryAdapter());
const newApi = () => createLocalApi(memoryAdapter());

const rejects = async (promise, pattern) => {
  let error = null;
  try {
    await promise;
  } catch (caught) {
    error = caught;
  }
  assert.ok(error instanceof ValidationError, `expected a ValidationError, got ${error}`);
  if (pattern) assert.match(error.message, pattern);
  return error;
};

describe('settings', () => {
  it('seeds the defaults on first read', async () => {
    assert.deepEqual(await newStore().getSettings(), { ...DEFAULT_SETTINGS });
  });

  it('leaves an existing record alone', async () => {
    const store = newStore();
    await store.updateSettings({ default_calorie_target: 1800 });
    assert.equal((await store.getSettings()).default_calorie_target, 1800);
  });

  it('applies only the fields in the patch', async () => {
    const store = newStore();
    const settings = await store.updateSettings({ unit: 'kg' });
    assert.equal(settings.unit, 'kg');
    assert.equal(settings.default_calorie_target, DEFAULT_SETTINGS.default_calorie_target);
  });

  it('returns the whole record after an update', async () => {
    const settings = await newStore().updateSettings({ goal_weight_kg: 75 });
    assert.deepEqual(Object.keys(settings).sort(), Object.keys(DEFAULT_SETTINGS).sort());
  });

  it('stores a weekday target', async () => {
    const settings = await newStore().updateSettings({ calorie_target_mon: 2100 });
    assert.equal(settings.calorie_target_mon, 2100);
    assert.equal(settings.calorie_target_tue, null);
  });

  it('clears a value back to null', async () => {
    const store = newStore();
    await store.updateSettings({ goal_weight_kg: 75 });
    assert.equal((await store.updateSettings({ goal_weight_kg: null })).goal_weight_kg, null);
  });

  it('ignores an empty patch', async () => {
    assert.deepEqual(await newStore().updateSettings({}), { ...DEFAULT_SETTINGS });
  });
});

describe('entries', () => {
  it('returns null for a day with nothing logged', async () => {
    assert.equal(await newStore().getEntry('2026-10-01'), null);
  });

  it('creates an entry and fills the rest with null', async () => {
    const entry = await newStore().upsertEntry('2026-10-01', { weight_kg: 80.5 });
    assert.equal(entry.date, '2026-10-01');
    assert.equal(entry.weight_kg, 80.5);
    assert.equal(entry.calories, null);
    assert.equal(entry.calories_burned, null);
    assert.equal(entry.calorie_target, null);
    assert.equal(entry.note, null);
    assert.ok(entry.updated_at);
  });

  it('merges a second patch into the same day', async () => {
    const store = newStore();
    await store.upsertEntry('2026-10-01', { weight_kg: 80.5 });
    const entry = await store.upsertEntry('2026-10-01', { calories: 2000 });
    assert.equal(entry.weight_kg, 80.5, 'the morning weigh-in survives the evening calorie log');
    assert.equal(entry.calories, 2000);
  });

  it('overwrites a field named again', async () => {
    const store = newStore();
    await store.upsertEntry('2026-10-01', { calories: 2000 });
    assert.equal((await store.upsertEntry('2026-10-01', { calories: 1900 })).calories, 1900);
  });

  it('clears a field set to null', async () => {
    const store = newStore();
    await store.upsertEntry('2026-10-01', { calories: 2000 });
    assert.equal((await store.upsertEntry('2026-10-01', { calories: null })).calories, null);
  });

  it('moves updated_at forward on a change', async () => {
    const store = newStore();
    const first = await store.upsertEntry('2026-10-01', { calories: 2000 });
    const second = await store.upsertEntry('2026-10-01', { calories: 2100 });
    assert.ok(second.updated_at >= first.updated_at);
  });

  it('lists entries in ascending date order', async () => {
    const store = newStore();
    for (const date of ['2026-10-03', '2026-10-01', '2026-10-02']) {
      await store.upsertEntry(date, { calories: 2000 });
    }
    assert.deepEqual((await store.listEntries()).map((e) => e.date), ['2026-10-01', '2026-10-02', '2026-10-03']);
  });

  it('filters a list by range, inclusive at both ends', async () => {
    const store = newStore();
    for (const date of ['2026-09-30', '2026-10-01', '2026-10-05', '2026-10-06']) {
      await store.upsertEntry(date, { calories: 2000 });
    }
    const dates = (await store.listEntries('2026-10-01', '2026-10-05')).map((e) => e.date);
    assert.deepEqual(dates, ['2026-10-01', '2026-10-05']);
  });

  it('deletes an entry and reports whether there was one', async () => {
    const store = newStore();
    await store.upsertEntry('2026-10-01', { calories: 2000 });
    assert.equal(await store.deleteEntry('2026-10-01'), true);
    assert.equal(await store.deleteEntry('2026-10-01'), false);
    assert.equal(await store.getEntry('2026-10-01'), null);
  });
});

describe('local api', () => {
  it('returns settings and entries as one state payload', async () => {
    const api = newApi();
    await api.saveEntry('2026-10-01', { calories: 2000 });
    const state = await api.getState();
    assert.equal(state.settings.unit, 'lb');
    assert.deepEqual(state.entries.map((e) => e.date), ['2026-10-01']);
  });

  it('validates an entry before storing it', async () => {
    const error = await rejects(newApi().saveEntry('2026-10-01', { calories: 999999 }), /^Calories must be between/);
    assert.equal(error.field, 'calories');
  });

  it('validates the date', async () => {
    await rejects(newApi().saveEntry('nope', { calories: 2000 }), /not a valid YYYY-MM-DD date/);
  });

  it('validates settings before storing them', async () => {
    await rejects(newApi().saveSettings({ unit: 'stone' }), /Unit must be one of/);
  });

  it('normalizes values on the way in', async () => {
    const entry = await newApi().saveEntry('2026-10-01', { weight_kg: '80.5', calories: '2000' });
    assert.equal(entry.weight_kg, 80.5);
    assert.equal(entry.calories, 2000);
  });

  it('reports deleting a day that was never logged', async () => {
    await rejects(newApi().deleteEntry('2026-10-01'), /No entry recorded for 2026-10-01/);
  });

  it('deletes a logged day', async () => {
    const api = newApi();
    await api.saveEntry('2026-10-01', { calories: 2000 });
    await api.deleteEntry('2026-10-01');
    assert.deepEqual((await api.getState()).entries, []);
  });

  it('imports a CSV and reports the count', async () => {
    const api = newApi();
    const result = await api.importCsv('date,weight_kg,calories\n2026-10-01,80.5,2000\n2026-10-02,80.3,1900\n');
    assert.equal(result.imported, 2);
    assert.equal((await api.getState()).entries.length, 2);
  });

  it('writes nothing when a later row is bad', async () => {
    const api = newApi();
    await rejects(api.importCsv('date,calories\n2026-10-01,2000\n2026-10-02,oops\n'), /row 3/);
    assert.deepEqual((await api.getState()).entries, [], 'a bad row must not leave a half-applied import');
  });

  it('exports what was imported', async () => {
    const api = newApi();
    const csv = 'date,weight_kg,calories,calories_burned,calorie_target,note,foods\n2026-10-01,80.5,1950,420,2000,felt good,\n';
    await api.importCsv(csv);
    assert.equal(await api.exportCsv(), csv);
  });

  it('merges an import into an existing day', async () => {
    const api = newApi();
    await api.saveEntry('2026-10-01', { weight_kg: 80.5 });
    await api.importCsv('date,calories\n2026-10-01,2000\n');
    const [entry] = (await api.getState()).entries;
    assert.equal(entry.weight_kg, 80.5);
    assert.equal(entry.calories, 2000);
  });
});
