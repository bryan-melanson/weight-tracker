import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { todayISO, addDays } from '../../static/js/format.js';
import { ageOn } from '../../static/js/maintenance.js';
import {
  WEEKLY_THRESHOLD_DAYS,
  balanceBasis,
  balancePoints,
  caloriePoints,
  cumulativeBalance,
  effectiveTarget,
  exercisePoints,
  netIntake,
  inRange,
  projectGoalDate,
  maintenanceNow,
  summarize,
  targetForDate,
  trailingAverage,
  trendSlopePerDay,
  weeklyCalories,
  weightPoints,
} from '../../static/js/stats.js';

const settings = { unit: 'kg', default_calorie_target: 2000, goal_weight_kg: 75, goal_date: null };

const entry = (date, overrides = {}) => ({
  date,
  weight_kg: null,
  calories: null,
  calories_burned: null,
  calorie_target: null,
  note: null,
  ...overrides,
});

describe('effectiveTarget', () => {
  // 2026-10-19 is a Monday, 2026-10-24 a Saturday.
  const weekly = { ...settings, calorie_target_mon: 1800, calorie_target_sat: 2600 };

  it('falls back to the default target', () => {
    assert.equal(effectiveTarget(entry('2026-10-01'), settings), 2000);
  });

  it('prefers the day override', () => {
    assert.equal(effectiveTarget(entry('2026-10-01', { calorie_target: 2400 }), settings), 2400);
  });

  it('treats a missing entry as the default', () => {
    assert.equal(effectiveTarget(null, settings), 2000);
  });

  it('uses the target set for that weekday', () => {
    assert.equal(effectiveTarget(entry('2026-10-19'), weekly), 1800);
    assert.equal(effectiveTarget(entry('2026-10-24'), weekly), 2600);
  });

  it('falls back to the default on a weekday left unset', () => {
    assert.equal(effectiveTarget(entry('2026-10-20'), weekly), 2000, 'Tuesday is unset');
  });

  it('lets a one-off day override its weekday', () => {
    assert.equal(effectiveTarget(entry('2026-10-19', { calorie_target: 2200 }), weekly), 2200);
  });

  it('resolves the weekday for a date with no entry at all', () => {
    assert.equal(targetForDate('2026-10-19', weekly), 1800);
    assert.equal(targetForDate('2026-10-20', weekly), 2000);
  });
});

describe('selection', () => {
  const entries = ['2026-10-01', '2026-10-05', '2026-10-09'].map((date) => entry(date, { calories: 2000 }));

  it('filters inclusively on both ends', () => {
    assert.deepEqual(inRange(entries, '2026-10-05', '2026-10-09').map((e) => e.date), [
      '2026-10-05',
      '2026-10-09',
    ]);
  });

  it('returns everything when the range is open', () => {
    assert.equal(inRange(entries, null, null).length, 3);
  });

  it('drops days without the measure being plotted', () => {
    const mixed = [entry('2026-10-01', { weight_kg: 80 }), entry('2026-10-02', { calories: 1900 })];
    assert.deepEqual(weightPoints(mixed).map((p) => p.iso), ['2026-10-01']);
    assert.deepEqual(caloriePoints(mixed, settings).map((p) => p.iso), ['2026-10-02']);
  });

  it('keeps a zero-calorie day, which is data, not a gap', () => {
    assert.equal(caloriePoints([entry('2026-10-01', { calories: 0 })], settings).length, 1);
  });
});

