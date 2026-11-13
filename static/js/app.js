/* Application shell: load state, keep the forms and the range filter in sync,
   and re-render the KPI row, the three charts and the table from one place. */

import { api, mode } from './api.js';
import { createBackupService } from './backup/service.js';
import { mountFoodPanel } from './foods/panel.js';
import { mountBackupPanel } from './backup/panel.js';
import { offerFile } from './download.js';
import { ensurePersisted } from './persistence.js';
import { registerServiceWorker } from './pwa.js';
import {
  HEIGHT_UNIT,
  UNIT_STEP,
  WEEKDAYS,
  addDays,
  fmtDateLong,
  fmtHeight,
  fmtInt,
  fmtWeight,
  roundTo,
  toDisplayHeight,
  toDisplayWeight,
  toHeightCm,
  toKg,
  todayISO,
} from './format.js';
import { renderKpis } from './kpis.js';
import {
  ACTIVITY_LEVELS,
  DEFAULT_ACTIVITY_LEVEL,
  activityShortLabel,
  ageOn,
  maintenanceProfile,
  restingKcal,
  weightLookup,
} from './maintenance.js';
import { WEEKLY_THRESHOLD_DAYS, caloriePoints, inRange, summarize, targetForDate } from './stats.js';
import { renderTable } from './table.js';
import { mountTabs } from './tabs.js';
import { mountChart, token } from './charts/core.js';
import { drawWeightChart, goalFitsView, renderWeightLegend } from './charts/weight.js';
import { caloriesSeries, drawCaloriesChart, renderCaloriesLegend } from './charts/calories.js';
import { drawBalanceChart, renderBalanceLegend } from './charts/balance.js';

const RANGES = [
  { key: '30d', label: 'the last 30 days', short: '30 days', days: 30 },
  { key: '90d', label: 'the last 90 days', short: '90 days', days: 90 },
  { key: '1y', label: 'the last year', short: '1 year', days: 365 },
  { key: 'all', label: 'all time', short: 'All', days: null },
];
/* The tabbed views below the range filter: three charts and the table, one
   at a time. `chart` names the entry in `charts` to redraw when the tab is
   opened, since a panel measures zero wide while it is hidden. */
const VIEWS = [
  { key: 'weight', label: 'Weight', panel: '#chart-weight', chart: 'weight' },
  { key: 'calories', label: 'Calories', panel: '#chart-calories', chart: 'calories' },
  { key: 'balance', label: 'Balance', panel: '#chart-balance', chart: 'balance' },
  { key: 'days', label: 'Logged days', panel: '#panel-table', chart: null },
];

const SETTINGS_TABS = [
  { key: 'targets', label: 'Targets', panel: '#targets-form' },
  { key: 'profile', label: 'Profile', panel: '#profile-form' },
];

const THEME_KEY = 'weight-tracker:theme';
const RANGE_KEY = 'weight-tracker:range';
const VIEW_KEY = 'weight-tracker:view';
const SETTINGS_TAB_KEY = 'weight-tracker:settings-tab';

const $ = (selector) => document.querySelector(selector);
const state = { settings: null, entries: [], rangeKey: localStorage.getItem(RANGE_KEY) || '90d' };

/* Backups: the service owns the state, the panel draws it. Created before
   boot so a stored config is picked up on the first render. */
const backup = createBackupService({
  api,
  storage: localStorage,
  onChange: (backupState) => {
    if (!backupPanel) return;
    backupPanel.render(backupState);
    renderSubtitle();
  },
});
let backupPanel = null;
let foodPanel = null;
let views = null;
/* The props each chart would draw from, kept so the one behind a tab can be
   drawn the moment that tab is opened. */
let chartProps = {};

const charts = {
  weight: mountChart($('#chart-weight .chart-card__plot'), drawWeightChart),
  calories: mountChart($('#chart-calories .chart-card__plot'), drawCaloriesChart),
  balance: mountChart($('#chart-balance .chart-card__plot'), drawBalanceChart),
};

