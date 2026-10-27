import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CUSTOM_BASES,
  GRAM,
  OUNCE,
  buildCatalog,
  canonicalLabel,
  convertAmount,
  customFood,
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

  it('ranks an entry with measures above its weight-only twin', () => {
    // A bare name has no variety to borrow a density by, so it stays
    // weight-only, and the shorter name alone would put it first.
    const twins = buildCatalog({ foods: [
      ['Ketchup', 101, []],
      ['Ketchup, restaurant', 97, [['tbsp', 17]]],
    ] });
    assert.equal(searchCatalog(twins, 'ketchup')[0].name, 'Ketchup, restaurant');
  });

  it('respects the limit', () => {
    assert.equal(searchCatalog(catalog, 'raw', 2).length, 2);
  });
});

const labels = (food_) => unitsFor(food_).map((unit) => unit.label);

describe('measures', () => {
  it('groups portions, then volumes, then weights', () => {
    assert.deepEqual(labels(food('Bananas, raw')), [
      'medium (7" to 7-7/8" long)', 'cup, mashed', 'tbsp', 'tsp', 'fl oz', 'ml', 'g', 'oz', 'lb', 'kg',
    ]);
    assert.deepEqual(
      [...new Set(unitsFor(food('Bananas, raw')).map((unit) => unit.group))],
      ['portion', 'volume', 'weight'],
    );
  });

  it('works spoons out from a weighed cup', () => {
    const tbsp = unitsFor(food('Blueberries, raw')).find((unit) => unit.label === 'tbsp');
    assert.equal(tbsp.grams, 9.25); // 148 g per cup / 16
    assert.equal(tbsp.estimatedFrom, undefined);
  });

  it('does not repeat a measure USDA already has', () => {
    assert.deepEqual(labels(food('Fish, salmon, Atlantic, farmed, raw')), ['oz', 'g', 'lb', 'kg']);
  });

  it('spells the spoons one way', () => {
    assert.equal(canonicalLabel('tablespoon'), 'tbsp');
    assert.equal(canonicalLabel('teaspoons, packed'), 'tsp, packed');
    assert.equal(canonicalLabel('cups'), 'cup');
    const milk = buildCatalog({ foods: [['Milk', 60, [['cup', 244], ['tablespoon', 15], ['tbsp', 15]]]] }).foods[0];
    assert.deepEqual(labels(milk).filter((label) => label === 'tbsp'), ['tbsp']);
  });

  it('never starts on an estimated measure', () => {
    const pb = buildCatalog({ foods: [
      ['Peanut butter, chunk style', 589, [['tbsp', 16]]],
      ['Peanut butter, smooth style', 597, [['tbsp', 16]]],
      ['Peanut butter, reduced fat', 520, [['tbsp', 17]]],
      ['Peanut butter, creamy', 589, []],
    ] }).byName.get('Peanut butter, creamy');
    assert.ok(unitsFor(pb)[0].estimatedFrom);
    assert.deepEqual(defaultChoice(pb), { unit: GRAM, amount: 100 });
  });

  it('keeps a small measure precise', () => {
    const { food: soup } = customFood('Soup', 230, 'cup');
    const ml = unitsFor(soup).find((unit) => unit.label === 'ml');
    assert.equal(itemKcal(itemFor(soup, ml, 354.88)), 345);
  });

  it('offers no volume without a density to go by', () => {
    assert.deepEqual(labels(food('Egg, yolk, dried')), ['g', 'oz', 'lb', 'kg']);
  });

  it('starts from a medium one when USDA sized it', () => {
    const banana = buildCatalog({ foods: [['Bananas, raw', 89, [['extra small', 81], ['medium', 118], ['large', 136]]]] }).foods[0];
    assert.equal(defaultChoice(banana).unit.label, 'medium');
  });

  it('starts from one of the first measure, or 100 g', () => {
    assert.equal(defaultChoice(food('Bananas, raw')).unit.label, 'medium (7" to 7-7/8" long)');
    assert.equal(defaultChoice(food('Bananas, raw')).amount, 1);
    assert.deepEqual(defaultChoice(food('Egg, yolk, dried')), { unit: GRAM, amount: 100 });
  });

  it('starts from the measure and amount last used', () => {
    const last = itemFor(food('Bananas, raw'), GRAM, 150);
    const choice = defaultChoice(food('Bananas, raw'), last);
    assert.equal(choice.unit.label, 'g');
    assert.equal(choice.amount, 150);
  });

  it('builds an item from a measure and an amount', () => {
    const medium = unitsFor(food('Bananas, raw'))[0];
    const item = itemFor(food('Bananas, raw'), medium, 2);
    assert.deepEqual(item, {
      name: 'Bananas, raw', portion: 'medium (7" to 7-7/8" long)', quantity: 2, unit_kcal: 105.02, unit_grams: 118,
    });
    assert.equal(itemKcal(item), 210);
  });

  it('weighs grams, ounces, pounds and kilograms', () => {
    const banana = food('Bananas, raw');
    const unit = (label) => unitsFor(banana).find((option) => option.label === label);
    assert.equal(itemKcal(itemFor(banana, unit('g'), 150)), 134);
    assert.equal(itemKcal(itemFor(banana, unit('oz'), 1)), 25);
    assert.equal(itemKcal(itemFor(banana, unit('lb'), 1)), 404);
    assert.equal(itemKcal(itemFor(banana, unit('kg'), 0.5)), 445);
  });
});

