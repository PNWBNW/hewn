// ---------------------------------------------------------------------------
// A card anyone can open, from a name (docs/HEWN_ART.md): the registry says
// whose name it is and of what kind, the cards program (hewn_cards_v1) says
// whether a card was issued and whether it is shown, and the block it was
// issued at says since when. Public reads only, and only of what is public
// by design: the registry's mappings and `cards[name_hash]`, which hold a
// hash, a kind, a block height and a flag. No account is needed, nothing is
// written, and nothing about the reader or the name is logged.
//
// What the page may draw is decided here: a card is drawn only while the
// chain says it is shown. To a visitor, a worker's hidden card and a name
// with no card read the same ("no public card"): the page says nothing
// about a person beyond what it draws.
// ---------------------------------------------------------------------------

import { computeNameHash } from "@pnw/records/registry/name_registry";
import type { Card } from "@/books/card";
import { type CardsRead, blockTime, explorerCardsRead, queryCard } from "./cards";
import { type DirectoryReads, type NameKind, DirectoryError, NAME_FORMAT, bareDirectoryName, directoryReads, nameKindOf } from "./directory";

export type PublicCardReads = {
  directory: DirectoryReads;
  card: CardsRead;
  /** When a block was made, ISO; null when it can't be read. */
  blockTime: (height: number) => Promise<string | null>;
};

export const publicCardReads = (): PublicCardReads => ({ directory: directoryReads, card: explorerCardsRead(), blockTime });

export type PublicCard =
  /** A card the chain says is shown: the page draws it. */
  | { state: "shown"; name: string; nameHash: string; kind: NameKind; card: Card }
  /** A registered name with nothing to draw: no card issued, or a worker's hidden one. */
  | { state: "none"; name: string; kind: NameKind }
  /** Nobody has registered the name. */
  | { state: "unregistered"; name: string };

/** A name as typed (any case, with or without the suffix) → its public card, or why there isn't one. Bad input throws before anything is read. */
export async function lookupPublicCard(text: string, suffix: string, reads: PublicCardReads = publicCardReads()): Promise<PublicCard> {
  const name = bareDirectoryName(text, suffix);
  if (!name) throw new DirectoryError("Enter a name");
  if (!NAME_FORMAT.test(name)) throw new DirectoryError("Names are 3 to 16 characters: lower-case letters, digits and underscores");
  const nameHash = computeNameHash(name);
  const owner = await reads.directory.nameOwner(nameHash);
  if (!owner) return { state: "unregistered", name };
  const kind = await nameKindOf(nameHash, owner, reads.directory);
  const card = await queryCard(nameHash, reads.card);
  if (!card?.shown) return { state: "none", name, kind };
  const since = await reads.blockTime(card.issuedAt);
  return { state: "shown", name, nameHash, kind, card: since ? { ...card, since } : card };
}
