// ---------------------------------------------------------------------------
// How network fees are paid: from the account's public ALEO (the default so
// far) or from its private ALEO records (Joshua, 2026-10-16: the goal is
// private by default, for payments and everything else). With a private fee
// the network sees a `fee_private` paid from a record, not the address that
// sent the transaction.
//
// While it is being tested, the choice is a per-device switch (a convenience,
// not a book of record). Nothing ever falls back from private to public on
// its own: with the switch on, a send with no private ALEO fails rather than
// quietly showing the address.
// ---------------------------------------------------------------------------

export type FeeMode = "public" | "private";

/** The browser key for this device's choice. */
export const FEE_MODE_KEY = "hewn.fee-mode";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const browserStore = (): Store | null => {
  try {
    return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
  } catch {
    return null; // storage blocked: the default applies
  }
};

/** This device's fee mode; public unless private was chosen. */
export function readFeeMode(store: Store | null = browserStore()): FeeMode {
  try {
    return store?.getItem(FEE_MODE_KEY) === "private" ? "private" : "public";
  } catch {
    return "public";
  }
}

/** Saves this device's fee mode. Returns false when the browser wouldn't keep it. */
export function writeFeeMode(mode: FeeMode, store: Store | null = browserStore()): boolean {
  try {
    if (!store) return false;
    if (mode === "private") store.setItem(FEE_MODE_KEY, "private");
    else store.removeItem(FEE_MODE_KEY);
    return true;
  } catch {
    return false;
  }
}

/** The same call, with its fee paid the way `mode` says. */
export function withFeeMode<T extends { privateFee?: boolean }>(opts: T, mode: FeeMode): T & { privateFee: boolean } {
  return { ...opts, privateFee: mode === "private" };
}
