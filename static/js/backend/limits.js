/* Domain limits for the browser backend — the mirror of tracker/config.py.
   tests/test_js_limits.py asserts these stay equal to the Python values, so a
   bound changed on one side cannot silently diverge from the other. */

import { WEEKDAYS } from '../format.js';

export const MIN_WEIGHT_KG = 10.0;
export const MAX_WEIGHT_KG = 700.0;
export const MIN_CALORIES = 0;
export const MAX_CALORIES = 20000;
export const MIN_TARGET = 1;
export const MAX_TARGET = 20000;
export const MAX_NOTE_LENGTH = 500;
export const MIN_YEAR = 1900;
export const MAX_YEAR = 2100;

export const UNITS = ['lb', 'kg'];

/* The week comes from format.js rather than a third copy of it. */
export const WEEKDAY_TARGET_FIELDS = WEEKDAYS.map((day) => `calorie_target_${day.key}`);
export const WEEKDAY_NAMES = Object.fromEntries(WEEKDAYS.map((day) => [day.key, day.name]));

export const DEFAULT_SETTINGS = Object.freeze({
  unit: 'lb',
  default_calorie_target: 2000,
  goal_weight_kg: null,
  goal_date: null,
  // Unset by default: an empty weekday falls back to the default target.
  ...Object.fromEntries(WEEKDAY_TARGET_FIELDS.map((field) => [field, null])),
});
