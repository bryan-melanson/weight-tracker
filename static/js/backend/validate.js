/* Boundary validation for the browser backend — the port of
   tracker/validation.py. Nothing reaches IndexedDB without passing through
   here. Every function is pure: it returns a new normalized value and never
   mutates its argument. */

import {
  DEFAULT_SETTINGS,
  MAX_CALORIES,
  MAX_FOOD_NAME_LENGTH,
  MAX_FOOD_QUANTITY,
  MAX_FOODS_PER_DAY,
  MAX_NOTE_LENGTH,
  MAX_PORTION_GRAMS,
  MAX_PORTION_LENGTH,
  MAX_TARGET,
  MAX_WEIGHT_KG,
  MAX_YEAR,
  MIN_CALORIES,
  MIN_FOOD_QUANTITY,
  MIN_TARGET,
  MIN_WEIGHT_KG,
  MIN_YEAR,
  UNITS,
  WEEKDAY_NAMES,
  WEEKDAY_TARGET_FIELDS,
} from './limits.js';

/* Human-readable names for the fields, so an error message reads as a sentence
   rather than echoing an internal column name back at the user. */
export const FIELD_LABELS = {
  date: 'Date',
  weight_kg: 'Weight in kilograms',
  calories: 'Calories',
  calories_burned: 'Calories burned',
  calorie_target: 'Calorie target',
  note: 'Note',
  foods: 'Food log',
  unit: 'Unit',
  default_calorie_target: 'Daily calorie target',
  goal_weight_kg: 'Goal weight in kilograms',
  goal_date: 'Goal date',
  from: 'Range start',
  to: 'Range end',
  ...Object.fromEntries(
    Object.entries(WEEKDAY_NAMES).map(([day, name]) => [`calorie_target_${day}`, `${name} calorie target`]),
  ),
};

export const label = (field) => FIELD_LABELS[field] || field;

export class ValidationError extends Error {
  constructor(message, field = null) {
    super(message);
    this.name = 'ValidationError';
    this.message = message;
    this.field = field;
  }
}

const isBlank = (value) => value === null || value === undefined || (typeof value === 'string' && !value.trim());

/* Python's date.fromisoformat also accepts compact forms like "20261023";
   this is deliberately stricter, matching the YYYY-MM-DD the app documents. */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function validateDate(value, field = 'date') {
  if (typeof value !== 'string') {
    throw new ValidationError('Date must be a string in YYYY-MM-DD form.', field);
  }
  const text = value.trim();
  const match = ISO_DATE.exec(text);
  const [year, month, day] = match ? match.slice(1).map(Number) : [];
  // Round-tripping through Date catches a day that overflows its month.
  const parsed = match ? new Date(year, month - 1, day) : null;
  const real =
    parsed && parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day;
  if (!real) {
    throw new ValidationError(`'${text}' is not a valid YYYY-MM-DD date.`, field);
  }
  if (year < MIN_YEAR || year > MAX_YEAR) {
    throw new ValidationError(`Date must fall between ${MIN_YEAR} and ${MAX_YEAR}.`, field);
  }
  return text;
}

function validateFloat(value, field, low, high) {
  if (typeof value === 'boolean' || (typeof value === 'string' && !value.trim())) {
    throw new ValidationError(`${label(field)} must be a number.`, field);
  }
  const number = Number(value);
  if (value === null || Number.isNaN(number)) {
    throw new ValidationError(`${label(field)} must be a number.`, field);
  }
  if (!Number.isFinite(number)) {
    throw new ValidationError(`${label(field)} must be a finite number.`, field);
  }
  if (number < low || number > high) {
    throw new ValidationError(`${label(field)} must be between ${low} and ${high}.`, field);
  }
  return number;
}

function validateInt(value, field, low, high) {
  if (typeof value === 'boolean' || (typeof value === 'string' && !value.trim())) {
    throw new ValidationError(`${label(field)} must be a whole number.`, field);
  }
  const number = Number(value);
  if (value === null || !Number.isFinite(number) || !Number.isInteger(number)) {
    throw new ValidationError(`${label(field)} must be a whole number.`, field);
  }
  if (number < low || number > high) {
    throw new ValidationError(
      `${label(field)} must be between ${low.toLocaleString('en-US')} and ${high.toLocaleString('en-US')}.`,
      field,
    );
  }
  return number;
}

