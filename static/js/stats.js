/* Derived metrics. Pure functions over the entry list — no DOM, no state. */

import { KCAL_PER_KG, addDays, daysBetween, parseISO, toISO, weekdayTargetField } from './format.js';

export const TREND_WINDOW_DAYS = 7;
const PROJECTION_WINDOW_DAYS = 28;
const MIN_PROJECTION_SAMPLES = 4;

/* A day's calorie target, most specific source first: the target saved on
   that day's own entry, then the target set for its weekday, then the
   standing default. */
export function effectiveTarget(entry, settings) {
  const own = entry && entry.calorie_target;
  if (own !== null && own !== undefined) return own;
  return entry && entry.date ? targetForDate(entry.date, settings) : settings.default_calorie_target;
}

/* The scheduled target for a date, ignoring any one-off entry: what a day
   will be measured against before anything is logged for it. */
export function targetForDate(iso, settings) {
  const scheduled = settings[weekdayTargetField(iso)];
  return scheduled === null || scheduled === undefined ? settings.default_calorie_target : scheduled;
}

export function inRange(entries, from, to) {
  return entries.filter((entry) => (!from || entry.date >= from) && (!to || entry.date <= to));
}

export function weightPoints(entries) {
  return entries
    .filter((entry) => entry.weight_kg !== null && entry.weight_kg !== undefined)
    .map((entry) => ({ iso: entry.date, kg: entry.weight_kg }));
}

/* Days plotted against the calorie target. Exercise is netted out of intake,
   so `diff` answers "how far off target did this day end up", and a day's
   burn and intake both stay on the point for the tooltip and the table.

   Only days with intake logged appear: the target measures what was eaten,
   and a day with a burn but no intake has no known net to place against it. */
export function caloriePoints(entries, settings) {
  return entries
    .filter((entry) => entry.calories !== null && entry.calories !== undefined)
    .map((entry) => {
      const target = effectiveTarget(entry, settings);
      const burned = burnedOf(entry);
      const net = netIntake(entry);
      return { iso: entry.date, calories: entry.calories, burned, net, target, diff: net - target };
    });
}

/* A day with no exercise logged is not a zero-burn day, it is an unknown one:
   absent means absent, and only a logged 0 counts as a rest day. */
function burnedOf(entry) {
  const burned = entry.calories_burned;
  return burned === null || burned === undefined ? 0 : burned;
}

/* What the target is measured against: intake less any logged exercise.
   Null when nothing was eaten-logged, since there is then no net to report. */
export function netIntake(entry) {
  if (!entry || entry.calories === null || entry.calories === undefined) return null;
  return entry.calories - burnedOf(entry);
}

export function exercisePoints(entries) {
  return entries
    .filter((entry) => entry.calories_burned !== null && entry.calories_burned !== undefined)
    .map((entry) => ({ iso: entry.date, burned: entry.calories_burned }));
}

/* Trailing mean over a window of calendar days (not of samples), so a gap in
   logging widens the window's reach instead of silently averaging older days. */
export function trailingAverage(points, windowDays = TREND_WINDOW_DAYS) {
  return points.map((point, index) => {
    const earliest = addDays(point.iso, -(windowDays - 1));
    let sum = 0;
    let count = 0;
    for (let i = index; i >= 0 && points[i].iso >= earliest; i -= 1) {
      sum += points[i].kg;
      count += 1;
    }
    return { iso: point.iso, kg: sum / count, samples: count };
  });
}

export function cumulativeBalance(points) {
  let running = 0;
  return points.map((point) => {
    running += point.diff;
    return { iso: point.iso, kcal: running };
  });
}

