import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ValidationError } from '../../static/js/backend/validate.js';
import { createLocalApi } from '../../static/js/backend/local.js';
import { memoryAdapter } from './helpers/memory-adapter.js';
import { BackupError, createGitHubClient, fromBase64, toBase64 } from '../../static/js/backup/github.js';
import { readConfig, validateConfig, writeConfig } from '../../static/js/backup/config.js';
import { createBackupService } from '../../static/js/backup/service.js';

/* The backup pushes the whole CSV to one file in a private repo. It is
   one-way: the phone is the source of truth and nothing it does not ask for
   can come back and overwrite it. */

const CONFIG = { token: 'ghp_secret', owner: 'bryan-melanson', repo: 'weight-data', path: 'weight.csv', branch: 'main' };

const memoryStorage = () => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
};

/* A stand-in for the Contents API: one file, a sha that changes on write. */
function fakeGitHub({ file = null, failWith = null, onRequest = () => {} } = {}) {
  let state = file;
  let sha = file ? 'sha-0' : null;
  let writes = 0;
  const calls = [];

  const respond = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });

  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', headers: options.headers || {}, body: options.body });
    onRequest(calls.length, { url, options });
    if (failWith) {
      const error = failWith;
      failWith = null;
      throw error;
    }
    if (url.includes('/contents/')) {
      if ((options.method || 'GET') === 'GET') {
        if (state === null) return respond(404, { message: 'Not Found' });
        return respond(200, { content: toBase64(state), sha, encoding: 'base64' });
      }
      const sent = JSON.parse(options.body);
      if ((sent.sha || null) !== sha) return respond(409, { message: 'does not match' });
      state = fromBase64(sent.content);
      sha = `sha-${(writes += 1)}`;
      return respond(200, { content: { sha }, commit: { sha: 'commit', message: sent.message } });
    }
    return respond(200, { full_name: `${CONFIG.owner}/${CONFIG.repo}`, private: true, permissions: { push: true } });
  };

  return { fetchImpl, calls, read: () => state, writes: () => writes };
}

const rejects = async (promise, Type, pattern) => {
  let error = null;
  try {
    await promise;
  } catch (caught) {
    error = caught;
  }
  assert.ok(error instanceof Type, `expected ${Type.name}, got ${error}`);
  if (pattern) assert.match(error.message, pattern);
  return error;
};

describe('base64', () => {
  it('round-trips plain text', () => {
    assert.equal(fromBase64(toBase64('date,calories\n2026-10-01,2000\n')), 'date,calories\n2026-10-01,2000\n');
  });

  it('round-trips text outside ASCII', () => {
    const text = 'note: café ☕ — 1,900 kcal\n';
    assert.equal(fromBase64(toBase64(text)), text);
  });

  it('reads the line-wrapped base64 the API returns', () => {
    const wrapped = `${toBase64('hello world')}`.replace(/(.{4})/g, '$1\n');
    assert.equal(fromBase64(wrapped), 'hello world');
  });

  it('handles a file larger than one call stack of characters', () => {
    const big = 'x'.repeat(200000);
    assert.equal(fromBase64(toBase64(big)), big);
  });
});

describe('config', () => {
  it('normalizes a valid config', () => {
    assert.deepEqual(validateConfig({ ...CONFIG, owner: ' bryan-melanson ' }), CONFIG);
  });

  it('defaults the branch', () => {
    const { branch, ...rest } = CONFIG;
    assert.equal(validateConfig(rest).branch, 'main');
  });

  for (const [field, value] of [
    ['token', ''], ['owner', ''], ['owner', 'has space'], ['repo', ''], ['repo', 'a/b'],
    ['path', ''], ['path', '/leading.csv'], ['path', '../escape.csv'], ['path', 'notes.txt'],
  ]) {
    it(`rejects ${field}=${JSON.stringify(value)}`, () => {
      let error = null;
      try {
        validateConfig({ ...CONFIG, [field]: value });
      } catch (caught) {
        error = caught;
      }
      assert.ok(error instanceof ValidationError, `expected a ValidationError, got ${error}`);
      assert.equal(error.field, field);
    });
  }

  it('stores and reads a config back', () => {
    const storage = memoryStorage();
    writeConfig(storage, validateConfig(CONFIG));
    assert.deepEqual(readConfig(storage), CONFIG);
  });

  it('reads null when nothing is stored', () => {
    assert.equal(readConfig(memoryStorage()), null);
  });

  it('reads null rather than throwing on a corrupt record', () => {
    const storage = memoryStorage();
    storage.setItem('weight-tracker.backup', '{not json');
    assert.equal(readConfig(storage), null);
  });
});

