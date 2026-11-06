/* CSV export and import for the browser backend — the port of _export_csv and
   _import_csv in tracker/api.py. The Python csv module handled quoting for
   free; here it is written out, so the two backends read and write the same
   files and an export from either imports into the other. */

import { ValidationError, encodeFoods, validateDate, validateEntryPatch } from './validate.js';

export const CSV_COLUMNS = ['date', 'weight_kg', 'calories', 'calories_burned', 'calorie_target', 'note', 'foods'];

const NEEDS_QUOTES = /[",\r\n]/;

function quote(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/* Weight is the one float column. Python writes 80.0 where JavaScript would
   write 80, so a whole number keeps its decimal point and a file exported from
   either backend is byte-identical. */
function cell(entry, column) {
  const value = entry[column];
  if (value === null || value === undefined) return '';
  if (column === 'weight_kg' && Number.isInteger(value)) return `${value}.0`;
  // The food log travels as one JSON cell, so a day stays one row and a file
  // without the column still imports.
  if (column === 'foods') return quote(encodeFoods(value));
  return quote(value);
}

export function writeCsv(entries) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const entry of entries) {
    lines.push(CSV_COLUMNS.map((column) => cell(entry, column)).join(','));
  }
  return `${lines.join('\n')}\n`;
}

/* An RFC 4180 reader: quoted fields may hold commas, newlines and doubled
   quotes. Returns rows of raw strings; a wholly empty trailing line is
   dropped, the way csv.reader skips it. */
export function parseRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  const endField = () => { row.push(field); field = ''; };
  const endRow = () => {
    endField();
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char !== '"') { field += char; continue; }
      if (text[index + 1] === '"') { field += '"'; index += 1; continue; }
      quoted = false;
    } else if (char === '"' && field === '') {
      quoted = true;
    } else if (char === ',') {
      endField();
    } else if (char === '\n') {
      endRow();
    } else if (char === '\r') {
      if (text[index + 1] === '\n') index += 1;
      endRow();
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length) endRow();
  return rows;
}

/* Read a file into validated (date, patch) pairs. Nothing is written by this
   function: the caller stages the whole file first, so a bad row late in the
   file cannot leave a half-applied import behind. */
export function readImport(text) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new ValidationError("Provide the file contents as a 'csv' string.", 'csv');
  }
  const rows = parseRows(text);
  const header = rows[0] || [];
  if (!header.includes('date')) {
    throw new ValidationError("CSV must have a header row including a 'date' column.", 'csv');
  }
  const unknown = header.filter((column) => !CSV_COLUMNS.includes(column)).sort();
  if (unknown.length) {
    throw new ValidationError(`CSV has unsupported column(s): ${unknown.join(', ')}.`, 'csv');
  }

  return rows.slice(1).map((cells, offset) => {
    const line = offset + 2; // row 1 is the header
    const raw = {};
    header.forEach((column, index) => { raw[column] = cells[index] ?? ''; });
    try {
      const date = validateDate(raw.date);
      const patch = {};
      for (const column of CSV_COLUMNS) {
        if (column !== 'date' && column in raw) patch[column] = raw[column];
      }
      return { date, patch: validateEntryPatch(patch) };
    } catch (error) {
      if (error instanceof ValidationError) {
        throw new ValidationError(`CSV row ${line}: ${error.message}`, error.field);
      }
      throw error;
    }
  });
}