/* Least-squares slope in kg/day over the most recent window. */
export function trendSlopePerDay(points, windowDays = PROJECTION_WINDOW_DAYS) {
  if (points.length < MIN_PROJECTION_SAMPLES) return null;
  const earliest = addDays(points[points.length - 1].iso, -(windowDays - 1));
  const window = points.filter((point) => point.iso >= earliest);
  if (window.length < MIN_PROJECTION_SAMPLES) return null;
  const base = window[0].iso;
  const xs = window.map((point) => daysBetween(base, point.iso));
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = window.reduce((sum, point) => sum + point.kg, 0) / window.length;
  let numerator = 0;
  let denominator = 0;
  xs.forEach((x, index) => {
    numerator += (x - meanX) * (window[index].kg - meanY);
    denominator += (x - meanX) ** 2;
  });
  if (denominator === 0) return null;
  return numerator / denominator;
}

export function projectGoalDate(currentKg, slopePerDay, goalKg) {
  if (currentKg === null || goalKg === null || !slopePerDay) return null;
  const remaining = goalKg - currentKg;
  if (Math.abs(remaining) < 0.05) return { iso: null, reached: true };
  const days = remaining / slopePerDay;
  if (days <= 0 || !Number.isFinite(days) || days > 365 * 5) return null;
  const date = parseISO(toISO(new Date()));
  date.setDate(date.getDate() + Math.round(days));
  return { iso: toISO(date), reached: false, days: Math.round(days) };
}

function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

export function lastNDays(points, count) {
  return points.slice(Math.max(0, points.length - count));
}

export function summarize(entries, settings, range) {
  const scoped = inRange(entries, range.from, range.to);
  const weights = weightPoints(scoped);
  const calories = caloriePoints(scoped, settings);
  const exercise = exercisePoints(scoped);
  const balance = cumulativeBalance(calories);
  const recent = lastNDays(calories, TREND_WINDOW_DAYS);
  const current = weights.length ? weights[weights.length - 1] : null;
  const first = weights.length ? weights[0] : null;
  const slope = trendSlopePerDay(weights);
  const goalKg = settings.goal_weight_kg;

  return {
    scoped,
    weights,
    calories,
    exercise,
    balance,
    current,
    changeKg: current && first && weights.length > 1 ? current.kg - first.kg : null,
    goalRemainingKg: current && goalKg !== null ? goalKg - current.kg : null,
    avgCalories: mean(recent.map((point) => point.calories)),
    avgDiff: mean(calories.map((point) => point.diff)),
    avgBurned: mean(exercise.map((point) => point.burned)),
    totalBurned: exercise.reduce((sum, point) => sum + point.burned, 0),
    burnDays: exercise.length,
    netKcal: balance.length ? balance[balance.length - 1].kcal : null,
    netKg: balance.length ? balance[balance.length - 1].kcal / KCAL_PER_KG : null,
    daysLogged: scoped.length,
    daysInRange: range.from ? daysBetween(range.from, range.to) + 1 : scoped.length,
    slopePerDay: slope,
    projection: projectGoalDate(current ? current.kg : null, slope, goalKg),
  };
}

/* Above this many days a per-day column chart degrades into a solid block, so
   calories fold into weekly means. The table view keeps every daily value. */
export const WEEKLY_THRESHOLD_DAYS = 120;

export function weeklyCalories(points) {
  const buckets = new Map();
  points.forEach((point) => {
    const date = parseISO(point.iso);
    const monday = new Date(date);
    monday.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    const key = toISO(monday);
    const bucket = buckets.get(key) || { iso: key, calories: [], burned: [], target: [] };
    bucket.calories.push(point.calories);
    bucket.burned.push(point.burned);
    bucket.target.push(point.target);
    buckets.set(key, bucket);
  });
  return [...buckets.values()]
    .sort((a, b) => (a.iso < b.iso ? -1 : 1))
    .map((bucket) => {
      const calories = mean(bucket.calories);
      const burned = mean(bucket.burned);
      const target = mean(bucket.target);
      const net = calories - burned;
      return { iso: bucket.iso, calories, burned, net, target, diff: net - target, days: bucket.calories.length };
    });
}