describe('exercise', () => {
  it('nets logged exercise out of the intake it is measured against', () => {
    const [point] = caloriePoints([entry('2026-10-01', { calories: 2400, calories_burned: 500 })], settings);
    assert.equal(point.calories, 2400, 'intake stays the intake');
    assert.equal(point.burned, 500);
    assert.equal(point.net, 1900);
    assert.equal(point.diff, -100, 'net 1900 against a 2000 target is a 100 kcal deficit');
  });

  it('treats a day with no exercise logged as no exercise', () => {
    const [point] = caloriePoints([entry('2026-10-01', { calories: 2400 })], settings);
    assert.equal(point.burned, 0);
    assert.equal(point.net, 2400);
    assert.equal(point.diff, 400);
  });

  /* Intake is what the target measures. A day with a burn but no intake
     logged has an unknown net, so it must not land in the balance as if
     nothing had been eaten. */
  it('does not plot a burn-only day against the target', () => {
    assert.equal(caloriePoints([entry('2026-10-01', { calories_burned: 500 })], settings).length, 0);
  });

  it('collects exercise days whether or not intake was logged', () => {
    const entries = [
      entry('2026-10-01', { calories: 2000, calories_burned: 300 }),
      entry('2026-10-02', { calories_burned: 700 }),
      entry('2026-10-03', { calories: 2000 }),
    ];
    const points = exercisePoints(entries);
    assert.deepEqual(points.map((p) => p.iso), ['2026-10-01', '2026-10-02']);
    assert.deepEqual(points.map((p) => p.burned), [300, 700]);
  });

  it('reports net intake per day, or null without intake', () => {
    assert.equal(netIntake(entry('2026-10-01', { calories: 2400, calories_burned: 500 })), 1900);
    assert.equal(netIntake(entry('2026-10-01', { calories: 2400 })), 2400);
    assert.equal(netIntake(entry('2026-10-01', { calories_burned: 500 })), null);
    assert.equal(netIntake(null), null);
  });

  it('keeps a zero-burn day, which is a logged rest day', () => {
    assert.equal(exercisePoints([entry('2026-10-01', { calories_burned: 0 })]).length, 1);
  });
});

describe('trailingAverage', () => {
  it('averages only the days inside the window', () => {
    const points = [
      { iso: '2026-10-01', kg: 80 },
      { iso: '2026-10-02', kg: 82 },
    ];
    const averaged = trailingAverage(points, 7);
    assert.equal(averaged[0].kg, 80);
    assert.equal(averaged[1].kg, 81);
    assert.equal(averaged[1].samples, 2);
  });

  it('drops samples that fall out of the calendar window', () => {
    const points = [
      { iso: '2026-10-01', kg: 90 },
      { iso: '2026-10-20', kg: 80 },
    ];
    const averaged = trailingAverage(points, 7);
    assert.equal(averaged[1].kg, 80, 'the 19-day-old sample must not be averaged in');
    assert.equal(averaged[1].samples, 1);
  });

  it('returns an empty series for no samples', () => {
    assert.deepEqual(trailingAverage([], 7), []);
  });
});

describe('cumulativeBalance', () => {
  it('runs a signed total of the daily differences', () => {
    const points = [
      { iso: '2026-10-01', diff: -200 },
      { iso: '2026-10-02', diff: 500 },
      { iso: '2026-10-03', diff: -100 },
    ];
    assert.deepEqual(cumulativeBalance(points).map((p) => p.kcal), [-200, 300, 200]);
  });
});

describe('trendSlopePerDay', () => {
  it('needs enough samples before reporting a trend', () => {
    assert.equal(trendSlopePerDay([{ iso: '2026-10-01', kg: 80 }]), null);
  });

  it('recovers a known linear slope', () => {
    const points = [0, 1, 2, 3, 4].map((offset) => ({
      iso: addDays('2026-10-01', offset),
      kg: 80 - 0.1 * offset,
    }));
    assert.ok(Math.abs(trendSlopePerDay(points) + 0.1) < 1e-9);
  });

  it('reports zero slope for a flat series', () => {
    const points = [0, 1, 2, 3].map((offset) => ({ iso: addDays('2026-10-01', offset), kg: 80 }));
    assert.equal(trendSlopePerDay(points), 0);
  });

  it('ignores samples older than the window', () => {
    const old = { iso: '2026-01-01', kg: 200 };
    const recent = [0, 1, 2, 3].map((offset) => ({ iso: addDays('2026-10-01', offset), kg: 80 }));
    assert.equal(trendSlopePerDay([old, ...recent]), 0);
  });
});

