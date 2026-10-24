/* The Backup card: the service's state rendered, and its buttons wired.

   Holds no state of its own — it reads what the service publishes and draws
   it, so there is one source of truth for whether a backup is pending. */

import { fmtDateLong } from '../format.js';

const $ = (selector, root = document) => root.querySelector(selector);

const FIELDS = ['owner', 'repo', 'path', 'branch', 'token'];

/* "just now" / "8 minutes ago" / a date once it stops being today. */
function since(iso, nowMs) {
  if (!iso) return null;
  const minutes = Math.floor((nowMs - Date.parse(iso)) / 60000);
  if (!Number.isFinite(minutes) || minutes < 0) return 'just now';
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return `on ${fmtDateLong(iso.slice(0, 10))}`;
}

function statusLine(state, nowMs) {
  if (!state.configured) return { text: '', kind: 'info' };
  if (state.status === 'saving') return { text: 'Backing up…', kind: 'info' };
  if (state.status === 'error') {
    return { text: `Not backed up: ${state.lastError}`, kind: 'error' };
  }
  if (state.pending) {
    return { text: `Changes on this device are not backed up yet.`, kind: 'warn' };
  }
  const when = since(state.lastBackupAt, nowMs);
  return { text: when ? `Backed up ${when} to ${state.repo}/${state.path}.` : `Backing up to ${state.repo}/${state.path}.`, kind: 'success' };
}

/* What the collapsed summary says, so the section does not have to be opened
   to find out whether the data is safe. Empty while backups are switched off:
   there is nothing to report about a feature nobody is using. */
function summaryState(state) {
  if (!state.configured) return { text: '', kind: 'info' };
  if (state.foundDays > 0) return { text: 'needs a decision', kind: 'error' };
  if (state.status === 'saving') return { text: 'backing up…', kind: 'info' };
  if (state.status === 'error') return { text: 'not backed up', kind: 'error' };
  if (state.pending) return { text: 'changes not backed up', kind: 'warn' };
  return { text: 'up to date', kind: 'success' };
}

/* Collapsing a section must not hide a problem. The panel opens itself when
   something needs the user: a backup found in the repository that it refuses
   to overwrite on its own, or a push that failed. Once opened it is left
   alone — closing it again is the user's call, not something a later status
   change undoes. */
function openWhenItMatters(details, state) {
  if (state.foundDays > 0 || state.status === 'error') details.open = true;
}

export function mountBackupPanel({ service, onDataChanged, setStatus, now = () => Date.now() }) {
  const details = $('#backup-card');
  const form = $('#backup-form');
  const actions = $('#backup-actions');
  const found = $('#backup-found');
  const statusNode = $('#backup-status');
  const summaryNode = $('#backup-summary-state');

  function render(state) {
    form.hidden = state.configured;
    actions.hidden = !state.configured;
    found.hidden = !(state.configured && state.foundDays > 0);

    if (!found.hidden) {
      const days = state.foundDays;
      $('#backup-found-text').textContent =
        `${state.repo}/${state.path} already holds a backup of ${days} day${days === 1 ? '' : 's'}. ` +
        'Nothing has been written to it. Restore it here, or replace it with what is on this device.';
    }

    const line = statusLine(state, now());
    statusNode.textContent = line.text;
    statusNode.dataset.kind = line.kind;
    statusNode.hidden = !line.text;

    const summary = summaryState(state);
    summaryNode.textContent = summary.text;
    summaryNode.dataset.kind = summary.kind;
    summaryNode.hidden = !summary.text;

    $('#backup-now').disabled = state.status === 'saving';
    openWhenItMatters(details, state);
  }

  function readForm() {
    return Object.fromEntries(FIELDS.map((field) => [field, $(`#backup-${field}`).value]));
  }

  function markInvalid(field) {
    form.querySelectorAll('[aria-invalid]').forEach((node) => node.removeAttribute('aria-invalid'));
    const node = field && $(`#backup-${field}`);
    if (node) {
      node.setAttribute('aria-invalid', 'true');
      node.focus();
    }
  }

  async function guard(action, success) {
    try {
      const result = await action();
      if (success) setStatus(success(result), 'success');
      return result;
    } catch (error) {
      markInvalid(error.field);
      setStatus(error.message, 'error');
      return null;
    }
  }

  async function restore() {
    const state = service.state();
    const ok = window.confirm(
      `Restore from ${state.repo}/${state.path}?\n\n` +
      'Days in the backup are written over the matching days on this device. ' +
      'Days only on this device are left alone.',
    );
    if (!ok) return;
    const result = await guard(
      () => service.restore(),
      ({ imported }) => `Restored ${imported} day${imported === 1 ? '' : 's'} from the backup.`,
    );
    if (result) await onDataChanged();
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    markInvalid(null);
    await guard(
      () => service.connect(readForm()),
      (result) => (result.existingBackup
        ? 'Connected. That repository already holds a backup — choose what to do with it.'
        : 'Connected and backed up.'),
    );
  });

  $('#backup-now').addEventListener('click', () => guard(() => service.backupNow()));
  $('#backup-replace').addEventListener('click', () => guard(
    () => service.backupNow(),
    () => 'Backup replaced with this device.',
  ));
  $('#backup-restore').addEventListener('click', restore);
  $('#backup-restore-later').addEventListener('click', restore);
  $('#backup-disconnect').addEventListener('click', () => {
    if (!window.confirm('Disconnect backups and forget the token on this device?\n\nThe file already in GitHub is left as it is.')) return;
    service.disconnect();
    FIELDS.forEach((field) => { if (field === 'token') $(`#backup-${field}`).value = ''; });
    setStatus('Backups disconnected.', 'success');
  });

  return { render };
}
