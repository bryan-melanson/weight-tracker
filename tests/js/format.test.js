import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CM_PER_IN,
  HEIGHT_UNIT,
  WEEKDAYS,
  weekdayKey,
  weekdayTargetField,
  LB_PER_KG,
  addDays,
  daysBetween,
  fmtInt,
  fmtSignedInt,
  fmtHeight,
  fmtWeight,
  fmtWeightDelta,
  parseISO,
  roundTo,
  toDisplayHeight,
  toDisplayWeight,
  toHeightCm,
  toISO,
  toKg,
} from '../../static/js/format.js';

describe('weight units', () => {
  it('passes kilograms through unchanged', () => {
    assert.equal(toDisplayWeight(80, 'kg'), 80);
    assert.equal(toKg(80, 'kg'), 80);
  });

  it('converts to and from pounds', () => {
    assert.equal(roundTo(toDisplayWeight(80, 'lb'), 3), roundTo(80 * LB_PER_KG, 3));
    assert.ok(Math.abs(toKg(176.37, 'lb') - 80) < 0.001);
  });

  it('round-trips through pounds without drift', () => {
    assert.ok(Math.abs(toKg(toDisplayWeight(72.4, 'lb'), 'lb') - 72.4) < 1e-9);
  });

  it('treats blank and non-numeric input as absent', () => {
    for (const value of ['', null, undefined, 'heavy']) assert.equal(toKg(value, 'kg'), null);
  });

  it('renders a placeholder when there is no value', () => {
    assert.equal(fmtWeight(null, 'kg'), '—');
    assert.equal(fmtWeightDelta(null, 'kg'), '—');
  });

  it('formats weights to one decimal with the unit', () => {
    assert.equal(fmtWeight(80.449, 'kg'), '80.4 kg');
    assert.equal(fmtWeight(80.449, 'kg', { withUnit: false }), '80.4');
  });

  it('signs deltas with a true minus sign', () => {
    assert.equal(fmtWeightDelta(-1.25, 'kg'), '−1.3 kg');
    assert.equal(fmtWeightDelta(1.25, 'kg'), '+1.3 kg');
    assert.equal(fmtWeightDelta(0, 'kg'), '0.0 kg');
  });
});

describe('height units', () => {
  it('goes with the weight unit', () => {
    assert.equal(HEIGHT_UNIT.lb, 'in');
    assert.equal(HEIGHT_UNIT.kg, 'cm');
  });

  it('passes centimetres through unchanged', () => {
    assert.equal(toDisplayHeight(178, 'kg'), 178);
    assert.equal(toHeightCm(178, 'kg'), 178);
  });

  it('converts to and from inches', () => {
    assert.equal(toHeightCm(70, 'lb'), 70 * CM_PER_IN);
    assert.ok(Math.abs(toDisplayHeight(177.8, 'lb') - 70) < 1e-9);
  });

  it('round-trips through inches without drift', () => {
    assert.ok(Math.abs(toHeightCm(toDisplayHeight(178, 'lb'), 'lb') - 178) < 1e-9);
  });

  it('treats blank and non-numeric input as absent', () => {
    for (const value of ['', null, undefined, 'tall']) assert.equal(toHeightCm(value, 'lb'), null);
    assert.equal(toDisplayHeight(null, 'lb'), null);
  });

  it('says a height the way the reader says it', () => {
    assert.equal(fmtHeight(177.8, 'lb'), '5′10″');
    assert.equal(fmtHeight(182.88, 'lb'), '6′0″');
    assert.equal(fmtHeight(178, 'kg'), '178 cm');
    assert.equal(fmtHeight(null, 'lb'), '—');
  });
});

describe('number formatting', () => {
  it('rounds and groups integers', () => {
    assert.equal(fmtInt(1234.6), (1235).toLocaleString());
    assert.equal(fmtInt(null), '—');
    assert.equal(fmtInt(Number.NaN), '—');
  });

  it('signs integers explicitly', () => {
    assert.equal(fmtSignedInt(0), '0');
    assert.ok(fmtSignedInt(250).startsWith('+'));
    assert.ok(fmtSignedInt(-250).startsWith('−'));
  });
});

describe('weekdays', () => {
  it('names the week in reading order', () => {
    assert.deepEqual(WEEKDAYS.map((day) => day.key), ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
    assert.deepEqual(WEEKDAYS.map((day) => day.label), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  });

  it('maps a date to its weekday key', () => {
    // 2026-10-19 is a Monday.
    assert.equal(weekdayKey('2026-10-19'), 'mon');
    assert.equal(weekdayKey('2026-10-24'), 'sat');
    assert.equal(weekdayKey('2026-10-25'), 'sun');
  });

  it('names the settings field a weekday target lives in', () => {
    assert.equal(weekdayTargetField('2026-10-19'), 'calorie_target_mon');
  });
});

describe('dates', () => {
  it('parses at local midnight so the day never shifts', () => {
    const date = parseISO('2026-03-29');
    assert.equal(date.getHours(), 0);
    assert.equal(date.getDate(), 29);
    assert.equal(toISO(date), '2026-03-29');
  });

  it('adds days across a month boundary', () => {
    assert.equal(addDays('2026-01-31', 1), '2026-02-01');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  });

  it('adds days across a leap day', () => {
    assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  });

  it('survives a spring-forward DST boundary', () => {
    assert.equal(addDays('2026-03-28', 2), '2026-03-30');
    assert.equal(daysBetween('2026-03-28', '2026-03-30'), 2);
  });

  it('measures inclusive-exclusive day spans', () => {
    assert.equal(daysBetween('2026-10-01', '2026-10-01'), 0);
    assert.equal(daysBetween('2026-10-01', '2026-12-31'), 91);
    assert.equal(daysBetween('2026-10-05', '2026-10-01'), -4);
  });
});
