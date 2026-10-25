// ---------------------------------------------------------------------------
// The cards every account gets, on chain (pnw_mvp_v2 hewn_cards_v1, deployed
// 2026-10-25; the design in docs/HEWN_ART.md):
//
//   hewn_cards_v1::issue_business_card(<hash>field, <industry>u8)
//   hewn_cards_v1::issue_worker_card(<hash>field, <shown>)
//   hewn_cards_v1::show_card(<hash>field), hide_card(<hash>field)
//
// Each call checks with the registry that the signer owns the name (the
// industry code for a business, 0 for a worker). What the chain keeps is
// one entry, cards[name_hash] = { issued_at, shown }: the block the card was
// issued at, where time on Hewn counts from, and whether it is shown. Nothing
// else; the picture is drawn from the name. Pure apart from the injected
// reads: no wallet, no React, no storage, nothing logged.
// ---------------------------------------------------------------------------

import { ENV } from "@pnw/config/env";
import { PROGRAMS } from "@pnw/config/programs";
import type { Card } from "@/books/card";

export const CARDS_PROGRAM: string = PROGRAMS.cards.hewn_cards;
export const ISSUE_BUSINESS_CARD = { program: CARDS_PROGRAM, function: "issue_business_card" } as const;
export const ISSUE_WORKER_CARD = { program: CARDS_PROGRAM, function: "issue_worker_card" } as const;
export const SHOW_CARD = { program: CARDS_PROGRAM, function: "show_card" } as const;
export const HIDE_CARD = { program: CARDS_PROGRAM, function: "hide_card" } as const;

export class CardsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CardsError";
  }
}

const FIELD = /^\d+$/;

/** A name hash as the program takes it: decimal digits, the `field` suffix once. */
export function fieldInput(nameHash: string): string {
  const bare = nameHash.trim().replace(/field$/, "");
  if (!FIELD.test(bare)) throw new CardsError("That isn't a registered name's hash");
  return `${bare}field`;
}

/** The two inputs of `issue_business_card`: the name and the industry it was registered under. */
export function issueBusinessCardInputs(nameHash: string, industryCode: number): string[] {
  if (!Number.isInteger(industryCode) || industryCode < 1 || industryCode > 40) {
    throw new CardsError("The business name's industry isn't known; try again in a moment");
  }
  return [fieldInput(nameHash), `${industryCode}u8`];
}

/** The two inputs of `issue_worker_card`: the name, and whether the card starts shown. */
export function issueWorkerCardInputs(nameHash: string, shown: boolean): string[] {
  return [fieldInput(nameHash), shown ? "true" : "false"];
}

/** The one input of `show_card` and `hide_card`. */
export function switchCardInputs(nameHash: string): string[] {
  return [fieldInput(nameHash)];
}

const MAX_HEIGHT = 0xffff_ffff;

/** `cards[name_hash]` from the explorer's text: `{ issued_at: 20801930u32, shown: true }`. */
export function parseCard(raw: string): Card {
  const height = /\bissued_at\s*:\s*(\d+)u32\b/.exec(raw)?.[1];
  const shown = /\bshown\s*:\s*(true|false)\b/.exec(raw)?.[1];
  const issuedAt = height ? Number(height) : Number.NaN;
  if (!Number.isInteger(issuedAt) || issuedAt > MAX_HEIGHT || !shown) throw new CardsError("The card couldn't be read");
  return { issuedAt, shown: shown === "true" };
}

/** One mapping value, as the explorer returns it; null when the name has no card. */
export type CardsRead = (nameHash: string) => Promise<string | null>;

export function explorerCardsRead(endpoint: string = ENV.ALEO_ENDPOINT, fetchImpl: typeof fetch = fetch): CardsRead {
  return async (nameHash) => {
    const url = `${endpoint}/program/${CARDS_PROGRAM}/mapping/cards/${fieldInput(nameHash)}`;
    const res = await fetchImpl(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    if (res.status === 404) return null;
    if (!res.ok) throw new CardsError("The card couldn't be read; try again in a moment");
    const data: unknown = await res.json();
    return data === null || data === undefined ? null : typeof data === "string" ? data : JSON.stringify(data);
  };
}

/** The name's card as the chain has it, or null when none was issued. */
export async function queryCard(nameHash: string, read: CardsRead = explorerCardsRead()): Promise<Card | null> {
  const raw = await read(nameHash);
  return raw === null ? null : parseCard(raw);
}

export type AwaitOptions = {
  read?: CardsRead;
  /** What the entry must say before it counts (a switch waits for its new state). */
  until?: (card: Card) => boolean;
  attempts?: number;
  waitMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

/**
 * After Shield says a card transaction was accepted: the entry as the explorer shows it, which
 * can lag the acceptance by a few blocks. A read that fails on the way is tried again.
 */
export async function awaitCard(nameHash: string, options: AwaitOptions = {}): Promise<Card> {
  const read = options.read ?? explorerCardsRead();
  const until = options.until ?? (() => true);
  const attempts = options.attempts ?? 15;
  const waitMs = options.waitMs ?? 4_000;
  const sleep = options.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let i = 0; i < attempts; i++) {
    const card = await queryCard(nameHash, read).catch(() => null);
    if (card && until(card)) return card;
    if (i + 1 < attempts) await sleep(waitMs);
  }
  throw new CardsError("The network accepted it, but the card isn't showing yet. Check again in a minute.");
}

/** When a block was made, ISO, from the explorer; null when it can't be read. */
export async function blockTime(height: number, endpoint: string = ENV.ALEO_ENDPOINT, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  if (!Number.isInteger(height) || height < 0) return null;
  try {
    const res = await fetchImpl(`${endpoint}/block/${height}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    const ts = (data as { header?: { metadata?: { timestamp?: unknown } } } | null)?.header?.metadata?.timestamp;
    const seconds = typeof ts === "number" ? ts : typeof ts === "string" ? Number(ts) : Number.NaN;
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    return new Date(seconds * 1000).toISOString();
  } catch {
    return null;
  }
}
