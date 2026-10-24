/* Units, numbers and dates. Pure functions only. */

export const LB_PER_KG = 2.2046226218;
export const KCAL_PER_KG = 7700;

export const UNIT_STEP = { kg: 0.1, lb: 0.2 };

export function toDisplayWeight(kg, unit) {
  if (kg === null || kg === undefined) return null;
  return unit === 'lb' ? kg * LB_PER_KG : kg;
}

export function toKg(value, unit) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return unit === 'lb' ? number / LB_PER_KG : number;
}

export function roundTo(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export function fmtWeight(kg, unit, { withUnit = true, places = 1 } = {}) {
  if (kg === null || kg === undefined) return '—';
  const shown = roundTo(toDisplayWeight(kg, unit), places).toFixed(places);
  return withUnit ? `${shown} ${unit}` : shown;
}

export function fmtWeightDelta(kg, unit, { places = 1 } = {}) {
  if (kg === null || kg === undefined) return '—';
  const shown = roundTo(Math.abs(toDisplayWeight(kg, unit)), places).toFixed(places);
  const sign = kg > 0 ? '+' : kg < 0 ? '−' : '';
  return `${sign}${shown} ${unit}`;
}

export function fmtInt(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return Math.round(value).toLocaleString();
}

export function fmtSignedInt(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const rounded = Math.round(value);
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '';
  return `${sign}${Math.abs(rounded).toLocaleString()}`;
}

/* The week in reading order, mirroring config.WEEKDAYS on the server. Each
   key names the settings field holding that weekday's calorie target. */
export const WEEKDAYS = [
  { key: 'mon', label: 'Mon', name: 'Monday' },
  { key: 'tue', label: 'Tue', name: 'Tuesday' },
  { key: 'wed', label: 'Wed', name: 'Wednesday' },
  { key: 'thu', label: 'Thu', name: 'Thursday' },
  { key: 'fri', label: 'Fri', name: 'Friday' },
  { key: 'sat', label: 'Sat', name: 'Saturday' },
  { key: 'sun', label: 'Sun', name: 'Sunday' },
];

/* Date.getDay() counts from Sunday; WEEKDAYS reads from Monday. */
export function weekdayKey(iso) {
  return WEEKDAYS[(parseISO(iso).getDay() + 6) % 7].key;
}

export function weekdayTargetField(iso) {
  return `calorie_target_${weekdayKey(iso)}`;
}

/* Dates are handled as YYYY-MM-DD strings and parsed at local midnight, so a
   timezone offset can never shift a logged day onto its neighbour. */
export function parseISO(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function toISO(date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function todayISO() {
  return toISO(new Date());
}

export function addDays(iso, count) {
  const date = parseISO(iso);
  date.setDate(date.getDate() + count);
  return toISO(date);
}

export function daysBetween(fromISO, toISOValue) {
  const ms = parseISO(toISOValue) - parseISO(fromISO);
  return Math.round(ms / 86400000);
}

const SHORT_DATE = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const LONG_DATE = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const MONTH_YEAR = new Intl.DateTimeFormat(undefined, { month: 'short', year: '2-digit' });

export const fmtDateShort = (iso) => SHORT_DATE.format(parseISO(iso));
export const fmtDateLong = (iso) => LONG_DATE.format(parseISO(iso));
export const fmtMonth = (iso) => MONTH_YEAR.format(parseISO(iso));
