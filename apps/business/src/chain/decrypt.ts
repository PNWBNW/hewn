// ---------------------------------------------------------------------------
// Opens one transition (the explorer's JSON for it) with a transition view key
// from Shield, using the SDK. Loaded only when a page actually opens one: the
// SDK is WebAssembly and large. Nothing is logged.
// ---------------------------------------------------------------------------

/** The explorer's JSON for a transition, with its private inputs and outputs readable. */
export async function decryptTransition(transition: unknown, tvk: string): Promise<unknown> {
  const { Field, Transition } = await import("@provablehq/sdk");
  const opened = Transition.fromString(JSON.stringify(transition)).decryptTransition(Field.fromString(tvk));
  return JSON.parse(opened.toString());
}

/** The explorer's copy of a transaction; null when it doesn't have it. */
export async function fetchExplorerTransaction(id: string, endpoint: string, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  const res = await fetchImpl(`${endpoint.replace(/\/+$/, "")}/transaction/${id}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`The network answered ${res.status}`);
  return res.json();
}

/** The account a view key reads (books/view_key.ts): what it's checked against before it's kept. Throws on a malformed key. */
export async function viewKeyAccount(viewKey: string): Promise<string> {
  const { Address, ViewKey } = await import("@provablehq/sdk");
  return Address.from_view_key(ViewKey.from_string(viewKey)).to_string();
}

/**
 * A record from the network's copy of a transaction, opened with this account's view key: its
 * plain text, or null when the record isn't this account's. Runs on this device only; the key
 * goes nowhere.
 */
export async function openOwnRecord(ciphertext: string, viewKey: string): Promise<string | null> {
  const { RecordCiphertext, ViewKey } = await import("@provablehq/sdk");
  const key = ViewKey.from_string(viewKey);
  const record = RecordCiphertext.fromString(ciphertext);
  return record.isOwner(key) ? record.decrypt(key).toString() : null;
}
