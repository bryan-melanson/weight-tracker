/* Keeping a copy of the data in a private GitHub repository.

   One way only: the device is the source of truth and pushes the whole CSV to
   one file. Nothing comes back unless you ask for it with restore(), so a
   backup can never overwrite what is on the device by surprise.

   Pushing the whole file rather than a change log is what makes this safe
   offline: an attempt that fails leaves the change pending, and the next
   successful push carries everything, in any order, with no queue to replay. */

import { parseRows } from '../backend/csv.js';
import { BackupError, createGitHubClient } from './github.js';
import { clearConfig, readConfig, validateConfig, writeConfig } from './config.js';

const OFF = 'off';
const IDLE = 'idle';
const SAVING = 'saving';
const SAVED = 'saved';
const ERROR = 'error';

function commitMessage(csv, today) {
  const days = Math.max(0, parseRows(csv).length - 1); // minus the header
  return `Weight tracker backup: ${days} day${days === 1 ? '' : 's'} (${today})`;
}

export function createBackupService({
  api,
  storage,
  now = () => new Date().toISOString(),
  createClient = (config) => createGitHubClient(config),
  onChange = () => {},
}) {
  let config = readConfig(storage);
  let client = config ? createClient(config) : null;
  let inFlight = null;

  const state = {
    configured: Boolean(config),
    status: config ? IDLE : OFF,
    pending: false,
    lastBackupAt: null,
    lastError: null,
    // Days found already in the repository when connecting, so the UI can
    // offer to restore instead of silently replacing them.
    foundDays: 0,
    // Enough for the UI to show where backups go. The token is deliberately
    // not here: this object is what gets rendered and serialised.
    repo: config ? `${config.owner}/${config.repo}` : null,
    path: config ? config.path : null,
  };

  const publish = (changes) => {
    Object.assign(state, changes);
    onChange({ ...state });
  };

  /* One push: read the current sha, write the whole file over it. A 409 means
     something else wrote in between — read the new sha and go once more. */
  async function push() {
    const csv = await api.exportCsv();
    const message = commitMessage(csv, now().slice(0, 10));
    const existing = await client.readFile();
    try {
      await client.writeFile(csv, { sha: existing?.sha ?? null, message });
    } catch (error) {
      if (!(error instanceof BackupError) || error.status !== 409) throw error;
      const current = await client.readFile();
      await client.writeFile(csv, { sha: current?.sha ?? null, message });
    }
  }

  async function run() {
    publish({ status: SAVING, lastError: null });
    try {
      await push();
      publish({ status: SAVED, pending: false, lastBackupAt: now(), lastError: null });
    } catch (error) {
      // The change stays pending: the next attempt sends everything anyway.
      publish({ status: ERROR, pending: true, lastError: error.message });
    }
  }

  return {
    state: () => ({ ...state }),

    /* Validate, prove the token can reach the repository, then look before
       writing anything.

       An empty repository is first-time setup, so the data goes up straight
       away. A repository that already holds a backup is almost certainly a
       replacement device being pointed at its own history — pushing would
       destroy exactly what the user came to recover. So it stops and reports
       what it found, and the choice to restore or to overwrite is theirs. */
    async connect(raw) {
      const candidate = validateConfig(raw);
      const candidateClient = createClient(candidate);
      await candidateClient.checkAccess();
      const existing = await candidateClient.readFile();
      const days = existing ? Math.max(0, parseRows(existing.text).length - 1) : 0;

      config = candidate;
      client = candidateClient;
      writeConfig(storage, config);
      publish({
        configured: true,
        repo: `${config.owner}/${config.repo}`,
        path: config.path,
        pending: true,
        foundDays: days,
      });

      if (days > 0) {
        publish({ status: IDLE });
        return { existingBackup: { days } };
      }
      await run();
      return { existingBackup: null };
    },

    disconnect() {
      clearConfig(storage);
      config = null;
      client = null;
      publish({
        configured: false, status: OFF, pending: false,
        lastBackupAt: null, lastError: null, repo: null, path: null, foundDays: 0,
      });
    },

    /* Called after every change to the data. Backing up is fire-and-forget:
       the status line reports it, and a failure leaves the change pending. */
    markChanged() {
      if (!client) return null;
      publish({ pending: true });
      return this.backupNow();
    },

    /* Concurrent calls share one push, so a burst of edits cannot stack up
       writes that race each other for the sha. */
    backupNow() {
      if (!client) return Promise.resolve();
      if (!inFlight) {
        inFlight = run().finally(() => { inFlight = null; });
      }
      return inFlight;
    },

    /* The deliberate act: pull the backed-up file and import it. Import
       merges by date, so this restores onto an empty device and tops up a
       partial one without discarding anything it does not mention. */
    async restore() {
      if (!client) throw new BackupError('Backups are not switched on.');
      const file = await client.readFile();
      // A header with no rows under it is a file, but not a backup.
      if (!file || parseRows(file.text).length <= 1) {
        throw new BackupError('There is no backup in that repository yet.');
      }
      const result = await api.importCsv(file.text);
      publish({ foundDays: 0 });
      return result;
    },
  };
}
