import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { WEEKDAY_TARGET_FIELDS } from '../../static/js/backend/limits.js';
import {
  ValidationError,
  validateDate,
  validateEntryPatch,
  validateSettingsPatch,
} from '../../static/js/backend/validate.js';

/* Mirrors tests/test_validation.py: the browser backend has to reject exactly
   what the Python server rejects, with the same field names and sentences. */

const throws = (fn, field) => {
  let error = null;
  try {
    fn();
  } catch (caught) {
    error = caught;
  }
  assert.ok(error instanceof ValidationError, `expected a ValidationError, got ${error}`);
  if (field !== undefined) assert.equal(error.field, field);
  return error;
};

describe('validateDate', () => {
  it('accepts an ISO date', () => {
    assert.equal(validateDate('2026-10-23'), '2026-10-23');
  });

  it('strips whitespace', () => {
    assert.equal(validateDate('  2026-10-23 '), '2026-10-23');
  });

  for (const bad of ['', '23-10-2026', '2026-13-01', '2026-10-32', 'today', null, 42, '1899-01-01', '2200-01-01']) {
    it(`rejects ${JSON.stringify(bad)}`, () => {
      throws(() => validateDate(bad), 'date');
    });
  }

  it('names the field it was given', () => {
    throws(() => validateDate('nope', 'goal_date'), 'goal_date');
  });
});

describe('validateEntryPatch', () => {
  it('normalizes fields', () => {
    assert.deepEqual(
      validateEntryPatch({ weight_kg: '80.5', calories: '2100', calorie_target: 2000 }),
      { weight_kg: 80.5, calories: 2100, calorie_target: 2000 },
    );
  });

  it('does not mutate its input', () => {
    const source = { weight_kg: '80.5' };
    validateEntryPatch(source);
    assert.deepEqual(source, { weight_kg: '80.5' });
  });

  it('allows an explicit null to clear', () => {
    assert.deepEqual(validateEntryPatch({ weight_kg: null }), { weight_kg: null });
  });

  it('treats a blank string as clearing the value', () => {
    assert.deepEqual(validateEntryPatch({ calories: '' }), { calories: null });
  });

  it('trims and limits the note', () => {
    assert.deepEqual(validateEntryPatch({ note: '  hi  ' }), { note: 'hi' });
    throws(() => validateEntryPatch({ note: 'x'.repeat(501) }), 'note');
  });

  it('rejects an unknown field', () => {
    throws(() => validateEntryPatch({ nope: 1 }), 'nope');
  });

  for (const bad of [[1, 2], 'text', 42, null]) {
    it(`rejects a non-object patch: ${JSON.stringify(bad)}`, () => {
      throws(() => validateEntryPatch(bad));
    });
  }

  for (const weight of [0, -5, 9.9, 700.1, 'heavy', NaN, Infinity, true]) {
    it(`rejects out-of-range weight ${weight}`, () => {
      throws(() => validateEntryPatch({ weight_kg: weight }), 'weight_kg');
    });
  }

  for (const calories of [-1, 20001, 'lots', 1.5, true]) {
    it(`rejects bad calories ${calories}`, () => {
      throws(() => validateEntryPatch({ calories }), 'calories');
    });
  }

  it('normalizes calories burned', () => {
    assert.deepEqual(validateEntryPatch({ calories_burned: '450' }), { calories_burned: 450 });
  });

  it('treats a blank string as clearing calories burned', () => {
    assert.deepEqual(validateEntryPatch({ calories_burned: '' }), { calories_burned: null });
  });

  for (const burned of [-1, 20001, 'a jog', 1.5, true]) {
    it(`rejects bad calories burned ${burned}`, () => {
      throws(() => validateEntryPatch({ calories_burned: burned }), 'calories_burned');
    });
  }

  it('names calories burned in plain language', () => {
    const error = throws(() => validateEntryPatch({ calories_burned: -1 }), 'calories_burned');
    assert.match(error.message, /^Calories burned/);
  });

  it('allows an empty patch', () => {
    assert.deepEqual(validateEntryPatch({}), {});
  });
});

describe('validateSettingsPatch', () => {
  it('normalizes fields', () => {
    assert.deepEqual(
      validateSettingsPatch({
        unit: 'LB',
        default_calorie_target: '2000',
        goal_weight_kg: '75',
        goal_date: '2026-12-31',
      }),
      { unit: 'lb', default_calorie_target: 2000, goal_weight_kg: 75, goal_date: '2026-12-31' },
    );
  });

  it('accepts a target for each weekday', () => {
    const patch = {};
    WEEKDAY_TARGET_FIELDS.forEach((field, index) => { patch[field] = 1800 + index * 50; });
    assert.deepEqual(validateSettingsPatch(patch), patch);
  });

  it('normalizes a weekday target', () => {
    assert.deepEqual(validateSettingsPatch({ calorie_target_mon: '2100' }), { calorie_target_mon: 2100 });
  });

  it('lets a blank weekday target fall back to the default', () => {
    assert.deepEqual(validateSettingsPatch({ calorie_target_sat: '' }), { calorie_target_sat: null });
  });

  for (const bad of [0, -1, 20001, 'lots', 1.5]) {
    it(`rejects out-of-range weekday target ${bad}`, () => {
      throws(() => validateSettingsPatch({ calorie_target_wed: bad }), 'calorie_target_wed');
    });
  }

  it('names the weekday in the message', () => {
    const error = throws(() => validateSettingsPatch({ calorie_target_thu: 0 }), 'calorie_target_thu');
    assert.match(error.message, /Thursday/);
  });

  it('rejects an unknown weekday', () => {
    throws(() => validateSettingsPatch({ calorie_target_funday: 2000 }), 'calorie_target_funday');
  });

  it('rejects an unknown unit', () => {
    throws(() => validateSettingsPatch({ unit: 'stone' }), 'unit');
  });

  it('treats the goal fields as nullable', () => {
    assert.deepEqual(
      validateSettingsPatch({ goal_weight_kg: null, goal_date: '' }),
      { goal_weight_kg: null, goal_date: null },
    );
  });

  it('requires a positive default target', () => {
    throws(() => validateSettingsPatch({ default_calorie_target: 0 }), 'default_calorie_target');
  });

  it('rejects a blank default target, which may not be cleared', () => {
    throws(() => validateSettingsPatch({ default_calorie_target: '' }), 'default_calorie_target');
  });

  it('rejects an unknown field', () => {
    throws(() => validateSettingsPatch({ admin: true }), 'admin');
  });
});

describe('error messages', () => {
  it('names the field in plain language', () => {
    const error = throws(() => validateEntryPatch({ calories: 999999 }), 'calories');
    assert.match(error.message, /^Calories must be between/);
  });

  it('states the unit in the weight message', () => {
    const error = throws(() => validateEntryPatch({ weight_kg: 5 }), 'weight_kg');
    assert.match(error.message, /kilograms/);
  });

  it('reads as a sentence for settings', () => {
    const error = throws(() => validateSettingsPatch({ default_calorie_target: 0 }), 'default_calorie_target');
    assert.match(error.message, /^Daily calorie target must be between/);
  });

  it('lists every unknown field', () => {
    const error = throws(() => validateEntryPatch({ zeta: 1, alpha: 2 }), 'alpha');
    assert.match(error.message, /alpha, zeta/);
  });
});
