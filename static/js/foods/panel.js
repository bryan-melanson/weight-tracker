/* The food card: search, pick an amount, and the day's list.

   It owns no data. Every change is a whole new food list for the day, handed
   to `save`, and what comes back through `render` is what is shown — so the
   card can never disagree with what was stored. All text goes through
   textContent; nothing here writes HTML. */

import { fmtInt } from '../format.js';
import {
  CUSTOM_BASES,
  GROUP_LABELS,
  buildCatalog,
  convertAmount,
  customFood,
  customItem,
  defaultChoice,
  describeAmount,
  describeBasis,
  foodForItem,
  itemFor,
  itemKcal,
  lastLogged,
  myFoods,
  recentFoods,
  searchCatalog,
  searchMine,
  searchRecent,
  unitForItem,
  unitsFor,
} from './catalog.js';

const INDEX_URL = 'foods.json';
const RESULT_LIMIT = 25;
const RECENT_LIMIT = 8;
const MINE_LIMIT = 8;
const SEARCH_DELAY_MS = 90;

/* What a day's hand-typed total becomes when its first food is added, so
   starting a list never silently throws that number away. */
export const EARLIER_TOTAL = 'Calories logged before the food list';

const $ = (selector) => document.querySelector(selector);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const kcalText = (kcal) => `${fmtInt(kcal)} kcal`;

/* Fetched once, on first use: most visits never search, and the service
   worker has it cached for when they do. */
function catalogLoader(fetchImpl = (url) => fetch(url)) {
  let loading = null;
  return () => {
    if (!loading) {
      loading = fetchImpl(INDEX_URL)
        .then((response) => {
          if (!response.ok) throw new Error(`the food index did not load (${response.status})`);
          return response.json();
        })
        .then(buildCatalog)
        .catch((error) => {
          loading = null; // a later attempt may succeed
          throw error;
        });
    }
    return loading;
  };
}