describe('github client', () => {
  it('sends the token and the API version', async () => {
    const github = fakeGitHub({ file: 'date\n' });
    await createGitHubClient(CONFIG, github.fetchImpl).readFile();
    const { headers, url } = github.calls[0];
    assert.equal(headers.Authorization, `Bearer ${CONFIG.token}`);
    assert.equal(headers['X-GitHub-Api-Version'], '2022-11-28');
    assert.ok(url.startsWith('https://api.github.com/repos/bryan-melanson/weight-data/contents/weight.csv'));
    assert.match(url, /ref=main/);
  });

  it('reads a file and its sha', async () => {
    const github = fakeGitHub({ file: 'date,calories\n2026-10-01,2000\n' });
    const result = await createGitHubClient(CONFIG, github.fetchImpl).readFile();
    assert.equal(result.text, 'date,calories\n2026-10-01,2000\n');
    assert.equal(result.sha, 'sha-0');
  });

  it('reads null when the file is not there yet', async () => {
    const github = fakeGitHub({ file: null });
    assert.equal(await createGitHubClient(CONFIG, github.fetchImpl).readFile(), null);
  });

  it('writes a new file with no sha', async () => {
    const github = fakeGitHub({ file: null });
    await createGitHubClient(CONFIG, github.fetchImpl).writeFile('date\n', { sha: null, message: 'first' });
    assert.equal(github.read(), 'date\n');
  });

  it('writes over an existing file with its sha', async () => {
    const github = fakeGitHub({ file: 'old\n' });
    const client = createGitHubClient(CONFIG, github.fetchImpl);
    const { sha } = await client.readFile();
    await client.writeFile('new\n', { sha, message: 'update' });
    assert.equal(github.read(), 'new\n');
  });

  it('reports a stale sha as a conflict', async () => {
    const github = fakeGitHub({ file: 'old\n' });
    const client = createGitHubClient(CONFIG, github.fetchImpl);
    const error = await rejects(client.writeFile('new\n', { sha: 'stale', message: 'x' }), BackupError);
    assert.equal(error.status, 409);
  });

  it('explains a bad token rather than leaking it', async () => {
    const github = fakeGitHub({ file: 'x' });
    const unauthorised = async () => ({ ok: false, status: 401, json: async () => ({ message: 'Bad credentials' }) });
    const error = await rejects(createGitHubClient(CONFIG, unauthorised).readFile(), BackupError, /token/i);
    assert.equal(error.status, 401);
    assert.ok(!error.message.includes(CONFIG.token), 'the token must never appear in an error message');
    assert.ok(github);
  });

  it('explains a missing repository', async () => {
    const missing = async () => ({ ok: false, status: 404, json: async () => ({ message: 'Not Found' }) });
    await rejects(createGitHubClient(CONFIG, missing).checkAccess(), BackupError, /not found|does not exist/i);
  });
});