function validateNote(value, field = 'note') {
  if (typeof value !== 'string') {
    throw new ValidationError('Note must be text.', field);
  }
  const text = value.trim();
  if (text.length > MAX_NOTE_LENGTH) {
    throw new ValidationError(`Note must be ${MAX_NOTE_LENGTH} characters or fewer.`, field);
  }
  return text;
}

function validateUnit(value, field = 'unit') {
  if (typeof value !== 'string') {
    throw new ValidationError('Unit must be a string.', field);
  }
  const unit = value.trim().toLowerCase();
  if (!UNITS.includes(unit)) {
    throw new ValidationError(`Unit must be one of: ${UNITS.join(', ')}.`, field);
  }
  return unit;
}

export const FOOD_KEYS = ['name', 'portion', 'quantity', 'unit_kcal', 'unit_grams'];

function foodText(value, what, limit, required) {
  if ((value === null || value === undefined) && !required) return '';
  if (typeof value !== 'string') throw new ValidationError(`${what} must be text.`, 'foods');
  const text = value.trim();
  if (required && !text) throw new ValidationError(`${what} is required.`, 'foods');
  if (text.length > limit) {
    throw new ValidationError(`${what} must be ${limit} characters or fewer.`, 'foods');
  }
  if (/[\u0000-\u001f\u007f]/.test(text)) {
    throw new ValidationError(`${what} must not contain control characters.`, 'foods');
  }
  return text;
}

/* Numbers only, never numeric strings: items always arrive as JSON, and
   Number() and Python's float() disagree on strings like "1_000". Bounds
   print as Python's :g prints them, which String() matches for these. */
function foodNumber(value, what, low, high, lowInclusive = true) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new ValidationError(`${what} must be a number.`, 'foods');
  }
  if (!Number.isFinite(value)) throw new ValidationError(`${what} must be a finite number.`, 'foods');
  const tooLow = lowInclusive ? value < low : value <= low;
  if (tooLow || value > high) {
    const bound = lowInclusive ? `between ${low} and ${high}` : `above ${low} and at most ${high}`;
    throw new ValidationError(`${what} must be ${bound}.`, 'foods');
  }
  return value;
}

/* One item's energy, rounded half up — the same arithmetic as food_kcal in
   validation.py, so both backends total a day identically. */
export const foodKcal = (item) => Math.floor(item.quantity * item.unit_kcal + 0.5);

export const foodTotal = (foods) => (foods || []).reduce((sum, item) => sum + foodKcal(item), 0);

function validateFood(item, position) {
  const prefix = `Food ${position}`;
  if (item === null || typeof item !== 'object' || Array.isArray(item)) {
    throw new ValidationError(`${prefix} must be an object.`, 'foods');
  }
  const unknown = Object.keys(item).filter((key) => !FOOD_KEYS.includes(key)).sort();
  if (unknown.length) {
    throw new ValidationError(`${prefix} has unknown field(s): ${unknown.join(', ')}.`, 'foods');
  }
  for (const key of ['name', 'quantity', 'unit_kcal']) {
    if (!(key in item)) throw new ValidationError(`${prefix} is missing '${key}'.`, 'foods');
  }
  const grams = item.unit_grams;
  const food = {
    name: foodText(item.name, `${prefix} name`, MAX_FOOD_NAME_LENGTH, true),
    portion: foodText(item.portion, `${prefix} portion`, MAX_PORTION_LENGTH, false),
    quantity: foodNumber(item.quantity, `${prefix} quantity`, MIN_FOOD_QUANTITY, MAX_FOOD_QUANTITY),
    unit_kcal: foodNumber(item.unit_kcal, `${prefix} calories`, 0, MAX_CALORIES),
    unit_grams: grams === null || grams === undefined
      ? null
      : foodNumber(grams, `${prefix} grams`, 0, MAX_PORTION_GRAMS, false),
  };
  if (foodKcal(food) > MAX_CALORIES) {
    throw new ValidationError(`${prefix} comes to more than ${MAX_CALORIES.toLocaleString('en-US')} kcal.`, 'foods');
  }
  return food;
}

