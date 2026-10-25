// ---------------------------------------------------------------------------
// The "For review" list: money that moved in or out of the linked Shield
// account after the books started, each waiting for the business to say what
// it was. Accepting one posts it (the Shield account on one side, the account
// the business picked on the other); excluding one keeps it out of the books.
// Moves inside the account itself and payments the app already recorded are
// settled automatically and never ask anything.
//
// Items are found by src/chain (review_feed.ts) and kept here, in the vault.
// The amount is kept as it arrived, in six-decimal minor units; the books
// keep cents, so anything under a cent is left out of the posting.
//
// Pure: no network, no React, no storage.
// ---------------------------------------------------------------------------

import { type Books, type IsoDate, type NameRef, type Tags, addAccount, baseOf, findEntry, postEntry, reverseEntry } from "@pnw/ledger";
import { RAIL_ACCOUNT_NAME, ensureRailAccount } from "@pnw/payroll";
import type { Company } from "./company";
import { isShieldFamily } from "./funds";
import { minorToCents } from "./opening";

export type ReviewStatus =
  /** Waiting for the business. */
  | "new"
  /** Posted to the books (`entryId`). */
  | "accepted"
  /** Kept out of the books on purpose. */
  | "excluded"
  /** Already in the books: a payment the app made itself (a paycheck, say). */
  | "recorded"
  /** A move inside the account (public to private, say): nothing to post. */
  | "internal";

export type ReviewItem = {
  /** The transaction id; one item per transaction. */
  id: string;
  /** YYYY-MM-DD, the day the network accepted it. */
  date: string;
  /** ISO time, when known. */
  at?: string;
  direction: "in" | "out";
  /** Six-decimal minor units, as a decimal string. */
  minor: string;
  /** The other side's account, when known. */
  counterparty?: string;
  /** What the network calls the movement; kept for the record, never shown. */
  kind: string;
  status: ReviewStatus;
  /** Set once accepted. */
  entryId?: string;
};

export type Review = { version: 1; items: ReviewItem[] };

export class ReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewError";
  }
}

export const emptyReview = (): Review => ({ version: 1, items: [] });

const STATUSES: readonly ReviewStatus[] = ["new", "accepted", "excluded", "recorded", "internal"];
const TX_ID = /^at1[a-z0-9]{20,80}$/;
const ADDRESS = /^aleo1[a-z0-9]{58}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MINOR = /^\d{1,30}$/;
const KIND = /^[a-z0-9_]{1,64}$/;

function validateItem(raw: unknown): ReviewItem {
  const r = raw as Partial<ReviewItem> | null;
  if (!r || typeof r !== "object") throw new ReviewError("Each item must be an object");
  if (typeof r.id !== "string" || !TX_ID.test(r.id)) throw new ReviewError("Each item needs a transaction id");
  if (typeof r.date !== "string" || !DATE.test(r.date)) throw new ReviewError("Each item needs a date");
  if (r.direction !== "in" && r.direction !== "out") throw new ReviewError("Each item is money in or money out");
  if (typeof r.minor !== "string" || !MINOR.test(r.minor)) throw new ReviewError("Each item needs an amount");
  if (typeof r.kind !== "string" || !KIND.test(r.kind)) throw new ReviewError("Each item needs a kind");
  if (!STATUSES.includes(r.status as ReviewStatus)) throw new ReviewError("Unknown review status");
  const item: ReviewItem = { id: r.id, date: r.date, direction: r.direction, minor: r.minor, kind: r.kind, status: r.status as ReviewStatus };
  if (r.at !== undefined) {
    if (typeof r.at !== "string" || Number.isNaN(Date.parse(r.at))) throw new ReviewError("A time must be a date");
    item.at = r.at;
  }
  if (r.counterparty !== undefined) {
    if (typeof r.counterparty !== "string" || !ADDRESS.test(r.counterparty)) throw new ReviewError("The other side must be an account");
    item.counterparty = r.counterparty;
  }
  if (r.entryId !== undefined) {
    if (typeof r.entryId !== "string" || !r.entryId) throw new ReviewError("An entry id must be text");
    item.entryId = r.entryId;
  }
  if (item.status === "accepted" && !item.entryId) throw new ReviewError("An accepted item needs its entry");
  return item;
}

