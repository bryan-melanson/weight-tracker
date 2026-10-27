/* The food index and everything derived from it. Pure functions only: the
   panel (foods/panel.js) does the DOM, and this is what the tests exercise.

   The index is static/foods.json, built from USDA FoodData Central by
   tools/build_food_index.py: each food is [name, kcal per 100 g, portions],
   with every portion a [label, grams] pair for one of that measure. */

/* Always on offer, whatever USDA measured: weight is how a label or a kitchen
   scale talks. */
export const GRAM = Object.freeze({ label: 'g', grams: 1 });
export const OUNCE = Object.freeze({ label: 'oz', grams: 28.35 });

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
  return { foods, byName: new Map(foods.map((food) => [food.name, food])) };
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

/* A food, wherever it came from, is { name, kcal100, portions } — kcal100 is
   null for one known only by the energy of a serving — and a measure (a
   "unit") is { label, grams }, grams null when only its energy is known, in
   which case it carries that as kcal. */

/* The measures a food can be logged in: what USDA measured (or the one it was
   logged with), then grams and ounces whenever there is a weight to go by. */
export function unitsFor(food) {
  const units = [...(food.portions || [])];
  if (food.kcal100 === null || food.kcal100 === undefined) return units;
  const has = (label) => units.some((unit) => unit.label === label);
  if (!has(GRAM.label)) units.push(GRAM);
  if (!has(OUNCE.label)) units.push(OUNCE);
  return units;
}

/* A sensible amount to start from: one of the first real measure, or 100 g
   when weight is all there is. */
export function defaultChoice(food) {
  const [unit] = unitsFor(food);
  return { unit, amount: unit.label === GRAM.label ? 100 : 1 };
}

/* One measure's energy: from its weight where there is one, otherwise the
   energy it was logged with. */
export function unitKcal(food, unit) {
  if (unit.grams && food.kcal100 !== null && food.kcal100 !== undefined) {
    return round2((food.kcal100 * unit.grams) / 100);
  }
  return unit.kcal ?? 0;
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

/* A food that is not in the index: the energy of one serving, from a label
   or a recipe, and how many servings. */
export function customItem(name, kcalPerServing, servings, portion = 'serving') {
  return { name, portion, quantity: servings, unit_kcal: kcalPerServing, unit_grams: null };
}

/* Mirrors food_kcal in tracker/validation.py and foodKcal in the backend. */
export const itemKcal = (item) => Math.floor(item.quantity * item.unit_kcal + 0.5);

/* A logged item seen as a food again, so it can be re-logged or edited in
   the same picker as a search result. Found in the index, it gets the
   index's full set of measures; otherwise only the one it was logged with
   (plus grams and ounces, if that one had a weight). */
export function foodForItem(catalog, item) {
  const known = catalog && catalog.byName.get(item.name);
  if (known && unitsFor(known).some((unit) => unit.label === item.portion)) return known;
  const grams = item.unit_grams;
  return {
    name: item.name,
    kcal100: grams ? (item.unit_kcal * 100) / grams : null,
    portions: [{ label: item.portion || 'serving', grams: grams || null, kcal: item.unit_kcal }],
  };
}

/* The measure an item was logged in, among a food's measures. */
export const unitForItem = (food, item) =>
  unitsFor(food).find((unit) => unit.label === (item.portion || 'serving')) || unitsFor(food)[0];

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

/* "1.5 × cup, chopped", "250 g", "2 servings". */
export function describeAmount(item) {
  const amount = Number.isInteger(item.quantity) ? String(item.quantity) : String(round2(item.quantity));
  if (!item.portion) return amount === '1' ? '' : `× ${amount}`;
  if (item.portion === GRAM.label || item.portion === OUNCE.label) return `${amount} ${item.portion}`;
  if (item.portion === 'serving') return `${amount} serving${item.quantity === 1 ? '' : 's'}`;
  return `${amount} × ${item.portion}`;
}