/* --- status line ------------------------------------------------------- */

let statusTimer = null;
function setStatus(message, kind = 'info') {
  const node = $('#status');
  node.textContent = message;
  node.dataset.kind = kind;
  node.hidden = !message;
  clearTimeout(statusTimer);
  if (message && kind !== 'error') statusTimer = setTimeout(() => { node.hidden = true; }, 4000);
}

/* --- range ------------------------------------------------------------- */

function activeRange() {
  const option = RANGES.find((item) => item.key === state.rangeKey) || RANGES[1];
  const lastLogged = state.entries.length ? state.entries[state.entries.length - 1].date : null;
  const today = todayISO();
  const to = lastLogged && lastLogged > today ? lastLogged : today;
  if (option.days === null) {
    const first = state.entries.length ? state.entries[0].date : to;
    return { from: first, to, label: option.label, option };
  }
  return { from: addDays(to, -(option.days - 1)), to, label: option.label, option };
}

function renderRangeFilter() {
  const container = $('#range-filter');
  container.replaceChildren(
    ...RANGES.map((option) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = option.short;
      button.setAttribute('aria-pressed', String(option.key === state.rangeKey));
      button.addEventListener('click', () => {
        state.rangeKey = option.key;
        localStorage.setItem(RANGE_KEY, option.key);
        renderRangeFilter();
        render();
      });
      return button;
    })
  );
}

/* A chart drawn into a hidden panel has no width to measure, so the one
   being opened is redrawn on the way in. Only the visible chart is kept up to
   date by render() for the same reason. */
function mountViewTabs() {
  views = mountTabs({
    list: $('#view-tabs'),
    tabs: VIEWS.map((view) => ({ ...view, panel: $(view.panel) })),
    storage: localStorage,
    storageKey: VIEW_KEY,
    onSelect: (key, { changed }) => {
      if (changed) refreshVisibleChart();
    },
  });
}

function visibleView() {
  const key = views ? views.selected() : VIEWS[0].key;
  return VIEWS.find((view) => view.key === key) || VIEWS[0];
}

/* --- rendering --------------------------------------------------------- */

function syncUnitLabels() {
  const unit = state.settings.unit;
  document.querySelectorAll('.unit-label').forEach((node) => { node.textContent = unit; });
  document.querySelectorAll('.height-unit-label').forEach((node) => {
    node.textContent = HEIGHT_UNIT[unit];
  });
  const step = String(UNIT_STEP[unit]);
  $('#entry-weight').step = step;
  $('#setting-goal-weight').step = step;
}

function weightNote(summary, settings, range) {
  const parts = [];
  const { projection, slopePerDay, current } = summary;
  if (slopePerDay && Math.abs(slopePerDay) > 0.0005) {
    const perWeek = slopePerDay * 7;
    parts.push(
      `Recent trend: ${fmtWeight(Math.abs(perWeek), settings.unit)} per week ${perWeek < 0 ? 'down' : 'up'}.`
    );
  }
  if (projection && projection.iso && settings.goal_weight_kg !== null) {
    parts.push(`At that rate the goal lands around ${fmtDateLong(projection.iso)}.`);
  }
  if (settings.goal_weight_kg !== null && current && !goalFitsView(summary.weights, settings.goal_weight_kg)) {
    parts.push(`Goal ${fmtWeight(settings.goal_weight_kg, settings.unit)} sits outside this view.`);
  }
  if (settings.goal_date) parts.push(`Target date: ${fmtDateLong(settings.goal_date)}.`);
  return parts.join(' ');
}

/* Exercise is optional, so the charts only mention it once it is being logged. */
function exerciseNote(summary) {
  if (!summary.burnDays) return '';
  const average = summary.avgBurned === null ? '' : `, averaging ${fmtInt(summary.avgBurned)} kcal`;
  return ` Exercise logged on ${summary.burnDays} day${summary.burnDays === 1 ? '' : 's'}${average}, already netted out above.`;
}

