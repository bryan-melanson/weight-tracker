/* The maintenance estimate: how many calories a day holds your weight steady.

   Mifflin-St Jeor gives resting energy from weight, height, age and sex, and
   an activity factor scales it up to a whole day. It is an estimate of a
   population average, not a measurement of one person — see the note on
   `maintenanceOn` — so everything here is kept honest about being a guide.

   Logged exercise is netted out of intake elsewhere (see stats.netIntake),
   so the activity level to pick is the one describing everything apart from
   the workouts being logged; otherwise the same session is counted twice.

   Pure functions over settings and entries. No DOM, no state. */

import { parseISO } from './format.js';

/* Resting energy times one of these factors gives maintenance. The mirror of
   config.ACTIVITY_LEVELS; tests/test_js_limits.py keeps the two equal. */
export const ACTIVITY_LEVELS = [
  { key: 'sedentary', factor: 1.2, label: 'Sedentary — desk job, little walking' },
  { key: 'light', factor: 1.375, label: 'Lightly active — walking most days' },
  { key: 'moderate', factor: 1.55, label: 'Moderately active — on your feet all day' },
  { key: 'very', factor: 1.725, label: 'Very active — physical job' },
  { key: 'extra', factor: 1.9, label: 'Extremely active — heavy physical job' },
];

export const DEFAULT_ACTIVITY_LEVEL = 'sedentary';

/* Mifflin-St Jeor needs a weight, a height, an age and one of two sex
   constants; it is defined for those two only, which is why this is not a
   broader list. */
export const SEXES = ['male', 'female'];
const SEX_CONSTANT = { male: 5, female: -161 };

const levelFor = (level) =>
  ACTIVITY_LEVELS.find((item) => item.key === level) ||
  ACTIVITY_LEVELS.find((item) => item.key === DEFAULT_ACTIVITY_LEVEL);

/* An unset or unknown level reads as the default rather than as no estimate:
   a database written before activity levels existed has none stored. */
export const activityFactor = (level) => levelFor(level).factor;
export const activityLabel = (level) => levelFor(level).label;

/* The short form for a sentence, before the em dash in the label above. */
export const activityShortLabel = (level) => levelFor(level).label.split(' — ')[0];

/* Whole years completed by `iso`, so a birthday part way through a range
   moves the estimate on the day it falls. */
export function ageOn(iso, birthISO) {
  if (!iso || !birthISO) return null;
  const date = parseISO(iso);
  const birth = parseISO(birthISO);
  let years = date.getFullYear() - birth.getFullYear();
  const hadBirthday =
    date.getMonth() > birth.getMonth() ||
    (date.getMonth() === birth.getMonth() && date.getDate() >= birth.getDate());
  if (!hadBirthday) years -= 1;
  return years;
}

/* Resting energy by Mifflin-St Jeor, in kcal/day. */
export function restingKcal({ kg, heightCm, ageYears, sex }) {
  if (kg === null || kg === undefined || heightCm === null || heightCm === undefined) return null;
  if (ageYears === null || ageYears === undefined || !(sex in SEX_CONSTANT)) return null;
  return 10 * kg + 6.25 * heightCm - 5 * ageYears + SEX_CONSTANT[sex];
}

/* The profile the estimate needs, or null while anything is still missing —
   which is what makes the running balance fall back to the calorie targets.
   The activity level is the one part with a default, so it never blocks it. */
export function maintenanceProfile(settings) {
  if (!settings) return null;
  const { height_cm: heightCm, birth_date: birthDate, sex } = settings;
  if (heightCm === null || heightCm === undefined) return null;
  if (!birthDate || !(sex in SEX_CONSTANT)) return null;
  const level = levelFor(settings.activity_level);
  return { heightCm, birthDate, sex, level: level.key, factor: level.factor };
}

export const profileComplete = (settings) => maintenanceProfile(settings) !== null;

/* Maintenance for one day, from the weight carried on that day. Null without
   a profile or without a weight to put into it: the estimate is only as good
   as the weight behind it, and inventing one would make the running deficit
   look more certain than it is. */
export function maintenanceOn(profile, kg, iso) {
  if (!profile || kg === null || kg === undefined) return null;
  const resting = restingKcal({
    kg,
    heightCm: profile.heightCm,
    ageYears: ageOn(iso, profile.birthDate),
    sex: profile.sex,
  });
  return resting === null ? null : resting * profile.factor;
}

/* The weight to measure a day against: the most recent one logged on or
   before it. Weight is logged when it is logged, not every day, so a gap
   carries the last reading forward; a day before the first reading borrows
   that one, since the alternative is no estimate at all for it. */
export function weightLookup(entries) {
  const points = (entries || [])
    .filter((entry) => entry.weight_kg !== null && entry.weight_kg !== undefined)
    .map((entry) => ({ iso: entry.date, kg: entry.weight_kg }))
    .sort((a, b) => (a.iso < b.iso ? -1 : 1));
  return {
    any: points.length > 0,
    at(iso) {
      if (!points.length) return null;
      let found = null;
      for (const point of points) {
        if (point.iso > iso) break;
        found = point;
      }
      return (found || points[0]).kg;
    },
  };
}
