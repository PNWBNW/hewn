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