/* What the running balance is summed against, named in the chart's own words.
   Measuring against estimated maintenance makes the total an estimated energy
   deficit; measuring against the targets makes it an adherence score. */
function balanceSubtitle(summary, settings) {
  if (summary.balanceBasis !== 'maintenance') {
    return "Sum of each day's intake, less exercise, minus that day's target. Below zero is a deficit.";
  }
  const level = activityShortLabel(settings.activity_level).toLowerCase();
  return `Sum of each day's intake, less exercise, minus the maintenance level estimated for that day — ${level}, from the weight you were carrying then. Below zero is a deficit.`;
}

function balanceNote(summary) {
  if (summary.netKg === null) return '';
  const parts = [];
  const average = summary.avgBalanceDiff;
  if (summary.balanceBasis === 'maintenance' && average !== null) {
    const side = average > 0 ? 'above' : 'below';
    parts.push(
      `Averaging ${fmtInt(Math.abs(average))} kcal/day ${side} the estimate. Maintenance is an` +
        ' estimate, so this total is one too — the trend on the Weight tab is the measurement to' +
        ' check it against.'
    );
  }
  parts.push(
    summary.burnDays
      ? `Exercise counts only on the ${summary.burnDays} day${summary.burnDays === 1 ? '' : 's'} you logged it, and nothing estimates the rest, so treat the body-mass equivalent as a rough guide.`
      : 'No exercise is logged in this range, so nothing is netted out of intake — treat the body-mass equivalent as a rough guide.'
  );
  return parts.join(' ');
}

/* The one line that says where the data lives. Redrawn whenever the backup
   state changes as well as on every render, so it never claims the data is
   device-only after a backup has been switched on. */
function renderSubtitle() {
  const where = mode === 'http' ? 'this machine' : 'this device';
  const { configured, repo } = backup.state();
  const kept = configured ? `backed up to ${repo}` : `stored on ${where} only`;
  const days = state.entries.length;
  $('#topbar-sub').textContent = days
    ? `${days} day${days === 1 ? '' : 's'} logged · data ${kept}`
    : `Local data, ${kept}.`;
}

function render() {
  const settings = state.settings;
  const range = activeRange();
  const summary = summarize(state.entries, settings, range);
  syncUnitLabels();

  renderSubtitle();

  renderKpis($('#kpis'), summary, settings, range.option.short.toLowerCase() === 'all' ? 'all time' : range.option.short);
  renderProfileEstimate();

  const goalDrawn = goalFitsView(summary.weights, settings.goal_weight_kg);
  renderWeightLegend($('#chart-weight .chart-card__legend'), settings, goalDrawn);
  $('#chart-weight .chart-card__sub').textContent =
    `Logged readings and their 7-day average over ${range.label}.`;
  $('#chart-weight .chart-card__note').textContent = weightNote(summary, settings, range);
  const weightProps = { weights: summary.weights, settings, range };

  const daysInRange = summary.daysInRange;
  const series = caloriesSeries(summary.calories, daysInRange);
  renderCaloriesLegend($('#chart-calories .chart-card__legend'));
  $('#chart-calories .chart-card__sub').textContent = series.weekly
    ? `How far each week's average intake, less exercise, sat from target over ${range.label} — weeks, not days, past ${WEEKLY_THRESHOLD_DAYS} days in view.`
    : `How far each day's intake, less any exercise, sat from that day's target over ${range.label}.`;
  $('#chart-calories .chart-card__note').textContent = summary.avgDiff === null
    ? ''
    : `${summary.calories.length} day${summary.calories.length === 1 ? '' : 's'} with calories logged, averaging ${fmtInt(Math.abs(summary.avgDiff))} kcal ${summary.avgDiff > 0 ? 'over' : 'under'} target per day.${exerciseNote(summary)}`;
  const caloriesProps = { points: series.points, weekly: series.weekly, settings, range };

  renderBalanceLegend($('#chart-balance .chart-card__legend'), summary.balanceBasis);
  $('#chart-balance .chart-card__sub').textContent = balanceSubtitle(summary, settings);
  $('#chart-balance .chart-card__note').textContent = balanceNote(summary);
  const balanceProps = {
    balance: summary.balance,
    deficits: summary.deficits,
    basis: summary.balanceBasis,
    settings,
    range,
  };

  renderTable($('#entries-table tbody'), summary.scoped, settings, { onEdit: loadEntryIntoForm, onDelete: deleteEntry });

  // Every panel's words are written above whether it is open or not, so a tab
  // opens on current text; only the plot it holds waits until it is visible.
  chartProps = { weight: weightProps, calories: caloriesProps, balance: balanceProps };
  refreshVisibleChart();
}