describe('projectGoalDate', () => {
  it('projects a reachable goal into the future', () => {
    const projection = projectGoalDate(80, -0.1, 75);
    assert.equal(projection.days, 50);
    assert.equal(projection.iso, addDays(todayISO(), 50));
  });

  it('reports a goal already met', () => {
    assert.deepEqual(projectGoalDate(75.01, -0.1, 75), { iso: null, reached: true });
  });

  it('refuses to project when the trend moves away from the goal', () => {
    assert.equal(projectGoalDate(80, 0.1, 75), null);
  });

  it('refuses to project without a trend or a goal', () => {
    assert.equal(projectGoalDate(80, null, 75), null);
    assert.equal(projectGoalDate(80, -0.1, null), null);
  });

  it('refuses implausibly distant projections', () => {
    assert.equal(projectGoalDate(80, -0.00001, 75), null);
  });
});

describe('weeklyCalories', () => {
  it('buckets days into weeks starting on Monday', () => {
    // 2026-10-01 is a Thursday; 2026-10-05 the following Monday.
    const points = [
      { iso: '2026-10-01', calories: 2000, burned: 0, net: 2000, target: 2000, diff: 0 },
      { iso: '2026-10-02', calories: 2400, burned: 0, net: 2400, target: 2000, diff: 400 },
      { iso: '2026-10-05', calories: 1800, burned: 0, net: 1800, target: 2000, diff: -200 },
    ];
    const weeks = weeklyCalories(points);
    assert.deepEqual(weeks.map((w) => w.iso), ['2026-09-28', '2026-10-05']);
    assert.equal(weeks[0].calories, 2200);
    assert.equal(weeks[0].diff, 200);
    assert.equal(weeks[0].days, 2);
    assert.equal(weeks[1].days, 1);
  });

  it('averages exercise and net intake across the week', () => {
    const points = [
      { iso: '2026-10-05', calories: 2000, burned: 400, net: 1600, target: 2000, diff: -400 },
      { iso: '2026-10-06', calories: 2200, burned: 0, net: 2200, target: 2000, diff: 200 },
    ];
    const [week] = weeklyCalories(points);
    assert.equal(week.burned, 200);
    assert.equal(week.net, 1900);
    assert.equal(week.diff, -100);
  });

  it('switches to weeks only past the threshold', () => {
    assert.ok(WEEKLY_THRESHOLD_DAYS > 0);
  });
});

/* The maintenance basis. The numbers below are worked from Mifflin-St Jeor
   by hand so a change in the formula shows up here and not only in
   maintenance.test.js: 10·kg + 6.25·178 − 5·age + 5, times 1.2. */
describe('balanceBasis', () => {
  const profile = {
    ...settings,
    height_cm: 178,
    birth_date: '1986-04-02',
    sex: 'male',
    activity_level: 'sedentary',
  };
  const logged = [entry('2026-10-01', { weight_kg: 80, calories: 2000 })];

  it('measures against the targets while the profile is incomplete', () => {
    assert.equal(balanceBasis(logged, settings).kind, 'target');
  });

  it('measures against maintenance once the profile is filled in', () => {
    assert.equal(balanceBasis(logged, profile).kind, 'maintenance');
  });

  it('keeps the targets when no weight has been logged', () => {
    const noWeight = [entry('2026-10-01', { calories: 2000 })];
    assert.equal(balanceBasis(noWeight, profile).kind, 'target');
  });
});