/** Checks every item; a transaction listed twice keeps its later copy. */
export function validateReview(raw: unknown): Review {
  const r = raw as Partial<Review> | null;
  if (!r || typeof r !== "object") throw new ReviewError("The review list must be an object");
  if (r.version !== 1) throw new ReviewError("Unknown review list version");
  if (!Array.isArray(r.items)) throw new ReviewError("The review items must be a list");
  const byId = new Map<string, ReviewItem>();
  for (const item of r.items.map(validateItem)) byId.set(item.id, item);
  return { version: 1, items: [...byId.values()] };
}

export const reviewToJson = (r: Review): string => JSON.stringify(validateReview(r));
export const reviewFromJson = (text: string): Review => validateReview(JSON.parse(text));

/** Newest first, then by id so the order is stable. */
export function byNewest(items: readonly ReviewItem[]): ReviewItem[] {
  return [...items].sort((a, b) => (a.at ?? a.date) < (b.at ?? b.date) ? 1 : (a.at ?? a.date) > (b.at ?? b.date) ? -1 : a.id < b.id ? -1 : 1);
}

export const waitingCount = (r: Review | null | undefined): number => r?.items.filter((i) => i.status === "new").length ?? 0;

/** Transaction ids the list already holds, in any status: the feed skips them. */
export const knownIds = (r: Review | null | undefined): Set<string> => new Set(r?.items.map((i) => i.id) ?? []);

/** Transaction ids of paychecks the app settled itself: these are already in the books. */
export function recordedIds(company: Pick<Company, "payroll">): Set<string> {
  const ids = new Set<string>();
  for (const run of company.payroll.runs) {
    for (const p of run.paychecks) if (p.settlement.reference && TX_ID.test(p.settlement.reference)) ids.add(p.settlement.reference);
  }
  return ids;
}

/**
 * Adds newly found movements. Ones already listed are left alone, so a check can run any number
 * of times; a paycheck the app paid is marked recorded on the way in.
 */
export function addReviewItems(company: Company, found: readonly ReviewItem[]): Company {
  const review = company.review ?? emptyReview();
  const known = knownIds(review);
  const recorded = recordedIds(company);
  // One movement described oddly is left out; it never stops the rest coming in.
  const readable = found.flatMap((i) => {
    try {
      return [validateItem(i)];
    } catch {
      return [];
    }
  });
  const fresh = readable
    .filter((i) => !known.has(i.id))
    .map((i): ReviewItem => (i.status === "new" && recorded.has(i.id) ? { ...i, status: "recorded" } : i));
  if (fresh.length === 0) return company;
  return { ...company, review: validateReview({ version: 1, items: [...review.items, ...fresh] }) };
}

function itemOf(company: Company, id: string): ReviewItem {
  const item = company.review?.items.find((i) => i.id === id);
  if (!item) throw new ReviewError("That transaction isn't in the review list");
  return item;
}

function withItem(company: Company, item: ReviewItem): Company {
  const review = company.review ?? emptyReview();
  return { ...company, review: validateReview({ ...review, items: review.items.map((i) => (i.id === item.id ? item : i)) }) };
}

export type AcceptInput = {
  /** The account on the other side: income for money in, expense for money out, equity for the owner. */
  accountId: string;
  /** Which part of the Shield account it came out of or went into: General (the Shield account itself, the default) or a set-aside. */
  shieldAccountId?: string;
  /** The customer or vendor, if the business names one. */
  name?: NameRef;
  tags?: Tags;
  memo?: string;
};

/** The source an accepted item's entry carries, so it can be found again. */
export const reviewSource = (id: string) => ({ ref: `review:${id}` });

/**
 * Posts a waiting item: money in debits the Shield account and credits the chosen account; money
 * out does the opposite. Under a cent posts nothing, and is refused: exclude it instead.
 */