function refreshVisibleChart() {
  const { chart } = visibleView();
  if (chart && chartProps[chart]) charts[chart].refresh(chartProps[chart]);
}

/* --- forms ------------------------------------------------------------- */

function fillTargetsForm() {
  const settings = state.settings;
  $('#setting-unit').value = settings.unit;
  $('#setting-target').value = settings.default_calorie_target;
  $('#setting-goal-weight').value =
    settings.goal_weight_kg === null ? '' : roundTo(toDisplayWeight(settings.goal_weight_kg, settings.unit), 1);
  $('#setting-goal-date').value = settings.goal_date || '';
  WEEKDAYS.forEach(({ key }) => {
    const input = $(`#setting-target-${key}`);
    const value = settings[`calorie_target_${key}`];
    input.value = value === null || value === undefined ? '' : value;
    // A blank weekday follows the default, so show which number that is.
    input.placeholder = String(settings.default_calorie_target);
  });
}

function fillActivityOptions() {
  $('#setting-activity').replaceChildren(
    ...ACTIVITY_LEVELS.map((level) => {
      const option = document.createElement('option');
      option.value = level.key;
      option.textContent = level.label;
      return option;
    })
  );
}

function fillProfileForm() {
  const settings = state.settings;
  const unit = settings.unit;
  $('#setting-height').value =
    (settings.height_cm ?? null) === null ? '' : roundTo(toDisplayHeight(settings.height_cm, unit), 1);
  $('#setting-birth-date').value = settings.birth_date || '';
  $('#setting-sex').value = settings.sex || '';
  // An unset level reads as the default, which is what the estimate uses too.
  $('#setting-activity').value = settings.activity_level || DEFAULT_ACTIVITY_LEVEL;
  $('#setting-birth-date').max = todayISO();
}

/* The estimate as it stands, under the fields that feed it: the numbers going
   in, so a wrong one is visible, and what is still missing when it cannot be
   made at all. It is about today rather than about the selected range, so it
   reads from the latest weight logged however far back that is. */
function renderProfileEstimate() {
  const settings = state.settings;
  const node = $('#profile-estimate');
  const profile = maintenanceProfile(settings);
  if (!profile) {
    const missing = [
      (settings.height_cm ?? null) === null ? 'height' : null,
      settings.birth_date ? null : 'date of birth',
      settings.sex ? null : 'sex',
    ].filter(Boolean);
    node.textContent =
      `Add ${andList(missing)} to estimate your maintenance level. ` +
      'Until then the running balance measures against your targets.';
    return;
  }
  const today = todayISO();
  const kg = weightLookup(state.entries).at(today);
  if (kg === null) {
    node.textContent = 'Log a weight and the estimate appears here.';
    return;
  }
  const age = ageOn(today, profile.birthDate);
  const resting = restingKcal({ kg, heightCm: profile.heightCm, ageYears: age, sex: profile.sex });
  node.replaceChildren(
    document.createTextNode('Maintenance ≈ '),
    Object.assign(document.createElement('strong'), {
      textContent: `${fmtInt(resting * profile.factor)} kcal/day`,
    }),
    document.createTextNode(
      ` — ${fmtInt(resting)} at rest × ${profile.factor} for ` +
        `${activityShortLabel(profile.level).toLowerCase()}, at ${fmtWeight(kg, settings.unit)}, ` +
        `${fmtHeight(profile.heightCm, settings.unit)}, age ${age}.`
    )
  );
}

