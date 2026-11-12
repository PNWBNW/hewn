// ---------------------------------------------------------------------------
// The business name an offer shows. An agreement record carries the hash of the
// business's name, and the agreement program (v5) takes that hash as the sender
// gives it: on chain it binds the sending account, not the name. So the name is
// shown only when the registry says the account that sent the offer owns it,
// read from the network each time; otherwise the account is shown and the offer
// can't be accepted. Pure apart from the injected reads.
// ---------------------------------------------------------------------------

import { nameMatchesHash, queryNameOwner, queryNamePlaintext } from "@pnw/records/registry/name_registry";

export type NameReads = {
  /** Who owns a name hash, or null when it is free or the network didn't answer. */
  owner: (nameHash: string) => Promise<string | null>;
  /** A name's text, only when it hashes back to the hash; otherwise null. */
  plaintext: (nameHash: string) => Promise<string | null>;
};

export const registryNameReads: NameReads = {
  owner: (h) => queryNameOwner(h),
  plaintext: (h) => queryNamePlaintext(h),
};

/**
 * - `owned`: the sending account owns the name; `name` is its text when the registry has it.
 * - `not-theirs`: the name belongs to another account, or to none.
 * - `unknown`: the registry couldn't be asked; nothing is shown and nothing can be accepted until it can.
 */
export type EmployerName = { state: "owned"; name?: string } | { state: "not-theirs" } | { state: "unknown" };

export const NAME_NOT_THEIRS = "The business name on this offer doesn't belong to the account that sent it, so it isn't shown and the offer can't be accepted.";
export const NAME_UNCONFIRMED = "Couldn't confirm the business name with the registry, so the offer can't be accepted yet. Try again in a moment.";

const bare = (v: string) => v.replace(/\.(private|public)$/, "").replace(/field$/, "").trim();

/**
 * The name to show for an offer's business, checked against who sent it. `kept` is a name this
 * device stored before; it is used only when it still hashes to the record and the sender still
 * owns the hash, and it saves the text lookup, not the ownership check.
 */
export async function employerNameFor(nameHash: string, sender: string, kept: string | undefined, reads: NameReads = registryNameReads): Promise<EmployerName> {
  const hash = bare(nameHash);
  if (!hash || !sender) return { state: "not-theirs" };
  let owner: string | null;
  try {
    owner = await reads.owner(hash);
  } catch {
    return { state: "unknown" };
  }
  // The registry answers null both for a free name and for no answer: either way nothing is confirmed.
  if (owner === null) return { state: "unknown" };
  if (bare(owner) !== bare(sender)) return { state: "not-theirs" };
  if (kept && nameMatchesHash(kept, hash)) return { state: "owned", name: kept };
  const name = await reads.plaintext(hash).catch(() => null);
  return name ? { state: "owned", name } : { state: "owned" };
}