export function acceptItem(company: Company, id: string, input: AcceptInput): Company {
  const item = itemOf(company, id);
  if (item.status !== "new") throw new ReviewError("That transaction has already been reviewed");
  const cents = minorToCents(BigInt(item.minor));
  if (cents === 0n) throw new ReviewError("That's less than a cent, too small to post. Exclude it instead.");
  if (!company.books.accounts.some((a) => a.id === input.accountId && a.active)) throw new ReviewError("Choose an account");

  const { books: withAccount, accountId: parent } = ensureRailAccount(company.books);
  if (isShieldFamily({ books: withAccount }, input.accountId)) throw new ReviewError(`Choose an account other than the ${RAIL_ACCOUNT_NAME}`);
  if (input.shieldAccountId && !isShieldFamily({ books: withAccount }, input.shieldAccountId)) throw new ReviewError("Choose General or one of your set-asides");
  const shield = input.shieldAccountId ?? parent;
  const other = {
    accountId: input.accountId,
    ...(input.name ? { name: input.name } : {}),
    ...(input.tags && Object.keys(input.tags).length > 0 ? { tags: input.tags } : {}),
  };
  const inbound = item.direction === "in";
  const { books, entry } = postEntry(withAccount, {
    date: item.date as IsoDate,
    ...(input.memo?.trim() ? { memo: input.memo.trim() } : {}),
    source: { kind: inbound ? "deposit" : "expense", ...reviewSource(id) },
    lines: inbound
      ? [{ accountId: shield, debit: cents }, { ...other, credit: cents }]
      : [{ ...other, debit: cents }, { accountId: shield, credit: cents }],
  });
  return withItem({ ...company, books }, { ...item, status: "accepted", entryId: entry.id });
}

/** Keeps a waiting item out of the books. */
export function excludeItem(company: Company, id: string): Company {
  const item = itemOf(company, id);
  if (item.status !== "new") throw new ReviewError("That transaction has already been reviewed");
  return withItem(company, { ...item, status: "excluded" });
}

/**
 * Sends a reviewed item back to the list: an excluded one simply returns; an accepted one has its
 * entry reversed first (the books keep both, as with any correction). Automatic ones stay put.
 */
export function undoReview(company: Company, id: string, date: IsoDate): Company {
  const item = itemOf(company, id);
  if (item.status === "excluded") return withItem(company, { ...item, status: "new" });
  if (item.status !== "accepted" || !item.entryId) throw new ReviewError("Only accepted or excluded transactions can go back");
  findEntry(company.books, item.entryId);
  const { books } = reverseEntry(company.books, item.entryId, { date, memo: "Sent back for review" });
  const { entryId: _gone, ...rest } = item;
  return withItem({ ...company, books }, { ...rest, status: "new" });
}

/** The expense account that buying network fee money posts to. */
export const NETWORK_FEES = "Network fees";

/** The "Network fees" expense account, created if the chart doesn't have it. */
export function ensureNetworkFees(books: Books): { books: Books; accountId: string } {
  const found = books.accounts.find((a) => a.active && baseOf(a) === "expense" && a.name.trim().toLowerCase() === NETWORK_FEES.toLowerCase());
  if (found) return { books, accountId: found.id };
  const r = addAccount(books, { name: NETWORK_FEES, type: "expense" });
  return { books: r.books, accountId: r.account.id };
}

/**
 * Corrects an accepted item in one step: its entry is reversed (dated `date`) and the item posted
 * again with the new choices. The books keep all three entries, as with any correction.
 */
export function changeItem(company: Company, id: string, input: AcceptInput, date: IsoDate): Company {
  const item = itemOf(company, id);
  if (item.status !== "accepted") throw new ReviewError("Only an accepted transaction can be changed");
  return acceptItem(undoReview(company, id, date), id, input);
}

/** What an accepted item was posted as: the other account, the customer or vendor, the project and the memo. */
export function choicesOf(company: Pick<Company, "books" | "review">, id: string): AcceptInput | null {
  const item = company.review?.items.find((i) => i.id === id);
  if (item?.status !== "accepted" || !item.entryId) return null;
  const entry = company.books.entries.find((e) => e.id === item.entryId);
  const parent = ensureRailAccount(company.books).accountId;
  const other = entry?.lines.find((l) => !isShieldFamily(company, l.accountId));
  const side = entry?.lines.find((l) => isShieldFamily(company, l.accountId));
  if (!entry || !other) return null;
  return {
    accountId: other.accountId,
    ...(side && side.accountId !== parent ? { shieldAccountId: side.accountId } : {}),
    ...(other.name ? { name: other.name } : {}),
    ...(other.tags ? { tags: other.tags } : {}),
    ...(entry.memo ? { memo: entry.memo } : {}),
  };
}
