/* Where the backup goes, and the token that gets it there.

   This is device-local on purpose: it is not part of the tracked settings and
   never reaches the CSV, so a backup file can be shared or restored onto
   another device without carrying a credential with it. */

import { ValidationError } from '../backend/validate.js';

export const BACKUP_KEY = 'weight-tracker.backup';

const GITHUB_NAME = /^[A-Za-z0-9._-]+$/;
const DEFAULT_BRANCH = 'main';

function text(raw, field, label) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) throw new ValidationError(`${label} is required.`, field);
  return value;
}

function name(raw, field, label) {
  const value = text(raw, field, label);
  if (!GITHUB_NAME.test(value)) {
    throw new ValidationError(`${label} may only contain letters, numbers, dots, dashes and underscores.`, field);
  }
  return value;
}

function filePath(raw) {
  const value = text(raw, 'path', 'File path');
  if (value.startsWith('/')) throw new ValidationError('File path must be relative to the repository root.', 'path');
  if (value.split('/').includes('..')) throw new ValidationError('File path may not contain "..".', 'path');
  if (!value.toLowerCase().endsWith('.csv')) throw new ValidationError('File path must end in .csv.', 'path');
  return value;
}

export function validateConfig(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationError('Backup settings must be an object.');
  }
  return {
    token: text(raw.token, 'token', 'Token'),
    owner: name(raw.owner, 'owner', 'Owner'),
    repo: name(raw.repo, 'repo', 'Repository'),
    path: filePath(raw.path),
    branch: raw.branch === undefined || raw.branch === null || raw.branch === ''
      ? DEFAULT_BRANCH
      : name(raw.branch, 'branch', 'Branch'),
  };
}

/* Anything unreadable is treated as "not configured" rather than thrown: a
   corrupt record must not stop the app from opening. */
export function readConfig(storage) {
  try {
    const stored = storage.getItem(BACKUP_KEY);
    return stored ? validateConfig(JSON.parse(stored)) : null;
  } catch {
    return null;
  }
}

export function writeConfig(storage, config) {
  storage.setItem(BACKUP_KEY, JSON.stringify(validateConfig(config)));
}

export function clearConfig(storage) {
  storage.removeItem(BACKUP_KEY);
}