/* "height and sex", "height, date of birth and sex": a list to read, not a
   row of commas. */
function andList(items) {
  if (items.length < 2) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function entryFor(date) {
  return state.entries.find((entry) => entry.date === date) || null;
}

function loadEntryIntoForm(entry) {
  $('#entry-date').value = entry.date;
  syncFormToDate();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* Once a day has foods, its calories are their total — the store enforces
   it, and the field says so rather than offering a number it would ignore.
   Kept apart from syncFormToDate so a food saved while the rest of the form
   is half-typed still updates it. */
function syncCaloriesField() {
  const entry = entryFor($('#entry-date').value);
  const fromFoods = Boolean(entry && entry.foods && entry.foods.length);
  const input = $('#entry-calories');
  input.disabled = fromFoods;
  if (fromFoods) input.value = entry.calories;
  $('#entry-calories-hint').textContent = fromFoods ? 'from the food list' : '';
}

function foodContext() {
  const date = $('#entry-date').value || todayISO();
  const entry = entryFor(date);
  const target = entry && entry.calorie_target !== null && entry.calorie_target !== undefined
    ? entry.calorie_target
    : targetForDate(date, state.settings);
  return {
    date,
    entry,
    entries: state.entries,
    target,
    dateLabel: date === todayISO() ? 'today' : fmtDateLong(date),
  };
}

async function saveFoods(date, foods, message) {
  const turn = beginAction();
  try {
    await api.saveEntry(date, { foods });
    await dataChanged(turn);
    if (turn.isCurrent()) setStatus(message, 'success');
    return true;
  } catch (error) {
    if (turn.isCurrent()) setStatus(error.message, 'error');
    return false;
  }
}

function syncFormToDate() {
  const date = $('#entry-date').value;
  const entry = entryFor(date);
  const unit = state.settings.unit;
  // The target this day falls under, before any one-off override for it.
  $('#entry-target').placeholder = String(
    date ? targetForDate(date, state.settings) : state.settings.default_calorie_target
  );
  $('#entry-weight').value =
    entry && entry.weight_kg !== null ? roundTo(toDisplayWeight(entry.weight_kg, unit), 1) : '';
  $('#entry-calories').value = entry && entry.calories !== null ? entry.calories : '';
  $('#entry-burned').value = entry && entry.calories_burned !== null ? entry.calories_burned : '';
  $('#entry-target').value = entry && entry.calorie_target !== null ? entry.calorie_target : '';
  $('#entry-note').value = (entry && entry.note) || '';
  $('#entry-delete').disabled = !entry;
  syncCaloriesField();
  if (foodPanel) foodPanel.render();
}

/* Server-side field names, mapped to the input that carries them. */
const FIELD_TO_INPUT = {
  weight_kg: 'weight',
  goal_weight_kg: 'goal_weight',
  height_cm: 'height',
  default_calorie_target: 'default_calorie_target',
  calorie_target: 'calorie_target',
};

function clearFieldErrors(form) {
  form.querySelectorAll('[aria-invalid]').forEach((node) => node.removeAttribute('aria-invalid'));
}

function markField(form, field) {
  const node = form.querySelector(`[name="${field}"]`);
  if (node) {
    node.setAttribute('aria-invalid', 'true');
    node.focus();
  }
}

/* Reloading after a save refills both forms from the stored data. That is
   right when the user is waiting on it and wrong the moment they have started
   typing again — a save that lands mid-entry would wipe what they are part way
   through, and on a phone the save is a network round trip away. So every
   action notes how many edits each form had seen when it began, and a reload
   only refills a form nobody has touched since.

   The same snapshot settles the status line: a save finishing after a later
   one started must not write its result over the newer one, or a slow save
   landing after a rejected one replaces the error with "Saved" and the user
   is told their rejected entry went in. */
let currentTurn = 0;
let entryEdits = 0;
let targetEdits = 0;
let profileEdits = 0;

function beginAction() {
  const turn = (currentTurn += 1);
  const entry = entryEdits;
  const targets = targetEdits;
  const profile = profileEdits;
  return {
    isCurrent: () => turn === currentTurn,
    entryUntouched: () => entry === entryEdits,
    targetsUntouched: () => targets === targetEdits,
    profileUntouched: () => profile === profileEdits,
  };
}

async function withErrors(form, action, successMessage) {
  const turn = beginAction();
  clearFieldErrors(form);
  try {
    await action();
    await dataChanged(turn);
    if (turn.isCurrent()) setStatus(successMessage, 'success');
  } catch (error) {
    if (!turn.isCurrent()) return;
    if (error.field) markField(form, FIELD_TO_INPUT[error.field] || error.field);
    setStatus(error.message, 'error');
  }
}

/* One place for "the data changed": re-read it, ask the browser to hold on to
   it, and push a backup if one is configured. The backup runs unawaited —
   its own status line reports it, and a failure leaves the change pending. */
async function dataChanged(turn = null) {
  await reload(turn);
  ensurePersisted();
  backup.markChanged();
}

function blankToNull(value) {
  return value === '' || value === null ? null : value;
}

function onEntrySubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const date = $('#entry-date').value;
  if (!date) {
    setStatus('Pick a date for the entry.', 'error');
    markField(form, 'date');
    return;
  }
  const weightInput = $('#entry-weight').value;
  const patch = {
    weight_kg: weightInput === '' ? null : toKg(weightInput, state.settings.unit),
    calories: blankToNull($('#entry-calories').value),
    calories_burned: blankToNull($('#entry-burned').value),
    calorie_target: blankToNull($('#entry-target').value),
    note: $('#entry-note').value,
  };
  // A day with foods takes its calories from them; the field is only a view.
  if ($('#entry-calories').disabled) delete patch.calories;
  withErrors(form, () => api.saveEntry(date, patch), `Saved ${fmtDateLong(date)}.`);
}

function onTargetsSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const unit = $('#setting-unit').value;
  const goalInput = $('#setting-goal-weight').value;
  const patch = {
    unit,
    default_calorie_target: $('#setting-target').value,
    goal_weight_kg: goalInput === '' ? null : toKg(goalInput, unit),
    goal_date: blankToNull($('#setting-goal-date').value),
    ...Object.fromEntries(
      WEEKDAYS.map(({ key }) => [`calorie_target_${key}`, blankToNull($(`#setting-target-${key}`).value)])
    ),
  };
  withErrors(form, () => api.saveSettings(patch), 'Targets saved.');
}

function onProfileSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const unit = state.settings.unit;
  const heightInput = $('#setting-height').value;
  const patch = {
    height_cm: heightInput === '' ? null : toHeightCm(heightInput, unit),
    birth_date: blankToNull($('#setting-birth-date').value),
    sex: blankToNull($('#setting-sex').value),
    activity_level: $('#setting-activity').value,
  };
  withErrors(form, () => api.saveSettings(patch), 'Profile saved.');
}

async function deleteEntry(entry) {
  const label = fmtDateLong(entry.date);
  if (!window.confirm(`Delete the entry for ${label}? This cannot be undone.`)) return;
  const turn = beginAction();
  try {
    await api.deleteEntry(entry.date);
    await dataChanged(turn);
    if (turn.isCurrent()) setStatus(`Deleted ${label}.`, 'success');
  } catch (error) {
    if (turn.isCurrent()) setStatus(error.message, 'error');
  }
}

async function onExport() {
  try {
    const csv = await api.exportCsv();
    const result = await offerFile(`weight-tracker-${todayISO()}.csv`, csv);
    if (result === 'shared') setStatus('Exported.', 'success');
  } catch (error) {
    setStatus(`Could not export: ${error.message}`, 'error');
  }
}

async function onImport(event) {
  const [file] = event.target.files;
  event.target.value = '';
  if (!file) return;
  const turn = beginAction();
  try {
    const result = await api.importCsv(await file.text());
    // An import replaces the data wholesale, so both forms are refilled even
    // if something was half-typed: what is on screen is no longer the truth.
    await dataChanged();
    if (turn.isCurrent()) {
      setStatus(`Imported ${result.imported} day${result.imported === 1 ? '' : 's'} from ${file.name}.`, 'success');
    }
  } catch (error) {
    if (turn.isCurrent()) setStatus(error.message, 'error');
  }
}