describe('convertAmount', () => {
  const units = unitsFor(food('Blueberries, raw'));
  const unit = (label) => units.find((option) => option.label === label);

  it('keeps the same amount of food across measures', () => {
    assert.equal(convertAmount(1, unit('cup'), unit('g')), 148);
    assert.equal(convertAmount(148, unit('g'), unit('cup')), 1);
    assert.equal(Math.round(convertAmount(1, unit('cup'), unit('tbsp'))), 16);
  });

  it('converts volumes with no weight behind them', () => {
    const { food: soup } = customFood('Soup', 120, 'cup');
    const volumes = unitsFor(soup);
    const cup = volumes.find((option) => option.label === 'cup');
    const tbsp = volumes.find((option) => option.label === 'tbsp');
    assert.equal(Math.round(convertAmount(1, cup, tbsp)), 16);
  });

  it('refuses to compare a serving with a weight', () => {
    const { food: chili, unit: serving } = customFood('Chili', 450, 'serving');
    assert.equal(convertAmount(1, serving, GRAM), null);
    assert.deepEqual(labels(chili), ['serving']);
  });
});

describe('borrowed densities', () => {
  const family = buildCatalog({
    foods: [
      ['Peanut butter, chunk style, with salt', 589, [['tbsp', 16]]],
      ['Peanut butter, smooth style, with salt', 597, [['tablespoon', 16], ['cup', 258]]],
      ['Peanut butter, smooth, reduced fat', 520, [['tbsp', 17]]],
      ['Peanut butter, creamy', 589, []],
      ['Rice, white, long-grain, regular, raw, unenriched', 365, [['cup', 185]]],
      ['Rice, white, long-grain, regular, cooked, unenriched', 130, [['cup', 158]]],
      ['Rice, white, long grain, unenriched, raw', 360, []],
      ['Rice, brown, medium-grain, cooked', 112, []],
      ['Oats', 389, [['cup', 156]]],
      ['Oats, whole grain, rolled, old fashioned', 379, []],
    ],
  });
  const byName = (name) => family.byName.get(name);
  const tbspOf = (name) => unitsFor(byName(name)).find((unit) => unit.label === 'tbsp');

  it('borrows from a close relative in the same state', () => {
    assert.equal(byName('Rice, white, long grain, unenriched, raw').borrowed.from,
      'Rice, white, long-grain, regular, raw, unenriched');
  });

  it('falls back to a family that agrees', () => {
    assert.equal(byName('Peanut butter, creamy').borrowed.from, 'other peanut butter entries');
    assert.ok(tbspOf('Peanut butter, creamy').estimatedFrom);
    assert.equal(Math.round(tbspOf('Peanut butter, creamy').grams), 16);
  });

  it("borrows from a parent entry that leaves 'raw' unsaid", () => {
    const nuts = buildCatalog({ foods: [
      ['Nuts, almonds', 579, [['cup, whole', 143]]],
      ['Nuts, almonds, whole, raw', 600, []],
      ['Nuts, macadamia nuts, raw', 718, [['cup', 134]]],
      ['Nuts, cashew nuts, raw', 553, []],
    ] });
    assert.equal(nuts.byName.get('Nuts, almonds, whole, raw').borrowed.from, 'Nuts, almonds');
    // "nuts" is the heading, not a variety the two share.
    assert.equal(nuts.byName.get('Nuts, cashew nuts, raw').borrowed, undefined);
  });

  it('will not borrow across varieties or from too few relatives', () => {
    assert.equal(byName('Rice, brown, medium-grain, cooked').borrowed, undefined);
    assert.equal(byName('Oats, whole grain, rolled, old fashioned').borrowed, undefined);
    assert.equal(tbspOf('Oats, whole grain, rolled, old fashioned'), undefined);
  });
});

