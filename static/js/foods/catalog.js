/* The food index and everything derived from it. Pure functions only: the
   panel (foods/panel.js) does the DOM, and this is what the tests exercise.

   The index is static/foods.json, built from USDA FoodData Central by
   tools/build_food_index.py: each food is [name, kcal per 100 g, portions],
   with every portion a [label, grams] pair for one of that measure. */

/* Lower case, accents folded, punctuation to spaces: "Café, au-lait" and
   "cafe au lait" compare equal. */
export function normalize(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/* Just enough stemming that a plural finds its singular — "eggs" finds "Egg",
   "berries" finds "Blueberry", "tomatoes" finds "Tomato". Both sides go
   through it, so it only has to be consistent, not correct English. */
export function stem(word) {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith('oes')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

export const tokenize = (text) => normalize(text).split(' ').filter(Boolean).map(stem);

/* USDA's category headings, where the food itself is named second:
   "Fish, salmon, …", "Beverages, coffee, …", "Cheese, cheddar". */
const CATEGORY_HEADS = new Set([
  'fish', 'crustacean', 'mollusk', 'beverage', 'cheese', 'spice', 'oil', 'soup', 'snack',
  'candy', 'cereal', 'nut', 'seed', 'sauce', 'sweetener', 'game meat', 'alcoholic beverage',
]);

/* The part before the first comma is what USDA files the food under
   ("Bananas" in "Bananas, raw"): a match there is a match on the food. Under
   a category heading, the segment after it counts as well. */
function headOf(name) {
  const [first = '', second = ''] = name.split(',');
  const head = tokenize(first);
  return CATEGORY_HEADS.has(head.join(' ')) ? [...head, ...tokenize(second)] : head;
}

export function buildCatalog(data) {
  const foods = (data && Array.isArray(data.foods) ? data.foods : []).map(([name, kcal100, portions]) => ({
    name,
    kcal100,
    portions: (portions || []).map(([label, grams]) => ({ label, grams })),
    words: tokenize(name),
    ...formOf(name, tokenize(name)),
    head: headOf(name),
  }));
  lendDensities(foods);
  return { foods, byName: new Map(foods.map((food) => [food.name, food])) };
}

/* How a food was prepared, and what form it is in, changes how much of it
   fills a cup — cooked rice is lighter than raw, powder is not liquid — so
   density is only lent between foods described the same way. */
const STATES = new Set([
  'raw', 'cooked', 'boiled', 'baked', 'roasted', 'fried', 'grilled', 'broiled', 'steamed', 'stewed',
  'braised', 'dry', 'dried', 'dehydrated', 'canned', 'frozen', 'toasted', 'prepared', 'drained',
  'powder', 'liquid', 'concentrate', 'undiluted', 'diluted', 'reconstituted', 'whipped',
  'shredded', 'chopped', 'diced', 'sliced', 'mashed', 'ground', 'crumbled', 'flaked', 'puffed',
]);
const MIN_FIT = 0.5;
const FILLER = new Set(['and', 'or', 'with', 'without', 'only', 'in', 'of', 'type', 'style', 'all', 'added']);
const MIN_FAMILY = 3;
const FAMILY_SPREAD = 0.15;

/* The name without parentheticals, split into its comma segments. */
const segmentsOf = (name) =>
  name.replace(/\([^)]*\)/g, ' ').split(',').map((segment) => tokenize(segment).filter((word) => !FILLER.has(word)));
const stateOf = (words) => words.filter((word) => STATES.has(word)).sort().join(' ');

/* USDA weighed a cup or a spoon of only some foods. A food it did not can
   still be logged by volume when its relatives settle what it weighs:
   - a close relative under the same heading and of the same variety, in the
     same state ("Yogurt, Greek, plain, whole milk" from "Yogurt, plain,
     whole milk" would not qualify; "…, Greek, plain, lowfat" would); or
   - failing that, at least three relatives in the same state that all weigh
     within 15% of one another, by their median ("Peanut butter, creamy"
     from the other peanut butters).
   Anything less certain stays weight-only: rolled oats must not borrow a
   cup from whole groats at twice the weight. The measures it gets are
   marked as estimated, with where the estimate came from. */
function lendDensities(foods) {
  const byHead = new Map();
  for (const food of foods) {
    const [head = [], variety = [], ...more] = segmentsOf(food.name);
    const entry = {
      food,
      variety: new Set(variety),
      rest: new Set([...variety, ...more.flat()]),
      state: stateOf([...variety, ...more.flat()]),
      density: densityOf(food.portions),
    };
    const key = head.join(' ');
    if (!byHead.has(key)) byHead.set(key, []);
    byHead.get(key).push(entry);
  }

  for (const group of byHead.values()) {
    const lenders = group.filter((entry) => entry.density);
    if (!lenders.length) continue;
    for (const entry of group) {
      if (entry.density) continue;
      const peers = lenders.filter((lender) => lender.state === entry.state);
      let best = null;
      for (const lender of peers) {
        const sameVariety = [...entry.variety].some((word) => lender.variety.has(word));
        if (!sameVariety) continue;
        const shared = [...entry.rest].filter((word) => lender.rest.has(word)).length;
        const fit = shared / new Set([...entry.rest, ...lender.rest]).size;
        if (fit >= MIN_FIT && (!best || fit > best.fit)) best = { lender, fit };
      }
      if (best) {
        entry.food.borrowed = { density: best.lender.density, from: best.lender.food.name };
        continue;
      }
      if (peers.length < MIN_FAMILY) continue;
      const densities = peers.map((peer) => peer.density).sort((a, b) => a - b);
      const median = densities[Math.floor(densities.length / 2)];
      if (densities.every((value) => Math.abs(value - median) <= median * FAMILY_SPREAD)) {
        const [head] = entry.food.name.split(',');
        entry.food.borrowed = { density: median, from: `other ${head.toLowerCase()} entries` };
      }
    }
  }
}

const PLAIN = new Set(['raw', 'whole', 'plain', 'fresh']);
const PROCESSED = new Set(['dried', 'dry', 'dehydrated', 'powder', 'babyfood', 'imitation', 'substitute', 'mix']);

/* Every query word has to start a word of the name. Among the matches, the
   ones whose heading the query names come first, then earlier and whole-word
   matches ("salmon" is Salmon before Salmonberries), then shorter names —
   USDA's plainest entry for a food ("Bananas, raw") is usually its shortest. */
function score(food, terms) {
  let total = 0;
  for (const term of terms) {
    const at = food.words.findIndex((word) => word.startsWith(term));
    if (at === -1) return null;
    total += at * 2;
    if (!food.words.includes(term)) total += 4;
    if (!food.head.some((word) => word.startsWith(term))) total += 6;
  }
  const askedProcessed = terms.some((term) => PROCESSED.has(term));
  return total + food.name.length / 25 + food.plain + (askedProcessed ? 0 : food.processed);
}

/* A nudge toward the everyday form of a food, unless the query asks for the
   other one: "egg" means a whole egg, not dried yolk. Brand-name entries
   (an all-capitals word) and USDA's commodity-programme duplicates sink. */
function formOf(name, words) {
  let plain = 0;
  let processed = 0;
  for (const word of words) {
    if (PLAIN.has(word)) plain -= 1.5;
    if (PROCESSED.has(word)) processed += 2;
  }
  if (/\b[A-Z]{3,}\b/.test(name)) plain += 3;
  if (name.includes("USDA's Food Distribution Program")) plain += 3;
  return { plain, processed };
}

export function searchCatalog(catalog, query, limit = 25) {
  const terms = tokenize(query);
  if (!terms.length || !catalog) return [];
  const hits = [];
  for (const food of catalog.foods) {
    const value = score(food, terms);
    if (value !== null) hits.push({ food, value });
  }
  hits.sort((a, b) => a.value - b.value || a.food.name.localeCompare(b.food.name));
  return hits.slice(0, limit).map((hit) => hit.food);
}

const round2 = (value) => Math.round(value * 100) / 100;
// Energy per measure keeps four places: a millilitre of soup is 0.9722 kcal,
// and two places would lose a calorie over a bowl of it.
const round4 = (value) => Math.round(value * 10000) / 10000;

/* A food, wherever it came from, is { name, kcal100, kcalPerMl, portions }:
   energy per 100 g where its weight is known, per millilitre for a food
   known only by volume, and the measures USDA (or the person) gave it. A
   measure — a "unit" — is { label, group, grams?, ml?, kcal? }: a weight in
   grams, a volume in millilitres, or for a serving only its energy. */

export const WEIGHTS = Object.freeze([
  { label: 'g', grams: 1 },
  { label: 'oz', grams: 28.3495 },
  { label: 'lb', grams: 453.592 },
  { label: 'kg', grams: 1000 },
].map((unit) => Object.freeze({ ...unit, group: 'weight' })));

export const VOLUMES = Object.freeze([
  { label: 'cup', ml: 236.588 },
  { label: 'tbsp', ml: 14.787 },
  { label: 'tsp', ml: 4.929 },
  { label: 'fl oz', ml: 29.574 },
  { label: 'ml', ml: 1 },
].map((unit) => Object.freeze({ ...unit, group: 'volume' })));

export const [GRAM, OUNCE] = WEIGHTS;

export const GROUP_LABELS = { portion: 'Portions', volume: 'Volume', weight: 'Weight' };
const GROUP_ORDER = ['portion', 'volume', 'weight'];

/* How many millilitres a USDA volume label stands for: "cup, chopped" is a
   cup, "tablespoon" a tbsp, "fl oz" a fluid ounce. Null for anything else. */
const VOLUME_WORD = /^(fl oz|cups?|tbsp|tablespoons?|tsp|teaspoons?|ml|liters?|litres?|quarts?|pints?)\b/i;
const ML_PER = {
  'fl oz': 29.574, cup: 236.588, tbsp: 14.787, tablespoon: 14.787, tsp: 4.929, teaspoon: 4.929,
  ml: 1, liter: 1000, litre: 1000, quart: 946.353, pint: 473.176,
};
export function volumeOf(label) {
  const match = VOLUME_WORD.exec(String(label || '').trim());
  if (!match) return null;
  const word = match[1].toLowerCase();
  return ML_PER[word] ?? ML_PER[word.replace(/s$/, '')] ?? null;
}

const WEIGHT_LABELS = new Set(WEIGHTS.map((unit) => unit.label));

/* USDA spells the spoons both ways ("tablespoon", "tbsp"): one name each, so
   a food never offers the same measure twice. */
export function canonicalLabel(label) {
  return String(label || '')
    .replace(/^tablespoons?\b/i, 'tbsp')
    .replace(/^teaspoons?\b/i, 'tsp')
    .replace(/^cups\b/i, 'cup');
}

/* Grams per millilitre, from the food's own volume measures: a plain "cup"
   if USDA weighed one, otherwise the first volume it did weigh. */
function densityOf(portions) {
  const volumes = portions.filter((unit) => unit.grams && volumeOf(unit.label));
  const plain = volumes.find((unit) => unit.label.trim().toLowerCase() in ML_PER) || volumes[0];
  return plain ? plain.grams / volumeOf(plain.label) : null;
}

const known = (value) => value !== null && value !== undefined;

/* Every measure a food can be logged in, grouped:
   - Portions: what USDA measured that is not a plain volume or weight
     ("medium", "slice", "cup, chopped").
   - Volume: USDA's volume measures, plus cup, tbsp, tsp, fl oz and ml worked
     out from the food's density wherever USDA weighed any volume of it.
   - Weight: g, oz, lb and kg whenever its energy per gram is known.
   A standard measure USDA already gives (its own "tbsp") is not repeated. */
export function unitsFor(food) {
  const portions = (food.portions || []).map((unit) => {
    const label = canonicalLabel(unit.label);
    return {
      ...unit,
      label,
      group: volumeOf(label) ? 'volume' : WEIGHT_LABELS.has(label) ? 'weight' : 'portion',
    };
  });
  const units = [];
  const add = (unit) => { if (!units.some((other) => other.label === unit.label)) units.push(unit); };
  portions.forEach(add);

  const covered = (ml) => units.some((unit) => volumeOf(unit.label) === ml);
  const own = densityOf(portions);
  const density = known(food.kcal100) ? own ?? food.borrowed?.density ?? null : null;
  if (density) {
    const estimated = own ? {} : { estimatedFrom: food.borrowed.from };
    for (const volume of VOLUMES) {
      if (!covered(volume.ml)) add({ ...volume, grams: round2(volume.ml * density), ...estimated });
    }
  } else if (known(food.kcalPerMl)) {
    for (const volume of VOLUMES) if (!covered(volume.ml)) add(volume);
  }
  if (known(food.kcal100)) WEIGHTS.forEach(add);

  return GROUP_ORDER.flatMap((group) => units.filter((unit) => unit.group === group));
}

/* Where to start the picker: the measure and amount last used for this food
   if there is one, otherwise one of its first measure, or 100 g. */
export function defaultChoice(food, last = null) {
  const units = unitsFor(food);
  const previous = last && units.find((unit) => unit.label === canonicalLabel(last.portion));
  if (previous) return { unit: previous, amount: last.quantity };
  // A medium one if USDA sized it ("medium" banana, not "extra small"), else
  // the first measure USDA actually weighed, else 100 g — never an estimate.
  const weighed = units.filter((option) => !option.estimatedFrom && option.group !== 'weight');
  const unit = weighed.find((option) => /^medium\b/i.test(option.label))
    || weighed[0]
    || units.find((option) => option.label === GRAM.label)
    || units[0];
  return { unit, amount: unit.label === GRAM.label ? 100 : 1 };
}

/* One measure's energy: by weight, by volume, or as logged. */
export function unitKcal(food, unit) {
  if (unit.grams && known(food.kcal100)) return round4((food.kcal100 * unit.grams) / 100);
  if (unit.ml && known(food.kcalPerMl)) return round4(food.kcalPerMl * unit.ml);
  return unit.kcal ?? 0;
}

/* The same amount of food in another measure — 1 cup of oats is 81 g, not
   1 g. Null when the two cannot be compared (a serving and a weight). */
export function convertAmount(amount, from, to) {
  if (from.grams && to.grams) return (amount * from.grams) / to.grams;
  const fromMl = from.ml ?? volumeOf(from.label);
  const toMl = to.ml ?? volumeOf(to.label);
  if (!from.grams && !to.grams && fromMl && toMl) return (amount * fromMl) / toMl;
  return null;
}

/* What a logged item stores: how many of which measure, and the energy and
   weight of one. Storing one measure's energy rather than the total is what
   lets an amount be changed later without going back to the index. */
export function itemFor(food, unit, amount) {
  return {
    name: food.name,
    portion: unit.label,
    quantity: amount,
    unit_kcal: unitKcal(food, unit),
    unit_grams: unit.grams || null,
  };
}

/* A one-off item with no measure behind it — a typed total kept as an item. */
export function customItem(name, kcalPerServing, servings, portion = 'serving') {
  return { name, portion, quantity: servings, unit_kcal: kcalPerServing, unit_grams: null };
}

/* What a food that isn't listed can be counted per: the energy on a label
   or in a recipe is given per one of these. */
export const CUSTOM_BASES = Object.freeze([
  { key: 'serving', label: '1 serving' },
  { key: '100g', label: '100 g' },
  { key: 'oz', label: '1 oz' },
  { key: 'cup', label: '1 cup' },
  { key: 'tbsp', label: '1 tbsp' },
  { key: 'tsp', label: '1 tsp' },
]);

/* A food that isn't listed, made from its energy per one basis, with the
   measure and amount to start the picker on. Given per weight it can be
   logged in any weight; per volume, in any volume; per serving, in servings. */
export function customFood(name, kcal, basisKey) {
  if (basisKey === '100g') return { food: { name, kcal100: kcal, portions: [] }, unit: GRAM, amount: 100 };
  const weight = WEIGHTS.find((unit) => unit.label === basisKey);
  if (weight) {
    const food = { name, kcal100: (kcal * 100) / weight.grams, portions: [] };
    return { food, unit: weight, amount: 1 };
  }
  const volume = VOLUMES.find((unit) => unit.label === basisKey);
  if (volume) return { food: { name, kcalPerMl: kcal / volume.ml, portions: [] }, unit: volume, amount: 1 };
  const serving = { label: 'serving', kcal, group: 'portion' };
  return { food: { name, portions: [serving] }, unit: serving, amount: 1 };
}

/* Mirrors food_kcal in tracker/validation.py and foodKcal in the backend. */
export const itemKcal = (item) => Math.floor(item.quantity * item.unit_kcal + 0.5);

/* A logged item seen as a food again, so it can be re-logged or edited in
   the same picker as a search result. Found in the index, it gets the
   index's full set of measures. Otherwise it is rebuilt from what the item
   stored: by weight if it had one, by volume if its measure was a volume,
   or as the one serving it was logged in. */
export function foodForItem(catalog, item) {
  const indexed = catalog && catalog.byName.get(item.name);
  if (indexed && unitsFor(indexed).some((unit) => unit.label === canonicalLabel(item.portion))) return indexed;
  const label = item.portion || 'serving';
  const grams = item.unit_grams;
  if (grams) {
    return { name: item.name, kcal100: (item.unit_kcal * 100) / grams, portions: [{ label, grams }] };
  }
  const ml = volumeOf(label);
  if (ml) return { name: item.name, kcalPerMl: item.unit_kcal / ml, portions: [] };
  return { name: item.name, portions: [{ label, kcal: item.unit_kcal }] };
}

/* The measure an item was logged in, among a food's measures. */
export const unitForItem = (food, item) =>
  unitsFor(food).find((unit) => unit.label === canonicalLabel(item.portion || 'serving')) || unitsFor(food)[0];

/* The last time this food was logged, among recent items. */
export const lastLogged = (recent, name) => recent.find((item) => item.name === name) || null;

/* What has been eaten before, most recent first: one row per food and
   measure, carrying the amount last used. A day's own foods are skipped, so
   the list offers what is not already on it. */
export function recentFoods(entries, { excludeDate = null, limit = 8 } = {}) {
  const seen = new Map();
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry.foods || entry.date === excludeDate) continue;
    for (let at = entry.foods.length - 1; at >= 0; at -= 1) {
      const item = entry.foods[at];
      const key = `${item.name}\u0000${item.portion}`;
      if (!seen.has(key)) seen.set(key, { item });
    }
  }
  // Walked newest first, so the map's order already is the recency order.
  return [...seen.values()].slice(0, limit).map((row) => row.item);
}

/* Recent foods matching a query, for showing above the index's results. */
export function searchRecent(recent, query) {
  const terms = tokenize(query);
  if (!terms.length) return [];
  return recent.filter((item) => {
    const words = tokenize(item.name);
    return terms.every((term) => words.some((word) => word.startsWith(term)));
  });
}

/* Standard measures read as plain quantities; "cup" and "serving" take a
   plural. Anything else is a count of a described portion. */
const PLAIN_MEASURES = new Set([...WEIGHTS, ...VOLUMES].map((unit) => unit.label));
const PLURALS = new Set(['cup', 'serving']);

/* "1.5 × cup, chopped", "250 g", "2 tbsp", "1.5 cups", "2 servings". */
export function describeAmount(item) {
  const amount = Number.isInteger(item.quantity) ? String(item.quantity) : String(round2(item.quantity));
  if (!item.portion) return amount === '1' ? '' : `× ${amount}`;
  if (PLURALS.has(item.portion)) return `${amount} ${item.portion}${item.quantity === 1 ? '' : 's'}`;
  if (PLAIN_MEASURES.has(item.portion)) return `${amount} ${item.portion}`;
  return `${amount} × ${item.portion}`;
}
