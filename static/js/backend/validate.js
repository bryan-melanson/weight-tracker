/* Boundary validation for the browser backend — the port of
   tracker/validation.py. Nothing reaches IndexedDB without passing through
   here. Every function is pure: it returns a new normalized value and never
   mutates its argument. */

import {
  DEFAULT_SETTINGS,
  MAX_CALORIES,
  MAX_NOTE_LENGTH,
  MAX_TARGET,
  MAX_WEIGHT_KG,
  MAX_YEAR,
  MIN_CALORIES,
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

const ENTRY_FIELDS = {
  weight_kg: (v) => validateFloat(v, 'weight_kg', MIN_WEIGHT_KG, MAX_WEIGHT_KG),
  calories: (v) => validateInt(v, 'calories', MIN_CALORIES, MAX_CALORIES),
  calories_burned: (v) => validateInt(v, 'calories_burned', MIN_CALORIES, MAX_CALORIES),
  calorie_target: (v) => validateInt(v, 'calorie_target', MIN_TARGET, MAX_TARGET),
  note: validateNote,
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
