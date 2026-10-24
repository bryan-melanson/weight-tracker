/* The GitHub Contents API, reduced to the three calls a backup needs.

   Errors are turned into BackupError with a sentence the user can act on.
   The token is never put into an error message or any other string that could
   reach the screen, the console, or a log. */

const API = 'https://api.github.com';
const API_VERSION = '2022-11-28';

export class BackupError extends Error {
  constructor(message, { status = null, retryable = false } = {}) {
    super(message);
    this.name = 'BackupError';
    this.message = message;
    this.status = status;
    this.retryable = retryable;
  }
}

/* The API carries file contents as base64. Chunked rather than spread, so a
   long history cannot overflow the argument limit of String.fromCharCode. */
export function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  const CHUNK = 0x8000;
  let binary = '';
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK));
  }
  return btoa(binary);
}

export function fromBase64(encoded) {
  // What the API returns is line-wrapped, which atob will not accept.
  const binary = atob(encoded.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

/* One sentence per thing that can actually go wrong, naming the fix. */
function explain(status, fallback) {
  if (status === 401) {
    return new BackupError(
      'GitHub rejected the token. Create a new fine-grained token with Contents: Read and write on that repository.',
      { status },
    );
  }
  if (status === 403) {
    return new BackupError(
      'GitHub refused the request. The token may not have Contents: Read and write on that repository, or you have hit a rate limit.',
      { status },
    );
  }
  if (status === 404) {
    return new BackupError(
      'That repository does not exist, or the token cannot see it. Check the owner and name, and that the token lists this repository.',
      { status },
    );
  }
  if (status === 409) {
    return new BackupError('The file changed in GitHub since it was last read.', { status, retryable: true });
  }
  if (status >= 500) {
    return new BackupError(`GitHub is having trouble (${status}). The backup will be retried.`, { status, retryable: true });
  }
  return new BackupError(`GitHub refused the request (${status}): ${fallback}`, { status });
}

export function createGitHubClient(config, fetchImpl = globalThis.fetch) {
  const { token, owner, repo, path, branch } = config;
  const repoUrl = `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  // Each segment is encoded, but the slashes between them are real path
  // separators and must survive.
  const fileUrl = `${repoUrl}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': API_VERSION,
  };

  async function call(url, options = {}) {
    let response;
    try {
      response = await fetchImpl(url, { ...options, headers: { ...headers, ...(options.headers || {}) } });
    } catch {
      // A network failure, not an answer from GitHub: worth retrying later.
      throw new BackupError('Could not reach GitHub. The backup is still pending.', { retryable: true });
    }
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) throw explain(response.status, payload?.message || 'no reason given');
    return payload;
  }

  return {
    /* Confirms the token can see the repository before anything is written. */
    async checkAccess() {
      const repository = await call(repoUrl);
      return { fullName: repository.full_name, private: repository.private };
    },

    /* The file and its blob sha, or null when the repository has none yet. */
    async readFile() {
      try {
        const payload = await call(`${fileUrl}?ref=${encodeURIComponent(branch)}`);
        return { text: fromBase64(payload.content || ''), sha: payload.sha };
      } catch (error) {
        if (error instanceof BackupError && error.status === 404) return null;
        throw error;
      }
    },

    /* Create or replace the file. A null sha means "this should not exist
       yet"; GitHub refuses with 409 if it already does. */
    async writeFile(text, { sha = null, message }) {
      const payload = await call(fileUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, content: toBase64(text), branch, ...(sha ? { sha } : {}) }),
      });
      return { sha: payload.content?.sha ?? null };
    },
  };
}
