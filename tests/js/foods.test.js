import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { MAX_FOOD_NAME_LENGTH, MAX_FOODS_PER_DAY } from '../../static/js/backend/limits.js';
import { createLocalApi } from '../../static/js/backend/local.js';
import { createStore } from '../../static/js/backend/store.js';
import {
  ValidationError,
  foodKcal,
  foodTotal,
  validateEntryPatch,
  validateFoods,
} from '../../static/js/backend/validate.js';
import { memoryAdapter } from './helpers/memory-adapter.js';

/* Mirrors tests/test_foods.py case for case. The shared fixture round-trips
   byte for byte through both backends. */

const FIXTURE = readFileSync(new URL('../fixtures/food-log.csv', import.meta.url), 'utf8');

const item = (overrides = {}) => ({
  name: 'Bananas, raw', portion: 'medium', quantity: 1, unit_kcal: 105, unit_grams: 118, ...overrides,
});

const throws = (fn, pattern) => {
  let error = null;
  try { fn(); } catch (caught) { error = caught; }
  assert.ok(error instanceof ValidationError, `expected a ValidationError, got ${error}`);
  if (pattern) assert.match(error.message, pattern);
  return error;
};

describe('validateFoods', () => {
  it('normalizes key order and defaults', () => {
    assert.deepEqual(validateFoods([{ unit_kcal: 300, quantity: 2, name: ' Oats ' }]), [
      { name: 'Oats', portion: '', quantity: 2, unit_kcal: 300, unit_grams: null },
    ]);
  });

  it('accepts JSON text', () => {
    assert.equal(validateFoods('[{"name":"Oats","quantity":1,"unit_kcal":300}]')[0].name, 'Oats');
  });

  const cases = [
    ['not json', /JSON list/],
    [{ name: 'x' }, /must be a list/],
    [[1], /Food 1 must be an object/],
    [[item({ colour: 'red' })], /unknown field/],
    [[{ name: 'x', quantity: 1 }], /missing 'unit_kcal'/],
    [[item({ name: '  ' })], /name is required/],
    [[item({ name: 'x'.repeat(MAX_FOOD_NAME_LENGTH + 1) })], /characters or fewer/],
    [[item({ name: 'tab\there' })], /control characters/],
    [[item({ quantity: '1' })], /quantity must be a number/],
    [[item({ quantity: true })], /quantity must be a number/],
    [[item({ quantity: 0 })], /quantity must be between/],
    [[item({ unit_kcal: -1 })], /calories must be between/],
    [[item({ unit_grams: 0 })], /grams must be above/],
    [[item({ quantity: 1000, unit_kcal: 900 })], /more than 20,000 kcal/],
    [Array(5).fill(item({ unit_kcal: 5000 })), /The day's foods come to more than/],
    [Array(MAX_FOODS_PER_DAY + 1).fill(item()), /at most/],
  ];
  for (const [value, pattern] of cases) {
    it(`rejects ${pattern}`, () => {
      assert.equal(throws(() => validateFoods(value), pattern).field, 'foods');
    });
  }

  it('names the offending item', () => {
    throws(() => validateFoods([item(), item({ quantity: -1 })]), /Food 2 quantity/);
  });

  it('clears on blank', () => {
    assert.deepEqual(validateEntryPatch({ foods: '' }), { foods: null });
    assert.deepEqual(validateEntryPatch({ foods: null }), { foods: null });
  });
});

describe('kcal', () => {
  it('multiplies quantity by one portion', () => {
    assert.equal(foodKcal(item({ quantity: 1.5, unit_kcal: 105.02 })), 158);
  });

  it('rounds half up, as the server does', () => {
    assert.equal(foodKcal(item({ unit_kcal: 2.5 })), 3);
    assert.equal(foodKcal(item({ unit_kcal: 0.5 })), 1);
  });

  it('totals rounded items', () => {
    assert.equal(foodTotal([item({ unit_kcal: 0.5 }), item({ unit_kcal: 0.5 })]), 2);
    assert.equal(foodTotal(null), 0);
  });
});

describe('the calories rule', () => {
  const setup = () => {
    const store = createStore(memoryAdapter());
    const save = (date, patch) => store.upsertEntry(date, validateEntryPatch(patch));
    return { store, save };
  };

  it('sets calories from foods', async () => {
    const { save } = setup();
    assert.equal((await save('2026-10-01', { foods: [item(), item({ unit_kcal: 300 })] })).calories, 405);
  });

  it('does not let calories alone contradict foods', async () => {
    const { save } = setup();
    await save('2026-10-01', { foods: [item()] });
    assert.equal((await save('2026-10-01', { calories: 5000 })).calories, 105);
  });

  it('leaves foods alone when other fields change', async () => {
    const { save } = setup();
    await save('2026-10-01', { foods: [item()] });
    const entry = await save('2026-10-01', { weight_kg: 80, note: 'fine' });
    assert.equal(entry.calories, 105);
    assert.equal(entry.foods.length, 1);
  });

  it('clears the total with the foods', async () => {
    const { save } = setup();
    await save('2026-10-01', { foods: [item()] });
    const entry = await save('2026-10-01', { foods: [] });
    assert.equal(entry.foods, null);
    assert.equal(entry.calories, null);
  });

  it('can set a number while clearing foods', async () => {
    const { save } = setup();
    await save('2026-10-01', { foods: [item()] });
    assert.equal((await save('2026-10-01', { foods: [], calories: 1900 })).calories, 1900);
  });

  it('keeps a hand-typed total when given an empty foods cell', async () => {
    const { save } = setup();
    await save('2026-10-01', { calories: 1900 });
    assert.equal((await save('2026-10-01', { foods: null })).calories, 1900);
  });

  it('gives a new day null foods', async () => {
    const { save } = setup();
    assert.equal((await save('2026-10-01', { calories: 1900 })).foods, null);
  });
});

describe('local api', () => {
  it('saves foods through saveEntry', async () => {
    const api = createLocalApi(memoryAdapter());
    assert.equal((await api.saveEntry('2026-10-01', { foods: [item({ quantity: 2 })] })).calories, 210);
  });

  it('round-trips the shared fixture byte for byte', async () => {
    const api = createLocalApi(memoryAdapter());
    await api.importCsv(FIXTURE);
    assert.equal(await api.exportCsv(), FIXTURE);
  });

  it('recomputes calories from foods on import', async () => {
    const api = createLocalApi(memoryAdapter());
    await api.importCsv('date,calories,foods\n2026-10-01,9999,"[{""name"":""Oats"",""quantity"":1,""unit_kcal"":300}]"\n');
    assert.equal((await api.getState()).entries[0].calories, 300);
  });

  it('reports the row of a bad food cell and writes nothing', async () => {
    const api = createLocalApi(memoryAdapter());
    let error = null;
    try { await api.importCsv('date,foods\n2026-10-01,[]\n2026-10-02,oops\n'); } catch (caught) { error = caught; }
    assert.match(error.message, /row 3/);
    assert.deepEqual((await api.getState()).entries, []);
  });
});