describe('balancePoints', () => {
  const profile = {
    ...settings,
    height_cm: 178,
    birth_date: '1986-04-02',
    sex: 'male',
    activity_level: 'sedentary',
  };
  const maintenanceAt = (kg, age) => (10 * kg + 6.25 * 178 - 5 * age + 5) * 1.2;

  it('measures intake against the maintenance for that day', () => {
    const entries = [entry('2026-10-01', { weight_kg: 80, calories: 2000 })];
    const [point] = balancePoints(entries, profile);
    const expected = maintenanceAt(80, 40);
    assert.ok(Math.abs(point.baseline - expected) < 1e-9);
    assert.ok(Math.abs(point.diff - (2000 - expected)) < 1e-9);
  });

  it('nets logged exercise out of intake first', () => {
    const entries = [entry('2026-10-01', { weight_kg: 80, calories: 2500, calories_burned: 500 })];
    const [point] = balancePoints(entries, profile);
    assert.ok(Math.abs(point.diff - (2000 - maintenanceAt(80, 40))) < 1e-9);
  });

  it('follows the weight down, so the baseline falls with it', () => {
    const entries = [
      entry('2026-10-01', { weight_kg: 90, calories: 2000 }),
      entry('2026-11-01', { weight_kg: 85, calories: 2000 }),
    ];
    const [first, second] = balancePoints(entries, profile);
    assert.ok(second.baseline < first.baseline);
    assert.ok(Math.abs(first.baseline - second.baseline - 5 * 10 * 1.2) < 1e-9);
  });

  it('keeps the day target on the point as well', () => {
    const entries = [entry('2026-10-01', { weight_kg: 80, calories: 2000, calorie_target: 1800 })];
    assert.equal(balancePoints(entries, profile)[0].target, 1800);
  });

  it('falls back to the target as the baseline without a profile', () => {
    const entries = [entry('2026-10-01', { weight_kg: 80, calories: 2200 })];
    const [point] = balancePoints(entries, settings);
    assert.equal(point.baseline, 2000);
    assert.equal(point.diff, 200);
  });

  it('skips days with no intake logged, like the calories series', () => {
    const entries = [entry('2026-10-01', { weight_kg: 80 }), entry('2026-10-02', { calories: 2000 })];
    assert.deepEqual(balancePoints(entries, profile).map((point) => point.iso), ['2026-10-02']);
  });
});

describe('maintenanceNow', () => {
  const profile = {
    ...settings,
    height_cm: 178,
    birth_date: '1986-04-02',
    sex: 'male',
    activity_level: 'sedentary',
  };

  it('estimates from the most recent weight', () => {
    const entries = [
      entry('2026-10-01', { weight_kg: 90 }),
      entry('2026-10-02', { weight_kg: 85 }),
    ];
    const age = ageOn(todayISO(), '1986-04-02');
    const expected = (10 * 85 + 6.25 * 178 - 5 * age + 5) * 1.2;
    assert.ok(Math.abs(maintenanceNow(entries, profile) - expected) < 1e-9);
  });

  it('is null without a profile or a weight', () => {
    assert.equal(maintenanceNow([entry('2026-10-01', { weight_kg: 85 })], settings), null);
    assert.equal(maintenanceNow([entry('2026-10-01', { calories: 2000 })], profile), null);
  });
});

