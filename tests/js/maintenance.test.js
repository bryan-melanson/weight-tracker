import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ACTIVITY_LEVELS,
  DEFAULT_ACTIVITY_LEVEL,
  activityFactor,
  activityLabel,
  activityShortLabel,
  ageOn,
  maintenanceOn,
  maintenanceProfile,
  profileComplete,
  restingKcal,
  weightLookup,
} from '../../static/js/maintenance.js';

const profile = {
  height_cm: 178,
  birth_date: '1986-04-02',
  sex: 'male',
  activity_level: 'sedentary',
};

const entry = (date, overrides = {}) => ({
  date,
  weight_kg: null,
  calories: null,
  calories_burned: null,
  calorie_target: null,
  note: null,
  ...overrides,
});

describe('activity levels', () => {
  it('reads the factor for a level', () => {
    assert.equal(activityFactor('sedentary'), 1.2);
    assert.equal(activityFactor('very'), 1.725);
  });

  it('falls back to the default for an unset or unknown level', () => {
    const fallback = activityFactor(DEFAULT_ACTIVITY_LEVEL);
    assert.equal(activityFactor(null), fallback, 'a database written before levels existed');
    assert.equal(activityFactor('athlete'), fallback);
  });

  it('labels a level, long and short', () => {
    assert.equal(activityLabel('light'), 'Lightly active — walking most days');
    assert.equal(activityShortLabel('light'), 'Lightly active');
  });

  it('rises with activity, so a higher level never estimates less', () => {
    const factors = ACTIVITY_LEVELS.map((level) => level.factor);
    assert.deepEqual(factors, [...factors].sort((a, b) => a - b));
  });
});

describe('ageOn', () => {
  it('counts whole years completed', () => {
    assert.equal(ageOn('2026-11-13', '1986-04-02'), 40);
  });

  it('does not count a birthday still to come that year', () => {
    assert.equal(ageOn('2026-04-01', '1986-04-02'), 39);
  });

  it('counts the birthday itself', () => {
    assert.equal(ageOn('2026-04-02', '1986-04-02'), 40);
  });

  it('is null without both dates', () => {
    assert.equal(ageOn('2026-11-13', null), null);
    assert.equal(ageOn(null, '1986-04-02'), null);
  });
});

describe('restingKcal', () => {
  /* Mifflin-St Jeor: 10·kg + 6.25·cm − 5·age + 5 (male) or − 161 (female). */
  it('matches the formula for a man', () => {
    const expected = 10 * 80 + 6.25 * 178 - 5 * 40 + 5;
    assert.equal(restingKcal({ kg: 80, heightCm: 178, ageYears: 40, sex: 'male' }), expected);
  });

  it('matches the formula for a woman', () => {
    const expected = 10 * 65 + 6.25 * 165 - 5 * 35 - 161;
    assert.equal(restingKcal({ kg: 65, heightCm: 165, ageYears: 35, sex: 'female' }), expected);
  });

  it('is null when anything it needs is missing', () => {
    assert.equal(restingKcal({ kg: null, heightCm: 178, ageYears: 40, sex: 'male' }), null);
    assert.equal(restingKcal({ kg: 80, heightCm: null, ageYears: 40, sex: 'male' }), null);
    assert.equal(restingKcal({ kg: 80, heightCm: 178, ageYears: null, sex: 'male' }), null);
    assert.equal(restingKcal({ kg: 80, heightCm: 178, ageYears: 40, sex: null }), null);
  });
});

describe('maintenanceProfile', () => {
  it('reads the settings into a profile', () => {
    assert.deepEqual(maintenanceProfile(profile), {
      heightCm: 178,
      birthDate: '1986-04-02',
      sex: 'male',
      level: 'sedentary',
      factor: 1.2,
    });
  });

  it('defaults only the activity level', () => {
    const settings = { ...profile, activity_level: null };
    assert.equal(maintenanceProfile(settings).level, DEFAULT_ACTIVITY_LEVEL);
  });

  it('is null while height, date of birth or sex is unset', () => {
    assert.equal(maintenanceProfile({ ...profile, height_cm: null }), null);
    assert.equal(maintenanceProfile({ ...profile, birth_date: null }), null);
    assert.equal(maintenanceProfile({ ...profile, sex: null }), null);
    assert.equal(maintenanceProfile(null), null);
  });

  it('reports completeness the same way', () => {
    assert.equal(profileComplete(profile), true);
    assert.equal(profileComplete({ ...profile, sex: '' }), false);
  });
});

describe('maintenanceOn', () => {
  const resolved = maintenanceProfile(profile);

  it('scales resting energy by the activity factor', () => {
    const resting = 10 * 80 + 6.25 * 178 - 5 * 40 + 5;
    assert.equal(maintenanceOn(resolved, 80, '2026-11-13'), resting * 1.2);
  });

  it('follows the weight it is given, so losing weight lowers it', () => {
    const before = maintenanceOn(resolved, 90, '2026-11-13');
    const after = maintenanceOn(resolved, 80, '2026-11-13');
    assert.ok(after < before);
    assert.equal(before - after, 10 * 10 * 1.2, '10 kg is 100 kcal of resting energy');
  });

  it('is null without a profile or without a weight', () => {
    assert.equal(maintenanceOn(null, 80, '2026-11-13'), null);
    assert.equal(maintenanceOn(resolved, null, '2026-11-13'), null);
  });
});

describe('weightLookup', () => {
  const entries = [
    entry('2026-10-01', { weight_kg: 90 }),
    entry('2026-10-05'),
    entry('2026-10-08', { weight_kg: 88 }),
  ];

  it('carries the most recent reading forward over a gap', () => {
    const lookup = weightLookup(entries);
    assert.equal(lookup.at('2026-10-01'), 90);
    assert.equal(lookup.at('2026-10-05'), 90, 'nothing logged that day');
    assert.equal(lookup.at('2026-10-08'), 88);
    assert.equal(lookup.at('2026-11-01'), 88, 'still the last one known');
  });

  it('borrows the first reading for a day before it', () => {
    assert.equal(weightLookup(entries).at('2026-09-01'), 90);
  });

  it('reports having nothing when no day carries a weight', () => {
    const lookup = weightLookup([entry('2026-10-01', { calories: 2000 })]);
    assert.equal(lookup.any, false);
    assert.equal(lookup.at('2026-10-01'), null);
  });

  it('does not depend on the entries arriving in order', () => {
    const lookup = weightLookup([...entries].reverse());
    assert.equal(lookup.at('2026-10-05'), 90);
  });
});
