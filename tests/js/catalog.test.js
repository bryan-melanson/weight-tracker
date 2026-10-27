import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  GRAM,
  OUNCE,
  buildCatalog,
  customItem,
  defaultChoice,
  describeAmount,
  foodForItem,
  itemFor,
  itemKcal,
  normalize,
  recentFoods,
  searchCatalog,
  searchRecent,
  stem,
  unitForItem,
  unitsFor,
} from '../../static/js/foods/catalog.js';

/* A slice of foods.json, in its shape: [name, kcal per 100 g, [[label, grams]]]. */
const catalog = buildCatalog({
  foods: [
    ['Bananas, raw', 89, [['cup, mashed', 225], ['medium (7" to 7-7/8" long)', 118]]],
    ['Bananas, dehydrated, or banana powder', 346, [['tbsp', 6.2]]],
    ['Egg, yolk, dried', 669, []],
    ['Egg, whole, raw, fresh', 143, [['large', 50]]],
    ['Salmonberries, raw (Alaska Native)', 47, []],
    ['Fish, salmon, Atlantic, farmed, raw', 208, [['oz', 28.35]]],
    ['Blueberries, raw', 57, [['cup', 148]]],
    ['Tomatoes, red, ripe, raw', 18, [['medium', 123]]],
    ['Café, au lait', 40, []],
  ],
});
const names = (query) => searchCatalog(catalog, query).map((food) => food.name);
const food = (name) => catalog.byName.get(name);

describe('normalize and stem', () => {
  it('folds case, accents and punctuation', () => {
    assert.equal(normalize('Café, au-LAIT!'), 'cafe au lait');
  });

  it('reduces plurals both sides share', () => {
    assert.equal(stem('eggs'), 'egg');
    assert.equal(stem('berries'), 'berry');
    assert.equal(stem('tomatoes'), 'tomato');
    assert.equal(stem('glass'), 'glass');
  });
});

describe('searchCatalog', () => {
  it('puts the plain form first', () => {
    assert.equal(names('banana')[0], 'Bananas, raw');
    assert.equal(names('eggs')[0], 'Egg, whole, raw, fresh');
  });

  it('still finds the processed form when asked for it', () => {
    assert.equal(names('banana dehydrated')[0], 'Bananas, dehydrated, or banana powder');
  });

  it('prefers a whole word over a longer word it starts', () => {
    assert.equal(names('salmon')[0], 'Fish, salmon, Atlantic, farmed, raw');
  });

  it('needs every word to match', () => {
    assert.deepEqual(names('banana egg'), []);
  });

  it('matches across plurals and accents', () => {
    assert.deepEqual(names('blueberry'), ['Blueberries, raw']);
    assert.deepEqual(names('tomato'), ['Tomatoes, red, ripe, raw']);
    assert.deepEqual(names('cafe'), ['Café, au lait']);
  });

  it('returns nothing for an empty query', () => {
    assert.deepEqual(names('  '), []);
  });

  it('respects the limit', () => {
    assert.equal(searchCatalog(catalog, 'raw', 2).length, 2);
  });
});

describe('measures', () => {
  it("offers USDA's measures, then grams and ounces", () => {
    assert.deepEqual(unitsFor(food('Bananas, raw')).map((unit) => unit.label), [
      'cup, mashed', 'medium (7" to 7-7/8" long)', 'g', 'oz',
    ]);
  });

  it('does not repeat a measure USDA already has', () => {
    assert.deepEqual(unitsFor(food('Fish, salmon, Atlantic, farmed, raw')).map((unit) => unit.label), ['oz', 'g']);
  });

  it('starts from one of the first measure, or 100 g', () => {
    assert.deepEqual(defaultChoice(food('Bananas, raw')), { unit: food('Bananas, raw').portions[0], amount: 1 });
    assert.deepEqual(defaultChoice(food('Egg, yolk, dried')), { unit: GRAM, amount: 100 });
  });

  it('builds an item from a measure and an amount', () => {
    const item = itemFor(food('Bananas, raw'), food('Bananas, raw').portions[1], 2);
    assert.deepEqual(item, {
      name: 'Bananas, raw', portion: 'medium (7" to 7-7/8" long)', quantity: 2, unit_kcal: 105.02, unit_grams: 118,
    });
    assert.equal(itemKcal(item), 210);
  });

  it('weighs grams and ounces', () => {
    assert.equal(itemKcal(itemFor(food('Bananas, raw'), GRAM, 150)), 134);
    assert.equal(itemKcal(itemFor(food('Bananas, raw'), OUNCE, 1)), 25);
  });
});

describe('logged items as foods again', () => {
  it('finds an indexed food with all its measures', () => {
    const item = itemFor(food('Bananas, raw'), GRAM, 150);
    const again = foodForItem(catalog, item);
    assert.equal(again, food('Bananas, raw'));
    assert.equal(unitForItem(again, item).label, 'g');
  });

  it('keeps a custom food to its own serving', () => {
    const item = customItem('Chili, homemade', 450, 1.5);
    const again = foodForItem(catalog, item);
    assert.deepEqual(unitsFor(again).map((unit) => unit.label), ['serving']);
    assert.equal(itemKcal(itemFor(again, unitForItem(again, item), 2)), 900);
  });

  it('works without the index at all', () => {
    const item = itemFor(food('Bananas, raw'), food('Bananas, raw').portions[0], 1);
    const again = foodForItem(null, item);
    const unit = unitForItem(again, item);
    assert.equal(unit.label, 'cup, mashed');
    assert.equal(itemKcal(itemFor(again, unit, 1)), itemKcal(item));
    assert.ok(unitsFor(again).some((option) => option.label === 'g'), 'a weighed item can switch to grams');
  });
});

describe('recentFoods', () => {
  const banana = itemFor(food('Bananas, raw'), GRAM, 150);
  const chili = customItem('Chili, homemade', 450, 1);
  const egg = itemFor(food('Egg, whole, raw, fresh'), food('Egg, whole, raw, fresh').portions[0], 2);
  const entries = [
    { date: '2026-10-01', foods: [banana, chili] },
    { date: '2026-10-02', foods: null },
    { date: '2026-10-03', foods: [{ ...banana, quantity: 200 }, egg] },
  ];

  it('lists the most recent first, one row per food and measure, with the last amount', () => {
    const recent = recentFoods(entries);
    assert.deepEqual(recent.map((item) => item.name), ['Egg, whole, raw, fresh', 'Bananas, raw', 'Chili, homemade']);
    assert.equal(recent[1].quantity, 200);
  });

  it("leaves out the day's own foods", () => {
    assert.deepEqual(recentFoods(entries, { excludeDate: '2026-10-03' }).map((item) => item.name), [
      'Chili, homemade', 'Bananas, raw',
    ]);
  });

  it('filters by query', () => {
    assert.deepEqual(searchRecent(recentFoods(entries), 'chil').map((item) => item.name), ['Chili, homemade']);
  });
});

describe('describeAmount', () => {
  it('reads naturally', () => {
    assert.equal(describeAmount({ quantity: 250, portion: 'g' }), '250 g');
    assert.equal(describeAmount({ quantity: 1.5, portion: 'cup, chopped' }), '1.5 × cup, chopped');
    assert.equal(describeAmount({ quantity: 1, portion: 'serving' }), '1 serving');
    assert.equal(describeAmount({ quantity: 2, portion: 'serving' }), '2 servings');
    assert.equal(describeAmount({ quantity: 1, portion: '' }), '');
    assert.equal(describeAmount({ quantity: 0.333333, portion: 'cup' }), '0.33 × cup');
  });
});