describe('summarize', () => {
  const entries = [
    entry('2026-10-01', { weight_kg: 80.0, calories: 2100 }),
    entry('2026-10-02', { weight_kg: 79.8, calories: 1900 }),
    entry('2026-10-03', { weight_kg: 79.6, calories: 2400, calorie_target: 2200 }),
    entry('2026-10-04', { weight_kg: 79.4, calories: 1800 }),
  ];
  const range = { from: '2026-10-01', to: '2026-10-04' };

  it('measures the change across the range', () => {
    assert.ok(Math.abs(summarize(entries, settings, range).changeKg + 0.6) < 1e-9);
  });

  it('nets the calorie balance against per-day targets', () => {
    assert.equal(summarize(entries, settings, range).netKcal, 0);
  });

  it('measures every day against its own weekday target', () => {
    // 2026-10-19 Monday through 2026-10-22 Thursday, 2000 kcal eaten each day.
    const week = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22'].map((date) =>
      entry(date, { calories: 2000 })
    );
    const weekly = { ...settings, calorie_target_mon: 1800, calorie_target_tue: 2200 };
    const summary = summarize(week, weekly, { from: '2026-10-19', to: '2026-10-22' });
    assert.deepEqual(summary.calories.map((point) => point.target), [1800, 2200, 2000, 2000]);
    assert.equal(summary.netKcal, 200 - 200 + 0 + 0);
  });

  it('counts logged exercise as part of the balance', () => {
    const withExercise = entries.map((e, index) =>
      index === 0 ? { ...e, calories_burned: 600 } : e
    );
    assert.equal(summarize(withExercise, settings, range).netKcal, -600);
  });

  it('summarizes exercise over the range', () => {
    const withExercise = [
      { ...entries[0], calories_burned: 300 },
      { ...entries[1], calories_burned: 500 },
      entries[2],
      entries[3],
    ];
    const summary = summarize(withExercise, settings, range);
    assert.equal(summary.avgBurned, 400);
    assert.equal(summary.burnDays, 2);
    assert.equal(summary.totalBurned, 800);
  });

  it('leaves the exercise summary null when none is logged', () => {
    const summary = summarize(entries, settings, range);
    assert.equal(summary.avgBurned, null);
    assert.equal(summary.burnDays, 0);
  });

  it('counts the days logged against the days in range', () => {
    const summary = summarize(entries, settings, range);
    assert.equal(summary.daysLogged, 4);
    assert.equal(summary.daysInRange, 4);
  });

  it('reports the distance left to the goal', () => {
    assert.ok(Math.abs(summarize(entries, settings, range).goalRemainingKg + 4.4) < 1e-9);
  });

  it('leaves metrics null when nothing is logged', () => {
    const summary = summarize([], settings, range);
    assert.equal(summary.current, null);
    assert.equal(summary.changeKg, null);
    assert.equal(summary.avgCalories, null);
    assert.equal(summary.netKcal, null);
    assert.equal(summary.daysLogged, 0);
  });

  it('does not report a change from a single reading', () => {
    const one = [entry('2026-10-01', { weight_kg: 80 })];
    assert.equal(summarize(one, settings, range).changeKg, null);
  });

  it('ignores entries outside the range', () => {
    const summary = summarize([...entries, entry('2027-01-01', { weight_kg: 60 })], settings, range);
    assert.equal(summary.current.kg, 79.4);
  });

  it('reports which baseline the running balance used', () => {
    assert.equal(summarize(entries, settings, range).balanceBasis, 'target');
    assert.equal(summarize(entries, settings, range).maintenance, null);
  });

  it('sums the balance against maintenance once the profile allows it', () => {
    const profile = {
      ...settings,
      height_cm: 178,
      birth_date: '1986-04-02',
      sex: 'male',
      activity_level: 'sedentary',
    };
    const summary = summarize(entries, profile, range);
    assert.equal(summary.balanceBasis, 'maintenance');
    assert.ok(summary.maintenance > 0);
    const expected = summary.deficits.reduce((sum, point) => sum + point.diff, 0);
    assert.ok(Math.abs(summary.netKcal - expected) < 1e-9);
    assert.notEqual(summary.netKcal, 0, 'the target-based total for these days is 0');
  });

  it('keeps the calories chart on the targets whatever the balance uses', () => {
    const profile = {
      ...settings,
      height_cm: 178,
      birth_date: '1986-04-02',
      sex: 'male',
      activity_level: 'sedentary',
    };
    const summary = summarize(entries, profile, range);
    assert.deepEqual(summary.calories.map((point) => point.target), [2000, 2000, 2200, 2000]);
    assert.equal(summary.avgDiff, (100 - 100 + 200 - 200) / 4);
  });

  it('averages the daily difference from the baseline it used', () => {
    const summary = summarize(entries, settings, range);
    assert.equal(summary.avgBalanceDiff, summary.avgDiff, 'the same baseline, so the same average');
  });

  it('reaches outside the range for a weight to estimate from', () => {
    /* The weight logged before the range is the only one there is, so the
       days inside it are still measured against maintenance. */
    const profile = {
      ...settings,
      height_cm: 178,
      birth_date: '1986-04-02',
      sex: 'male',
      activity_level: 'sedentary',
    };
    const inside = [entry('2026-10-02', { calories: 2000 })];
    const earlier = entry('2026-09-01', { weight_kg: 80 });
    const summary = summarize([earlier, ...inside], profile, { from: '2026-10-01', to: '2026-10-04' });
    assert.equal(summary.balanceBasis, 'maintenance');
    assert.equal(summary.deficits.length, 1);
    assert.ok(summary.deficits[0].baseline > 0);
  });
});