/* A day's food log: a list of items, or the same list as JSON text (how it
   arrives from a CSV cell). Returns normalized copies in a fixed key order,
   so the stored JSON is the same whichever backend wrote it. */
export function validateFoods(value, field = 'foods') {
  let list = value;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch {
      throw new ValidationError('Food log must be a JSON list.', field);
    }
  }
  if (!Array.isArray(list)) throw new ValidationError('Food log must be a list.', field);
  if (list.length > MAX_FOODS_PER_DAY) {
    throw new ValidationError(`A day can hold at most ${MAX_FOODS_PER_DAY} foods.`, field);
  }
  const foods = list.map((item, index) => validateFood(item, index + 1));
  if (foodTotal(foods) > MAX_CALORIES) {
    throw new ValidationError(`The day's foods come to more than ${MAX_CALORIES.toLocaleString('en-US')} kcal.`, field);
  }
  return foods;
}

/* The exported form: compact JSON, keys in FOOD_KEYS order — byte-identical
   to encode_foods in validation.py. */
export const encodeFoods = (foods) =>
  JSON.stringify(foods.map((item) => Object.fromEntries(FOOD_KEYS.map((key) => [key, item[key]]))));

const ENTRY_FIELDS = {
  weight_kg: (v) => validateFloat(v, 'weight_kg', MIN_WEIGHT_KG, MAX_WEIGHT_KG),
  calories: (v) => validateInt(v, 'calories', MIN_CALORIES, MAX_CALORIES),
  calories_burned: (v) => validateInt(v, 'calories_burned', MIN_CALORIES, MAX_CALORIES),
  calorie_target: (v) => validateInt(v, 'calorie_target', MIN_TARGET, MAX_TARGET),
  note: validateNote,
  foods: validateFoods,
};

const SETTINGS_FIELDS = {
  unit: validateUnit,
  default_calorie_target: (v) => validateInt(v, 'default_calorie_target', MIN_TARGET, MAX_TARGET),
  goal_weight_kg: (v) => validateFloat(v, 'goal_weight_kg', MIN_WEIGHT_KG, MAX_WEIGHT_KG),
  goal_date: (v) => validateDate(v, 'goal_date'),
  // Bind the field name, so a rejected value names the weekday it came from.
  ...Object.fromEntries(
    WEEKDAY_TARGET_FIELDS.map((field) => [field, (v) => validateInt(v, field, MIN_TARGET, MAX_TARGET)]),
  ),
};

/* Fields that may be cleared by sending null or an empty string. */
const NULLABLE = new Set([
  'weight_kg',
  'calories',
  'calories_burned',
  'calorie_target',
  'note',
  'foods',
  'goal_weight_kg',
  'goal_date',
  ...WEEKDAY_TARGET_FIELDS,
]);

function validatePatch(patch, validators, kind) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new ValidationError(`${kind} must be a JSON object.`);
  }
  const unknown = Object.keys(patch).filter((field) => !(field in validators)).sort();
  if (unknown.length) {
    throw new ValidationError(`Unknown field(s): ${unknown.join(', ')}.`, unknown[0]);
  }
  const result = {};
  for (const [field, raw] of Object.entries(patch)) {
    result[field] = isBlank(raw) && NULLABLE.has(field) ? null : validators[field](raw);
  }
  return result;
}

/* Return a normalized copy of a daily-entry patch. */
export const validateEntryPatch = (patch) => validatePatch(patch, ENTRY_FIELDS, 'Entry');

/* Return a normalized copy of a settings patch. */
export const validateSettingsPatch = (patch) => validatePatch(patch, SETTINGS_FIELDS, 'Settings');

export const ENTRY_COLUMNS = Object.keys(ENTRY_FIELDS);
export const SETTINGS_COLUMNS = Object.keys(DEFAULT_SETTINGS);
