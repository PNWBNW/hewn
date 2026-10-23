// ---------------------------------------------------------------------------
// Who a coworker is, as the chain says (Joshua, 2026-10-23: the twin-curve
// way, in place of a longer safety code).
//
// Letters are sealed to an account on the Aleo curve, so only that account
// can open them, and a coworker's letters are believed only from the account
// the business listed for them (chain/letters.ts `letterReader`). Swapping a
// coworker's P-256 key gets the business nothing: the letters still go to the
// coworker's account. To sit in the middle it would have to list an account
// of its own, and the registry would then name that account's owner, not the
// coworker. So the app shows each coworker's registered name, read for their
// account: the primary name the account set, still owned by it, with its text
// checked against its hash (lookupAddress).
//
// Nothing new goes on chain and nothing is signed: a few public reads per
// account, kept in the vault for a day (books/directory.ts `ConfirmedName`).
// The explorer sees which account was looked up, as with every name lookup.
// A read that fails reads as "not confirmed", never as someone else's name.
// Nothing here logs an account or a name.
// ---------------------------------------------------------------------------

import { type DirectoryReads, directoryReads, lookupAddress } from "./directory";

export type NameCheck =
  /** A person's registered name, owned by this account. */
  | { status: "person"; name: string }
  /** A business's account: never a coworker's (one kind of account per wallet). */
  | { status: "business"; name: string }
  /** No name the chain stands behind, or the chain couldn't be reached. */
  | { status: "unconfirmed" };

/** The registered name the chain confirms for this account. */
export async function checkAccountName(address: string, reads: DirectoryReads = directoryReads): Promise<NameCheck> {
  try {
    const entry = await lookupAddress(address, reads);
    if (entry.kind === "business") return { status: "business", name: entry.name };
    return entry.name ? { status: "person", name: entry.name } : { status: "unconfirmed" };
  } catch {
    return { status: "unconfirmed" };
  }
}