export function mountFoodPanel({ context, save, setStatus }) {
  const loadCatalog = catalogLoader();
  let catalog = null;
  // What the picker is doing: adding a food, or editing item `index`.
  let picking = null;
  let searchTimer = null;

  const nodes = {
    date: $('#food-date'),
    total: $('#food-total'),
    meter: $('#food-meter'),
    search: $('#food-search'),
    query: $('#food-query'),
    note: $('#food-results-note'),
    results: $('#food-results'),
    customOpen: $('#food-custom-open'),
    picker: $('#food-picker'),
    pickerName: $('#food-picker-name'),
    amount: $('#food-amount'),
    unit: $('#food-unit'),
    pickerKcal: $('#food-picker-kcal'),
    pickerNote: $('#food-picker-note'),
    submit: $('#food-picker-submit'),
    remove: $('#food-picker-remove'),
    custom: $('#food-custom'),
    customName: $('#food-custom-name'),
    customKcal: $('#food-custom-kcal'),
    customBasis: $('#food-custom-basis'),
    items: $('#food-items'),
  };

  const foodsOf = (entry) => (entry && entry.foods ? entry.foods : []);

  /* --- saving --------------------------------------------------------- */

  async function commit(nextFoods, message) {
    const { date, entry } = context();
    let foods = nextFoods;
    const current = foodsOf(entry);
    // The first food on a day that already had a typed total keeps it as an
    // item of its own, which can then be removed like any other.
    if (!current.length && foods.length && entry && entry.calories) {
      foods = [customItem(EARLIER_TOTAL, entry.calories, 1, ''), ...foods];
    }
    return save(date, foods, message);
  }

  async function addItem(item) {
    const { entry } = context();
    const ok = await commit([...foodsOf(entry), item], `Added ${item.name} — ${kcalText(itemKcal(item))}.`);
    if (ok) {
      nodes.query.value = '';
      showResults();
    }
    return ok;
  }

  /* --- search --------------------------------------------------------- */

  function resultButton(title, detail, onPick, tag) {
    const item = el('li');
    const button = el('button', 'food-result');
    button.type = 'button';
    const name = el('span', 'food-result__name', title);
    const meta = el('span', 'food-result__meta', detail);
    if (tag) button.append(el('span', 'food-result__tag', tag));
    button.append(name, meta);
    button.addEventListener('click', onPick);
    item.append(button);
    return item;
  }

  function recentButton(item, tag) {
    const amount = describeAmount(item);
    const detail = `${kcalText(itemKcal(item))}${amount ? ` · ${amount}` : ''}`;
    return resultButton(item.name, detail, async () => {
      // One tap re-logs it exactly as last time; tapping it in the day's list
      // afterwards changes the amount.
      await addItem({ ...item });
    }, tag);
  }

  /* One of your own foods: opens the picker on the measure and amount it
     was last logged with, like any food from the index. */
  function myFoodButton({ food, item }) {
    return resultButton(item.name, describeBasis(food, item), () => {
      const { unit, amount } = defaultChoice(food, item);
      showPicker(food, unit, amount);
    }, 'My food');
  }

  function catalogButton(food) {
    return resultButton(food.name, `${fmtInt(food.kcal100)} kcal / 100 g`, () => openPicker(food));
  }

  function showResults() {
    const query = nodes.query.value.trim();
    const { date, entries } = context();
    const recent = recentFoods(entries, { excludeDate: date, limit: query ? 50 : RECENT_LIMIT });

    if (!query) {
      nodes.note.textContent = recent.length ? 'Recent — tap to add it again as before.' : '';
      nodes.results.replaceChildren(...recent.map((item) => recentButton(item)));
      return;
    }

    const recentHits = searchRecent(recent, query).slice(0, 3);
    if (!catalog) {
      nodes.note.textContent = 'Loading foods…';
      nodes.results.replaceChildren(...recentHits.map((item) => recentButton(item, 'Recent')));
      loadCatalog()
        .then((loaded) => {
          catalog = loaded;
          if (nodes.query.value.trim() === query) showResults();
        })
        .catch((error) => {
          nodes.note.textContent = `Search is unavailable: ${error.message}. Add it as a food that isn't listed instead.`;
        });
      return;
    }

    // Your own foods first, from all of your history; then recent foods from
    // the index; then the index.
    const mine = searchMine(myFoods(entries, catalog, { exclude: [EARLIER_TOTAL] }), query).slice(0, MINE_LIMIT);
    const indexedRecent = recentHits.filter((item) => catalog.byName.has(item.name));
    const hits = searchCatalog(catalog, query, RESULT_LIMIT);
    nodes.note.textContent = hits.length || indexedRecent.length || mine.length
      ? ''
      : `Nothing matches “${query}”. Try fewer or shorter words, or add it as a food that isn't listed.`;
    nodes.results.replaceChildren(
      ...mine.map(myFoodButton),
      ...indexedRecent.map((item) => recentButton(item, 'Recent')),
      ...hits.map(catalogButton),
    );
  }

  function onQuery() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(showResults, SEARCH_DELAY_MS);
  }

  /* --- the amount picker ---------------------------------------------- */

  /* "medium · 118 g", "tbsp · 16 g"; a weight or an unweighed measure is
     just its name. */
  function unitOptionText(unit) {
    if (unit.group === 'weight' || !unit.grams) return unit.label;
    const grams = unit.grams < 10 ? Math.round(unit.grams * 10) / 10 : Math.round(unit.grams);
    return `${unit.label} · ${grams} g${unit.estimatedFrom ? ' (est.)' : ''}`;
  }

  /* The measures, under Portions / Volume / Weight. An option's value is its
     index in `units`, which is what the rest of the picker works with. */
  function unitOptions(units) {
    const groups = new Map();
    units.forEach((unit, position) => {
      const option = el('option', null, unitOptionText(unit));
      option.value = String(position);
      if (!groups.has(unit.group)) groups.set(unit.group, []);
      groups.get(unit.group).push(option);
    });
    if (groups.size === 1) return [...groups.values()][0];
    return [...groups].map(([group, options]) => {
      const node = el('optgroup');
      node.label = GROUP_LABELS[group] || group;
      node.append(...options);
      return node;
    });
  }

  function estimateNote(units) {
    const estimated = units.find((unit) => unit.estimatedFrom);
    return estimated
      ? `USDA did not weigh a cup or spoon of this food; those weights are estimated from ${estimated.estimatedFrom.startsWith('other ') ? estimated.estimatedFrom : `“${estimated.estimatedFrom}”`}.`
      : '';
  }

  function pickerItem() {
    const { food, units } = picking;
    const amount = Number(nodes.amount.value);
    const unit = units[Number(nodes.unit.value)];
    if (!(amount > 0) || !unit) return null;
    return itemFor(food, unit, amount);
  }

  function updatePickerKcal() {
    const item = pickerItem();
    nodes.pickerKcal.textContent = item ? kcalText(itemKcal(item)) : 'Enter an amount.';
    nodes.submit.disabled = !item;
  }

  function showPicker(food, unit, amount, index = null) {
    closeForms();
    const units = unitsFor(food);
    picking = { food, units, index };
    nodes.pickerName.textContent = food.name;
    nodes.unit.replaceChildren(...unitOptions(units));
    nodes.pickerNote.textContent = estimateNote(units);
    // By label: unitsFor builds fresh objects on every call.
    nodes.unit.value = String(Math.max(0, units.findIndex((option) => option.label === unit.label)));
    nodes.unit.dataset.previous = nodes.unit.value;
    nodes.amount.value = String(amount);
    nodes.submit.textContent = index === null ? 'Add' : 'Save';
    nodes.remove.hidden = index === null;
    nodes.search.hidden = true;
    nodes.picker.hidden = false;
    updatePickerKcal();
    nodes.amount.focus();
    nodes.amount.select();
  }

  /* Opens on the measure and amount last used for this food, if any. */
  function openPicker(food) {
    const recent = recentFoods(context().entries, { limit: 200 });
    const { unit, amount } = defaultChoice(food, lastLogged(recent, food.name));
    showPicker(food, unit, amount);
  }

  async function openItem(index) {
    const item = foodsOf(context().entry)[index];
    if (!item) return;
    // The index has the food's other measures; without it, the one it was
    // logged with is still enough to change the amount.
    try {
      catalog = catalog || (await loadCatalog());
    } catch {
      /* edit with what the item carries */
    }
    const food = foodForItem(catalog, item);
    showPicker(food, unitForItem(food, item), item.quantity, index);
  }

  function closeForms() {
    picking = null;
    nodes.picker.hidden = true;
    nodes.custom.hidden = true;
    nodes.search.hidden = false;
  }

  /* Changing the measure keeps the same amount of food, not the same number:
     1 cup of oats switched to grams reads 81 g, not 1 g. */
  function onUnitChange(event) {
    const { units } = picking;
    const previous = units[Number(event.target.dataset.previous)];
    const next = units[Number(event.target.value)];
    const amount = Number(nodes.amount.value);
    const converted = previous && next && amount > 0 ? convertAmount(amount, previous, next) : null;
    if (converted !== null) nodes.amount.value = String(Math.round(converted * 100) / 100 || 0.01);
    event.target.dataset.previous = event.target.value;
    updatePickerKcal();
  }

  async function onPickerSubmit(event) {
    event.preventDefault();
    const item = pickerItem();
    if (!item) return;
    const { index } = picking;
    if (index === null) {
      if (await addItem(item)) closeForms();
      return;
    }
    const foods = [...foodsOf(context().entry)];
    foods[index] = item;
    if (await commit(foods, `Updated ${item.name} — ${kcalText(itemKcal(item))}.`)) closeForms();
  }

  async function removeItem(index) {
    const foods = [...foodsOf(context().entry)];
    const [removed] = foods.splice(index, 1);
    if (!removed) return;
    if (await commit(foods, `Removed ${removed.name}.`)) closeForms();
  }

  /* --- a food that isn't listed -------------------------------------- */

  function openCustom() {
    closeForms();
    nodes.search.hidden = true;
    nodes.custom.hidden = false;
    nodes.customName.value = nodes.query.value.trim();
    nodes.customKcal.value = '';
    nodes.customBasis.value = CUSTOM_BASES[0].key;
    (nodes.customName.value ? nodes.customKcal : nodes.customName).focus();
  }

  /* The food is defined by its energy per one basis; how much was eaten is
     then picked like any other food's, in whatever measures that basis
     allows. */
  function onCustomSubmit(event) {
    event.preventDefault();
    const name = nodes.customName.value.trim();
    const kcal = Number(nodes.customKcal.value);
    if (!name) { setStatus('Give the food a name.', 'error'); nodes.customName.focus(); return; }
    if (nodes.customKcal.value === '' || !(kcal >= 0)) {
      setStatus('Enter its calories.', 'error'); nodes.customKcal.focus(); return;
    }
    const { food, unit, amount } = customFood(name, kcal, nodes.customBasis.value);
    showPicker(food, unit, amount);
  }

  /* --- the day -------------------------------------------------------- */

  function renderItems(foods) {
    if (!foods.length) {
      nodes.items.replaceChildren(el('li', 'food-items__empty', 'Nothing logged for this day yet.'));
      return;
    }
    nodes.items.replaceChildren(
      ...foods.map((item, index) => {
        const row = el('li', 'food-item');
        const open = el('button', 'food-item__open');
        open.type = 'button';
        open.title = 'Change the amount';
        const amount = describeAmount(item);
        open.append(el('span', 'food-item__name', item.name));
        if (amount) open.append(el('span', 'food-item__amount', amount));
        open.addEventListener('click', () => openItem(index));
        const kcal = el('span', 'food-item__kcal', fmtInt(itemKcal(item)));
        const remove = el('button', 'row-btn food-item__remove', '×');
        remove.type = 'button';
        remove.title = `Remove ${item.name}`;
        remove.setAttribute('aria-label', `Remove ${item.name}`);
        remove.addEventListener('click', () => removeItem(index));
        row.append(open, kcal, remove);
        return row;
      }),
    );
  }

  function renderTotal(foods, entry, target, dateLabel) {
    nodes.date.textContent = dateLabel;
    const eaten = foods.length ? foods.reduce((sum, item) => sum + itemKcal(item), 0) : entry?.calories ?? 0;
    const left = target - eaten;
    nodes.total.replaceChildren(
      el('strong', null, fmtInt(eaten)),
      document.createTextNode(` of ${fmtInt(target)} kcal · `),
      el('span', left < 0 ? 'food-total__over' : 'food-total__left',
        left < 0 ? `${fmtInt(-left)} over` : `${fmtInt(left)} left`),
    );
    const share = target > 0 ? Math.min(1, eaten / target) : 0;
    nodes.meter.style.width = `${(share * 100).toFixed(1)}%`;
    nodes.meter.classList.toggle('meter__fill--over', left < 0);
  }

  function render() {
    const { entry, target, dateLabel } = context();
    const foods = foodsOf(entry);
    // A re-render after a save must not leave the picker editing an item
    // that has moved or gone.
    if (picking && picking.index !== null && !foods[picking.index]) closeForms();
    renderTotal(foods, entry, target, dateLabel);
    renderItems(foods);
    if (!nodes.search.hidden) showResults();
  }

  nodes.query.addEventListener('input', onQuery);
  nodes.query.addEventListener('focus', () => { loadCatalog().then((loaded) => { catalog = loaded; }).catch(() => {}); });
  nodes.query.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { nodes.query.value = ''; showResults(); }
  });
  nodes.customBasis.replaceChildren(
    ...CUSTOM_BASES.map((basis) => {
      const option = el('option', null, basis.label);
      option.value = basis.key;
      return option;
    }),
  );
  nodes.customOpen.addEventListener('click', openCustom);
  nodes.picker.addEventListener('submit', onPickerSubmit);
  nodes.amount.addEventListener('input', updatePickerKcal);
  nodes.unit.addEventListener('change', onUnitChange);
  nodes.remove.addEventListener('click', () => picking && picking.index !== null && removeItem(picking.index));
  $('#food-picker-cancel').addEventListener('click', closeForms);
  nodes.custom.addEventListener('submit', onCustomSubmit);
  $('#food-custom-cancel').addEventListener('click', closeForms);
  for (const form of [nodes.picker, nodes.custom]) {
    form.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeForms(); });
  }

  return { render, close: closeForms };
}