describe('foods that are not listed', () => {
  it('offers a basis for every kind of label', () => {
    assert.deepEqual(CUSTOM_BASES.map((basis) => basis.key), ['serving', '100g', 'oz', 'cup', 'tbsp', 'tsp']);
  });

  it('per 100 g can be logged in any weight', () => {
    const { food: bar, unit, amount } = customFood('Granola bar', 450, '100g');
    assert.equal(unit.label, 'g');
    assert.equal(amount, 100);
    assert.deepEqual(labels(bar), ['g', 'oz', 'lb', 'kg']);
    assert.equal(itemKcal(itemFor(bar, unit, 40)), 180);
  });

  it('per ounce becomes energy per gram', () => {
    const { food: jerky, unit } = customFood('Jerky', 80, 'oz');
    assert.equal(unit.label, 'oz');
    assert.equal(itemKcal(itemFor(jerky, unit, 2)), 160);
  });

  it('per volume can be logged in any volume', () => {
    const { food: soup, unit } = customFood('Soup', 120, 'cup');
    assert.deepEqual(labels(soup), ['cup', 'tbsp', 'tsp', 'fl oz', 'ml']);
    assert.equal(itemKcal(itemFor(soup, unit, 1.5)), 180);
    const tbsp = unitsFor(soup).find((option) => option.label === 'tbsp');
    assert.equal(itemKcal(itemFor(soup, tbsp, 16)), 120);
  });
});

describe('logged items as foods again', () => {
  it('rebuilds a volume-only food from a logged volume', () => {
    const { food: soup, unit } = customFood('Soup', 120, 'cup');
    const again = foodForItem(catalog, itemFor(soup, unit, 1));
    const tbsp = unitsFor(again).find((option) => option.label === 'tbsp');
    assert.equal(itemKcal(itemFor(again, tbsp, 16)), 120);
  });

  it('matches an item logged under the long spelling of a spoon', () => {
    const again = foodForItem(catalog, { name: 'Blueberries, raw', portion: 'tablespoon', quantity: 2, unit_kcal: 5.27, unit_grams: 9.25 });
    assert.equal(again, food('Blueberries, raw'));
    assert.equal(unitForItem(again, { portion: 'tablespoon' }).label, 'tbsp');
  });

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
    assert.ok(unitsFor(again).some((option) => option.label === 'tbsp'), 'a weighed cup still gives spoons');
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
    assert.equal(describeAmount({ quantity: 0.333333, portion: 'cup' }), '0.33 cups');
    assert.equal(describeAmount({ quantity: 1, portion: 'cup' }), '1 cup');
    assert.equal(describeAmount({ quantity: 2, portion: 'tbsp' }), '2 tbsp');
    assert.equal(describeAmount({ quantity: 0.5, portion: 'lb' }), '0.5 lb');
  });
});
