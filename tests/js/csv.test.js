import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ValidationError } from '../../static/js/backend/validate.js';
import { CSV_COLUMNS, parseRows, readImport, writeCsv } from '../../static/js/backend/csv.js';

/* Mirrors the CSV cases in tests/test_api.py, plus the quoting the Python csv
   module gave us for free and this port has to implement by hand. */

const throws = (fn, pattern) => {
  let error = null;
  try {
    fn();
  } catch (caught) {
    error = caught;
  }
  assert.ok(error instanceof ValidationError, `expected a ValidationError, got ${error}`);
  if (pattern) assert.match(error.message, pattern);
  return error;
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

describe('writeCsv', () => {
  it('writes the header and a row', () => {
    const text = writeCsv([
      entry('2026-10-01', { weight_kg: 80.0, calories: 2100, calories_burned: 450, calorie_target: 2000 }),
    ]);
    const lines = text.trim().split('\n');
    assert.equal(lines[0], 'date,weight_kg,calories,calories_burned,calorie_target,note');
    assert.ok(lines[1].startsWith('2026-10-01,80.0,2100,450,2000'));
  });

  it('writes the columns in the documented order', () => {
    assert.deepEqual(CSV_COLUMNS, ['date', 'weight_kg', 'calories', 'calories_burned', 'calorie_target', 'note']);
  });

  it('leaves unset values as empty cells', () => {
    assert.equal(writeCsv([entry('2026-10-02')]).trim().split('\n')[1], '2026-10-02,,,,,');
  });

  it('keeps a weight that is a whole number readable as a decimal', () => {
    assert.match(writeCsv([entry('2026-10-01', { weight_kg: 80 })]), /,80\.0,/);
  });

  it('quotes a note containing a comma', () => {
    assert.match(writeCsv([entry('2026-10-01', { note: 'felt good, mostly' })]), /"felt good, mostly"/);
  });

  it('doubles a quote inside a note', () => {
    assert.match(writeCsv([entry('2026-10-01', { note: 'a "big" day' })]), /"a ""big"" day"/);
  });

  it('quotes a note containing a newline', () => {
    assert.match(writeCsv([entry('2026-10-01', { note: 'two\nlines' })]), /"two\nlines"/);
  });
});

describe('parseRows', () => {
  it('reads a plain file', () => {
    assert.deepEqual(parseRows('a,b\n1,2\n'), [['a', 'b'], ['1', '2']]);
  });

  it('reads CRLF line endings', () => {
    assert.deepEqual(parseRows('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
  });

  it('reads a quoted field containing a comma', () => {
    assert.deepEqual(parseRows('a,b\n1,"x, y"\n'), [['a', 'b'], ['1', 'x, y']]);
  });

  it('reads an escaped quote', () => {
    assert.deepEqual(parseRows('a\n"say ""hi"""\n'), [['a'], ['say "hi"']]);
  });

  it('reads a quoted field containing a newline', () => {
    assert.deepEqual(parseRows('a,b\n1,"two\nlines"\n'), [['a', 'b'], ['1', 'two\nlines']]);
  });

  it('ignores a trailing blank line', () => {
    assert.deepEqual(parseRows('a,b\n1,2\n\n'), [['a', 'b'], ['1', '2']]);
  });

  it('round-trips what writeCsv produces', () => {
    const note = 'comma, "quote", and\na newline';
    const text = writeCsv([entry('2026-10-01', { weight_kg: 80.5, note })]);
    assert.equal(parseRows(text)[1][5], note);
  });
});

describe('readImport', () => {
  it('reads a row into a validated patch', () => {
    const staged = readImport('date,weight_kg,calories,calorie_target,note\n2026-10-02,79.5,1900,2000,ok\n');
    assert.equal(staged.length, 1);
    assert.equal(staged[0].date, '2026-10-02');
    assert.deepEqual(staged[0].patch, { weight_kg: 79.5, calories: 1900, calorie_target: 2000, note: 'ok' });
  });

  it('reads calories burned', () => {
    const [row] = readImport('date,calories,calories_burned\n2026-10-02,1900,520\n');
    assert.equal(row.patch.calories_burned, 520);
  });

  it('omits a column the file does not have', () => {
    const [row] = readImport('date,calories\n2026-10-02,1900\n');
    assert.ok(!('calories_burned' in row.patch));
  });

  it('treats a blank cell as clearing the value', () => {
    const [row] = readImport('date,weight_kg,calories\n2026-10-01,81,\n');
    assert.deepEqual(row.patch, { weight_kg: 81, calories: null });
  });

  it('reads the example from the README', () => {
    const staged = readImport(
      'date,weight_kg,calories,calories_burned,calorie_target,note\n' +
      '2026-10-01,80.5,1950,420,2000,felt good\n' +
      '2026-10-02,,2100,,,\n',
    );
    assert.deepEqual(staged.map((row) => row.date), ['2026-10-01', '2026-10-02']);
    assert.equal(staged[1].patch.weight_kg, null);
    assert.equal(staged[1].patch.calories, 2100);
  });

  it('names the row of a bad value', () => {
    throws(() => readImport('date,weight_kg,calories\n2026-10-02,79.5,oops\n'), /row 2/);
  });

  it('names the row of a bad date', () => {
    throws(() => readImport('date,calories\nnope,2000\n'), /row 2/);
  });

  it('counts rows from the header, so the third line is row 3', () => {
    throws(() => readImport('date,calories\n2026-10-01,2000\nnope,2000\n'), /row 3/);
  });

  it('requires a header row including date', () => {
    throws(() => readImport('weight_kg\n80\n'), /date/);
  });

  it('rejects an unsupported column', () => {
    throws(() => readImport('date,bodyfat\n2026-10-01,12\n'), /bodyfat/);
  });

  it('rejects a blank file', () => {
    throws(() => readImport('   '));
  });

  it('keeps a quoted note intact', () => {
    const [row] = readImport('date,note\n2026-10-01,"felt good, mostly"\n');
    assert.equal(row.patch.note, 'felt good, mostly');
  });
});