/* --- theme ------------------------------------------------------------- */

function applyTheme(theme) {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  const dark = theme
    ? theme === 'dark'
    : window.matchMedia('(prefers-color-scheme: dark)').matches;
  const button = $('#theme-toggle');
  button.setAttribute('aria-pressed', String(dark));
  $('#theme-toggle-label').textContent = dark ? 'Light mode' : 'Dark mode';
}

function toggleTheme() {
  const dark = $('#theme-toggle').getAttribute('aria-pressed') === 'true';
  const next = dark ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
  render();
}

/* --- boot -------------------------------------------------------------- */

async function reload(turn = null) {
  const data = await api.getState();
  // A changed unit changes what the numbers already in the forms mean, so
  // those two forms are refilled even if they were being typed in: leaving a
  // height in inches sitting in a field now labelled cm would save a wrong
  // value the next time that form is submitted.
  const unitChanged = Boolean(state.settings) && state.settings.unit !== data.settings.unit;
  state.settings = data.settings;
  state.entries = data.entries;
  if (!turn || unitChanged || turn.targetsUntouched()) fillTargetsForm();
  if (!turn || unitChanged || turn.profileUntouched()) fillProfileForm();
  if (!turn || turn.entryUntouched()) syncFormToDate();
  syncCaloriesField();
  render();
  foodPanel.render();
}

function wireEvents() {
  $('#entry-form').addEventListener('submit', onEntrySubmit);
  $('#targets-form').addEventListener('submit', onTargetsSubmit);
  $('#profile-form').addEventListener('submit', onProfileSubmit);
  $('#entry-form').addEventListener('input', () => { entryEdits += 1; });
  $('#targets-form').addEventListener('input', () => { targetEdits += 1; });
  $('#profile-form').addEventListener('input', () => { profileEdits += 1; });
  $('#entry-date').addEventListener('change', syncFormToDate);
  $('#entry-delete').addEventListener('click', () => {
    const entry = entryFor($('#entry-date').value);
    if (entry) deleteEntry(entry);
  });
  $('#theme-toggle').addEventListener('click', toggleTheme);
  $('#export-btn').addEventListener('click', onExport);
  $('#import-btn').addEventListener('click', () => $('#import-input').click());
  $('#import-input').addEventListener('change', onImport);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!localStorage.getItem(THEME_KEY)) { applyTheme(null); render(); }
  });
}

async function boot() {
  registerServiceWorker();
  applyTheme(localStorage.getItem(THEME_KEY));
  $('#entry-date').max = todayISO();
  $('#entry-date').value = todayISO();
  fillActivityOptions();
  mountViewTabs();
  mountTabs({
    list: $('#settings-tabs'),
    tabs: SETTINGS_TABS.map((tab) => ({ ...tab, panel: $(tab.panel) })),
    storage: localStorage,
    storageKey: SETTINGS_TAB_KEY,
  });
  renderRangeFilter();
  wireEvents();
  backupPanel = mountBackupPanel({ service: backup, onDataChanged: dataChanged, setStatus });
  backupPanel.render(backup.state());
  foodPanel = mountFoodPanel({ context: foodContext, save: saveFoods, setStatus });
  try {
    await reload();
  } catch (error) {
    setStatus(`Could not load data: ${error.message}`, 'error');
  }
}

boot();
