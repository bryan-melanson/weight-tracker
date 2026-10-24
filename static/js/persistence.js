/* Asking the browser to keep the data.

   Safari exempts a home-screen web app from the seven-day eviction that
   clears a plain tab's storage, but the stronger guarantee — "do not reclaim
   this under storage pressure" — is only given to an origin that asks for it.
   iOS grants it to an installed app silently, with no prompt.

   It is asked for after the first successful save rather than at startup, so
   that on the browsers which do prompt, the question arrives attached to the
   moment the user actually stored something. */

let asked = false;

export async function ensurePersisted() {
  if (asked || !navigator.storage?.persist) return null;
  asked = true;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    // Nothing to do about a refusal, and nothing worth interrupting for.
    return null;
  }
}

/* How much room the data has, for the backup panel to report. Returns null
   where the browser will not say. */
export async function storageEstimate() {
  if (!navigator.storage?.estimate) return null;
  try {
    const { usage, quota } = await navigator.storage.estimate();
    return usage === undefined || quota === undefined ? null : { usage, quota };
  } catch {
    return null;
  }
}
