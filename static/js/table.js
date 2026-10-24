/* The table view: the WCAG-clean twin of the charts. Every plotted value is
   readable here without hovering, and each row can be loaded or deleted. */

import { fmtDateLong, fmtInt, fmtSignedInt, fmtWeight } from './format.js';
import { effectiveTarget, netIntake } from './stats.js';

export const MAX_ROWS = 400;
const COLUMN_COUNT = 8;

function cell(text, className) {
  const node = document.createElement('td');
  if (className) node.className = className;
  node.textContent = text;
  return node;
}

function actionButton(label, title, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'row-btn';
  button.textContent = label;
  button.title = title;
  button.addEventListener('click', onClick);
  return button;
}

export function renderTable(tbody, entries, settings, { onEdit, onDelete }) {
  if (!entries.length) {
    const row = document.createElement('tr');
    const empty = cell('Nothing logged in this range yet.', 'empty');
    empty.colSpan = COLUMN_COUNT;
    row.appendChild(empty);
    tbody.replaceChildren(row);
    return;
  }

  const newestFirst = [...entries].reverse().slice(0, MAX_ROWS);
  const rows = newestFirst.map((entry) => {
    const row = document.createElement('tr');
    const target = effectiveTarget(entry, settings);
    const net = netIntake(entry);
    const diff = net === null ? null : net - target;

    row.appendChild(cell(fmtDateLong(entry.date)));
    row.appendChild(cell(fmtWeight(entry.weight_kg, settings.unit, { withUnit: false }), 'num'));
    row.appendChild(cell(entry.calories === null ? '—' : fmtInt(entry.calories), 'num'));
    row.appendChild(cell(entry.calories_burned === null ? '—' : fmtInt(entry.calories_burned), 'num'));
    row.appendChild(cell(fmtInt(target), 'num'));
    row.appendChild(
      cell(diff === null ? '—' : `${fmtSignedInt(diff)}`, `num ${diff === null ? '' : diff > 0 ? 'over' : 'under'}`)
    );
    row.appendChild(cell(entry.note || '', 'note-cell'));

    const actions = document.createElement('td');
    actions.append(
      actionButton('Edit', `Load ${entry.date} into the form`, () => onEdit(entry)),
      actionButton('Delete', `Delete ${entry.date}`, () => onDelete(entry))
    );
    row.appendChild(actions);
    return row;
  });

  if (entries.length > MAX_ROWS) {
    const row = document.createElement('tr');
    const note = cell(`Showing the ${MAX_ROWS} most recent of ${entries.length} days. Narrow the range or export to CSV for the rest.`, 'empty');
    note.colSpan = COLUMN_COUNT;
    row.appendChild(note);
    rows.push(row);
  }
  tbody.replaceChildren(...rows);
}
