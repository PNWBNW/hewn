// ---------------------------------------------------------------------------
// The card every account gets (docs/HEWN_ART.md), as the vault remembers it:
// what hewn_cards_v1 keeps on chain for the name (the block the card was
// issued at, where time on Hewn counts from, and whether it is shown), plus
// the issue block's date once the app has read it. The chain is the truth;
// this is the copy the app shows without a network read. Pure.
// ---------------------------------------------------------------------------

export type Card = {
  /** The block height the card was issued at. */
  issuedAt: number;
  /** Shown publicly: always for a business, the worker's choice. */
  shown: boolean;
  /** The issue block's time, ISO, once read from the explorer. */
  since?: string;
};

export class CardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CardError";
  }
}

const MAX_HEIGHT = 0xffff_ffff;

export function validateCard(raw: unknown): Card {
  if (!raw || typeof raw !== "object") throw new CardError("A card must be an object");
  const c = raw as Partial<Card>;
  if (typeof c.issuedAt !== "number" || !Number.isInteger(c.issuedAt) || c.issuedAt < 0 || c.issuedAt > MAX_HEIGHT) {
    throw new CardError("A card needs the block it was issued at");
  }
  if (typeof c.shown !== "boolean") throw new CardError("A card needs to say whether it is shown");
  const card: Card = { issuedAt: c.issuedAt, shown: c.shown };
  if (c.since !== undefined) {
    if (typeof c.since !== "string" || Number.isNaN(Date.parse(c.since))) throw new CardError("A card's date must be a date");
    card.since = c.since;
  }
  return card;
}

/**
 * When the cards program went live: its deploy block, 2026-10-25 00:08 UTC. An account set up
 * before it claims its card from Settings; one set up since gets it as the last step of setup.
 */
export const CARDS_SINCE = "2026-10-25T00:08:18.000Z";