describe('backup service', () => {
  const build = ({ file = null } = {}) => {
    const api = createLocalApi(memoryAdapter());
    const github = fakeGitHub({ file });
    const storage = memoryStorage();
    const changes = [];
    const net = { up: true };
    // The network is cut here rather than inside the service, so nothing in
    // the shipped code exists only for the tests.
    const guarded = async (url, options) => {
      if (!net.up) throw new TypeError('Failed to fetch');
      return github.fetchImpl(url, options);
    };
    const service = createBackupService({
      api,
      storage,
      now: () => '2026-10-24T09:00:00Z',
      createClient: (config) => createGitHubClient(config, guarded),
      onChange: (state) => changes.push(state.status),
    });
    return { api, github, storage, service, changes, net };
  };

  it('starts switched off', () => {
    const { service } = build();
    assert.equal(service.state().status, 'off');
    assert.equal(service.state().configured, false);
  });

  it('connecting to an empty repo saves the config and pushes at once', async () => {
    const { service, github, storage } = build();
    const result = await service.connect(CONFIG);
    assert.equal(result.existingBackup, null);
    assert.equal(service.state().status, 'saved');
    assert.ok(github.read().startsWith('date,weight_kg'), 'the CSV should be in the repo');
    assert.deepEqual(readConfig(storage), CONFIG, 'the config should survive a restart');
  });

  it('connecting to a repo that already holds a backup does not overwrite it', async () => {
    // A replacement device pointed at its own history: pushing here would
    // destroy exactly what the user connected in order to get back.
    const existing = 'date,weight_kg,calories\n2026-10-01,80.5,2000\n2026-10-02,80.3,1900\n';
    const { service, github } = build({ file: existing });
    const result = await service.connect(CONFIG);
    assert.deepEqual(result.existingBackup, { days: 2 });
    assert.equal(github.writes(), 0, 'connecting must not write');
    assert.equal(github.read(), existing, 'the existing backup must be untouched');
    assert.equal(service.state().foundDays, 2);
    assert.equal(service.state().pending, true, 'the device data is still unsaved');
  });

  it('an explicit backup after that does replace it', async () => {
    const { service, github } = build({ file: 'date,calories\n2026-10-01,2000\n' });
    await service.connect(CONFIG);
    await service.backupNow();
    assert.equal(service.state().status, 'saved');
    assert.ok(!github.read().includes('2026-10-01'), 'the device is the source of truth once asked');
  });

  it('restoring clears the found-backup prompt', async () => {
    const { service } = build({ file: 'date,calories\n2026-10-01,2000\n' });
    await service.connect(CONFIG);
    assert.equal(service.state().foundDays, 1);
    await service.restore();
    assert.equal(service.state().foundDays, 0);
  });

  it('refuses a config that does not validate', async () => {
    const { service, storage } = build();
    await rejects(service.connect({ ...CONFIG, repo: '' }), ValidationError);
    assert.equal(readConfig(storage), null, 'nothing should be stored after a rejected connect');
    assert.equal(service.state().status, 'off');
  });

  it('pushes the current data, not a stale copy', async () => {
    const { service, api, github } = build();
    await service.connect(CONFIG);
    await api.saveEntry('2026-10-20', { weight_kg: 80.5, calories: 2000 });
    await service.backupNow();
    assert.match(github.read(), /2026-10-20,80\.5,2000/);
  });

  it('creates the file when the repo has none yet', async () => {
    const { service, github } = build({ file: null });
    await service.connect(CONFIG);
    assert.equal(github.writes(), 1);
  });

  it('retries once when the sha went stale underneath it', async () => {
    const github = fakeGitHub({ file: 'old\n' });
    const api = createLocalApi(memoryAdapter());
    let first = true;
    const racing = async (url, options) => {
      // Let the first write see a sha that is already out of date.
      if (options?.method === 'PUT' && first) {
        first = false;
        return { ok: false, status: 409, json: async () => ({ message: 'does not match' }) };
      }
      return github.fetchImpl(url, options);
    };
    const service = createBackupService({
      api, storage: memoryStorage(), now: () => 'now',
      createClient: (config) => createGitHubClient(config, racing),
      onChange: () => {},
    });
    await service.connect(CONFIG);
    assert.equal(service.state().status, 'saved');
    assert.ok(github.read().startsWith('date,weight_kg'));
  });

  it('keeps the change pending when the network is down', async () => {
    const { service, api, github, net } = build();
    await service.connect(CONFIG);
    await api.saveEntry('2026-10-20', { calories: 2000 });
    const before = github.writes();
    net.up = false;
    await service.markChanged();
    assert.equal(service.state().status, 'error');
    assert.equal(service.state().pending, true, 'the change must stay pending for the next attempt');
    assert.equal(github.writes(), before, 'nothing was written');
    assert.match(service.state().lastError, /could not reach github/i);
  });

  it('clears pending once a later attempt succeeds', async () => {
    const { service, api, net } = build();
    await service.connect(CONFIG);
    net.up = false;
    await api.saveEntry('2026-10-20', { calories: 2000 });
    await service.markChanged();
    assert.equal(service.state().pending, true);
    net.up = true;
    await service.backupNow();
    assert.equal(service.state().status, 'saved');
    assert.equal(service.state().pending, false);
  });

  it('a later push carries the edits made while it was offline', async () => {
    const { service, api, github, net } = build();
    await service.connect(CONFIG);
    net.up = false;
    await api.saveEntry('2026-10-20', { calories: 2000 });
    await service.markChanged();
    await api.saveEntry('2026-10-21', { calories: 1900 });
    await service.markChanged();
    net.up = true;
    await service.backupNow();
    assert.match(github.read(), /2026-10-20/);
    assert.match(github.read(), /2026-10-21/, 'both offline edits must reach the backup');
  });

  it('records when the last backup happened', async () => {
    const { service } = build();
    await service.connect(CONFIG);
    assert.equal(service.state().lastBackupAt, '2026-10-24T09:00:00Z');
  });

  it('restores by importing the backed-up file', async () => {
    const { service, api } = build({ file: 'date,weight_kg,calories\n2026-10-01,80.5,2000\n2026-10-02,80.3,1900\n' });
    await service.connect({ ...CONFIG });
    const result = await service.restore();
    assert.equal(result.imported, 2);
    const state = await api.getState();
    assert.deepEqual(state.entries.map((e) => e.date), ['2026-10-01', '2026-10-02']);
  });

  it('refuses to restore when the repo has no backup', async () => {
    const { service } = build({ file: null });
    await service.connect(CONFIG);
    await rejects(service.restore(), BackupError, /no backup/i);
  });

  it('disconnecting forgets the token', async () => {
    const { service, storage } = build();
    await service.connect(CONFIG);
    service.disconnect();
    assert.equal(readConfig(storage), null);
    assert.equal(service.state().status, 'off');
    assert.equal(JSON.stringify(service.state()).includes(CONFIG.token), false);
  });

  it('never exposes the token in the state it publishes to the UI', async () => {
    const { service } = build();
    await service.connect(CONFIG);
    assert.equal(JSON.stringify(service.state()).includes(CONFIG.token), false);
  });

  it('does nothing at all while switched off', async () => {
    const { service, github } = build();
    await service.backupNow();
    assert.equal(github.writes(), 0);
    assert.equal(service.state().status, 'off');
  });

  it('writes a commit message naming what was backed up', async () => {
    const { service, api, github } = build();
    await service.connect(CONFIG);
    await api.saveEntry('2026-10-20', { calories: 2000 });
    await service.backupNow();
    const put = github.calls.filter((c) => c.method === 'PUT').pop();
    assert.match(JSON.parse(put.body).message, /1 day/);
  });
});
