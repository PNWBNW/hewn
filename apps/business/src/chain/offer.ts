// ---------------------------------------------------------------------------
// Sending an employment offer to a typed team member, so they can become
// linked: the terms go to their mailbox first, then one `create_offer_open`
// through Shield, exactly the 16 inputs and encodings the old portal used
// (docs/INTEGRATION_AUDIT.md §2.1). The link is recorded as `offered`; the
// Import team flow turns it `linked` once the worker's acceptance shows up
// as a FinalAgreement in the employer's wallet.
//
// Mailbox first, on purpose: a transaction with no terms behind it would
// leave the worker an agreement they cannot read. A slot that is already
// taken (409) means an earlier attempt got this far, so the send goes on;
// a server with no mailbox (503) stops everything before any transaction.
//
// Pure apart from the injected mailbox client and wallet: no network, no
// React, no storage, and nothing here logs a key, an address or a document.
// ---------------------------------------------------------------------------

import { ENV } from "@pnw/config/env";
import { PROGRAMS, VERSIONS } from "@pnw/config/programs";
import { computeAgreementValues, computeOfferTimeHash, computePartiesKey } from "@pnw/handshake/engine";
import { PAY_FREQUENCY_CODES, type ComputedAgreementValues } from "@pnw/handshake/types";
import { KINDS, MAX_PAYLOAD_BYTES, MailboxError, type MailboxClient, keepUntilAfter, lookupId, partiesKeyFromHex, seal } from "@pnw/mailbox";
import type { PayFrequency, Worker } from "@pnw/payroll";
import type { Clock, RailWallet, Sleep } from "@pnw/rail";
import { computeNameHash, queryNameOwner } from "@pnw/records/registry/name_registry";
import { type RailLink, isRailAddress } from "../books/rail";
import { bareDirectoryName } from "./directory";
import { byteArrayHex } from "./parties_key";
import { DEFAULT_EXPIRY_DAYS, type ExpiryDays, type Letter, LetterError, emptyLetter, expiryFor, validateLetter } from "../books/offer_letter";
import type { EmploymentType } from "../books/terms_words";
import type { WorkWeek } from "../books/work_week";
import { offerFileLookups, offerTermsKind } from "./offer_files";
import { type Terms, TermsError, canonicalTerms, validateTerms } from "./terms";
import { packPayload } from "./compress";
import { PAGE_BYTES } from "./letters";

export class OfferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OfferError";
  }
}

/** Shown when the host has no mailbox: nothing is sent until it is set up. */
export const MAILBOX_OFF_MESSAGE = "Offers need the mailbox; it's off on this server";
/** Shown when the person has no registered name on the rail. */
export const NO_NAME_MESSAGE = "They need to register a name first";

export const OFFER_PROGRAM = PROGRAMS.layer1.employer_agreement;
/** `create_job_offer` without the license approval (employer_agreement_v4 edition 2); same 16 inputs. */
export const OFFER_FUNCTION = "create_offer_open";
/** The terms always go to slot 0 of the `terms` kind: one agreement, one parties key, one document. */
export const TERMS_SLOT = 0;

/**
 * The day an offer's documents may be swept from the mailbox if nobody
 * collects them: the day after it expires (@pnw/mailbox retention.ts). The
 * person's app clears them sooner, on accepting or on finding it expired.
 */
export const offerKeepUntil = (expiresAt: string): string => keepUntilAfter(new Date(expiresAt), 1);

// ---- The parties key -------------------------------------------------------------------
// The agreement record carries `parties_key`, private to the two parties, and
// everything they exchange through the mailbox is sealed with it. The old
// portal computed it from the two addresses alone (BLAKE3 over both), so anyone
// who knew who works for whom could compute it too and read their mailbox.
// The program never checks how it was made, so the business's app now draws
// it at random, once per pair, and the person reads it from their record.

/** A fresh parties key: 32 random bytes, hex. */
export function newPartiesKey(): string {
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** True for the old kind of key, computed from the two addresses: one anyone who knows both could compute. */
export function isDerivedPartiesKey(partiesKey: string, employerAddress: string, workerAddress: string): boolean {
  return bareHex(partiesKey) === bareHex(computePartiesKey(employerAddress, workerAddress));
}

/** The key an offer goes out with: the pair's own if it has a secret one, a fresh one otherwise. */
function keyFor(input: Pick<SendOfferInput, "partiesKey" | "employerAddress" | "workerAddress">): string {
  if (input.partiesKey === undefined) return newPartiesKey();
  const key = bareHex(input.partiesKey);
  if (!/^[0-9a-f]{64}$/.test(key)) throw new OfferError("The pair's key must be 64 hex characters");
  return isDerivedPartiesKey(key, input.employerAddress, input.workerAddress) ? newPartiesKey() : key;
}

// ---- Encodings, as the portal did them -------------------------------------------------

/** `0x` or not, a hex string as `[ 1u8, 2u8, … ]`. */
export function bytesToAleoU8Array(hex: string): string {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 2) bytes.push(parseInt(clean.slice(i, i + 2), 16));
  return "[ " + bytes.map((b) => `${b}u8`).join(", ") + " ]";
}

/** Hex without its `0x`, as the links store it. */
export const bareHex = (hex: string): string => (hex.startsWith("0x") ? hex.slice(2) : hex).toLowerCase();

/** A name hash as the registry returns it, with or without `field`, as the bare decimal. */
export const bareField = (field: string): string => field.replace(/field$/, "").trim();

/**
 * The agreement's pay frequency code. The record has no code for twice a
 * month; every two weeks is the nearest (24 vs 26 pays a year), and the
 * terms document carries the exact frequency.
 */
export const FREQUENCY_CODES: Record<PayFrequency, number> = {
  weekly: PAY_FREQUENCY_CODES.WEEKLY,
  biweekly: PAY_FREQUENCY_CODES.BIWEEKLY,
  semimonthly: PAY_FREQUENCY_CODES.BIWEEKLY,
  monthly: PAY_FREQUENCY_CODES.MONTHLY,
};

// ---- Dates as block heights ---------------------------------------------------------------

/** One block about every 3 seconds. */
export const BLOCKS_PER_SECOND = 1 / 3;

/** YYYY-MM-DD as the moment it starts, UTC (what the portal's `new Date(value)` gave it). */
function dateMs(date: string): number {
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T00:00:00Z`) : NaN;
  if (Number.isNaN(ms)) throw new OfferError("Enter a date");
  return ms;
}

/** The block a date is expected at, never before the current block (the portal's rule). */
export function dateToHeight(date: string, currentHeight: number, nowMs: number): number {
  const diffSeconds = (dateMs(date) - nowMs) / 1000;
  return Math.max(currentHeight, currentHeight + Math.floor(diffSeconds * BLOCKS_PER_SECOND));
}

export type OfferDates = { startDate: string; reviewDate: string; endDate?: string };
export type OfferEpochs = { start: number; end: number; review: number };

/** Start, end (0 = open-ended) and review as block heights; the review never comes before the start. */
export function offerEpochs({ startDate, reviewDate, endDate }: OfferDates, currentHeight: number, nowMs: number): OfferEpochs {
  if (!Number.isInteger(currentHeight) || currentHeight < 0) throw new OfferError("Couldn't read the current block height");
  const start = dateToHeight(startDate, currentHeight, nowMs);
  const review = Math.max(start, dateToHeight(reviewDate, currentHeight, nowMs));
  const end = endDate?.trim() ? dateToHeight(endDate, currentHeight, nowMs) : 0;
  if (end !== 0 && end <= start) throw new OfferError("The end date must be after the start date");
  return { start, end, review };
}

/** `GET /block/height/latest` on the explorer. */
export async function fetchLatestHeight(fetchImpl: typeof fetch = fetch, endpoint: string = ENV.ALEO_ENDPOINT): Promise<number> {
  let height: unknown;
  try {
    const res = await fetchImpl(`${endpoint.replace(/\/+$/, "")}/block/height/latest`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(String(res.status));
    height = await res.json();
  } catch {
    throw new OfferError("Couldn't read the current block height");
  }
  if (typeof height !== "number" || !Number.isInteger(height) || height < 0) throw new OfferError("Couldn't read the current block height");
  return height;
}

// ---- The 16 inputs ---------------------------------------------------------------------

export type OfferInputs = {
  computed: ComputedAgreementValues;
  /** Decimal field values, with or without `field`. */
  employerNameHash: string;
  workerNameHash: string;
  workerAddress: string;
  industryCode: number;
  frequencyCode: number;
  epochs: OfferEpochs;
};

/** The offer's 16 inputs (`create_offer_open`, same as `create_job_offer`) in the portal's order and encodings. */
export function createJobOfferInputs(i: OfferInputs): string[] {
  return [
    bytesToAleoU8Array(i.computed.agreement_id),
    bytesToAleoU8Array(i.computed.parties_key),
    `${bareField(i.employerNameHash)}field`,
    `${bareField(i.workerNameHash)}field`,
    i.workerAddress,
    `${i.industryCode}u8`,
    `${i.frequencyCode}u8`,
    `${i.epochs.start}u32`,
    `${i.epochs.end}u32`,
    `${i.epochs.review}u32`,
    "1u16",
    `${VERSIONS.schema_v}u16`,
    `${VERSIONS.policy_v}u16`,
    bytesToAleoU8Array(i.computed.terms_doc_hash),
    bytesToAleoU8Array(i.computed.terms_root),
    bytesToAleoU8Array(i.computed.offer_time_hash),
  ];
}

// ---- Who the offer goes to ---------------------------------------------------------------

/** Who was found to send an offer to (see directory.ts for the lookup itself). */
export type ResolvedWorker = { address: string; nameHash: string; name?: string };

export type Registry = {
  nameOwner: (nameHash: string) => Promise<string | null>;
};

const registry: Registry = { nameOwner: queryNameOwner };

/**
 * The business's own registered name, typed by hand when the lookup by
 * account found none. It counts only when the registry says this very
 * account owns it: an offer carries the name hash, and nobody may offer
 * work under someone else's name.
 */
export async function resolveBusinessName(text: string, suffix: string, ownAddress: string, reg: Registry = registry): Promise<{ nameHash: string; name: string }> {
  const name = bareDirectoryName(text, suffix);
  if (!name) throw new OfferError("Enter your registered business name");
  const nameHash = computeNameHash(name);
  const owner = await reg.nameOwner(nameHash);
  if (!owner) throw new OfferError("No one has registered that name");
  if (owner !== ownAddress) throw new OfferError("That name belongs to a different account");
  return { nameHash, name };
}

// ---- Import: which offers were accepted ---------------------------------------------------

/** The agreement ids (hex, no `0x`) of every unspent FinalAgreement among the employer's records. */
export function finalAgreementIds(records: unknown[]): Set<string> {
  const ids = new Set<string>();
  for (const raw of records) {
    const rec = raw as Record<string, unknown> | null;
    if (!rec || typeof rec !== "object" || rec.spent === true || rec.recordName !== "FinalAgreement") continue;
    const id = byteArrayHex(typeof rec.recordPlaintext === "string" ? rec.recordPlaintext : "", "agreement_id");
    if (id) ids.add(id);
  }
  return ids;
}

// ---- Sending ---------------------------------------------------------------------------------

export type OfferWallet = Pick<RailWallet, "executeTransaction" | "transactionStatus">;

export type OfferStage = "sealing" | "mailbox" | "approving" | "sent" | "accepted";

export type SendOfferInput = OfferDates & {
  employerAddress: string;
  /** The registered business name hash (decimal field) and the bare registered name. */
  employerNameHash: string;
  businessName: string;
  worker: Pick<Worker, "id" | "payType" | "rate" | "frequency">;
  workerAddress: string;
  workerNameHash: string;
  industryCode: number;
  termsText: string;
  /** The offer letter (offer_letter.ts `letterFromText`). Missing means none. */
  letter?: Letter;
  /** Its own boxes in the offer, so a counter-offer can name them; missing leaves them out of the terms. */
  employmentType?: EmploymentType;
  /** Hours a week, as `cleanHours` writes them. */
  hoursPerWeek?: string;
  /** The work week the hours are drawn on (books/work_week.ts); missing leaves it out of the terms. */
  workWeek?: WorkWeek;
  /** How long the offer stays open (every offer expires). Default 7 days. */
  expiresInDays?: ExpiryDays;
  /**
   * The pair's secret parties key, 64 hex characters, when they already have
   * one (a revised offer keeps the conversation). Missing means a fresh one.
   */
  partiesKey?: string;
  currentHeight: number;
  /** Only `put` is used; a fake with that one method does for tests. */
  /**
   * Where the sealed terms go: letters on chain (a LetterBox to the person,
   * one Shield approval for the page) or, in tests, any client with `put`.
   */
  client: { put(lookup: string, envelope: Uint8Array, options?: { keepUntil?: string; feeMode?: "public" | "private" }): Promise<void> };
  /** The person's fee choice for both transactions (the terms page and the offer); the device's switch when left out. */
  feeMode?: "public" | "private";
  wallet: OfferWallet;
  onProgress?: (stage: OfferStage) => void;
  now?: () => Date;
  clock?: Clock;
  sleep?: Sleep;
  limits?: Partial<OfferLimits>;
};

export type OfferLimits = { walletCapMs: number; pollMinMs: number; pollMaxMs: number };
export const DEFAULT_OFFER_LIMITS: OfferLimits = { walletCapMs: 15 * 60_000, pollMinMs: 2_000, pollMaxMs: 10_000 };

export type SentOffer = {
  /** The link to record: `offered`, with the agreement id, the parties key and the offer time. */
  link: RailLink;
  terms: Terms;
  /** The on-chain id when the wallet reported one, else the wallet's own id. */
  transactionId: string;
  inputs: string[];
  /** The terms were already in the mailbox from an earlier attempt. */
  slotTaken: boolean;
};

const ACCEPTED = new Set(["accepted", "finalized", "confirmed", "completed"]);
const REJECTED = new Set(["rejected", "failed"]);
const isOnChainId = (id: unknown): id is string => typeof id === "string" && id.startsWith("at1");

/** Polls the wallet until it reports the transaction accepted (or rejected, or the cap passes). */
export async function awaitAccepted(wallet: OfferWallet, walletId: string, timing: { clock?: Clock; sleep?: Sleep; limits?: Partial<OfferLimits> } = {}): Promise<string> {
  const clock = timing.clock ?? { now: () => Date.now() };
  const sleep = timing.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const limits = { ...DEFAULT_OFFER_LIMITS, ...timing.limits };
  const start = clock.now();
  let interval = limits.pollMinMs;
  let onChainId: string | undefined = isOnChainId(walletId) ? walletId : undefined;
  for (;;) {
    await sleep(interval);
    let status: Awaited<ReturnType<OfferWallet["transactionStatus"]>> | null = null;
    try {
      status = await wallet.transactionStatus(walletId);
    } catch {
      // The wallet may not know the id yet; keep asking.
    }
    if (status) {
      if (isOnChainId(status.transactionId)) onChainId = status.transactionId;
      const s = status.status.toLowerCase();
      if (REJECTED.has(s)) throw new OfferError(status.error || "The network didn't accept the offer");
      if (ACCEPTED.has(s)) return onChainId ?? walletId;
    }
    if (clock.now() - start >= limits.walletCapMs) throw new OfferError("No answer from Shield in time; check it before sending again");
    interval = Math.min(Math.round(interval * 1.5), limits.pollMaxMs);
  }
}

/**
 * Builds the terms, puts them in the worker's mailbox, then sends
 * `create_offer_open` through the wallet and waits for acceptance. Returns
 * the link to record; throws (with nothing sent) on any problem before the
 * transaction, and after it with the transaction's failure.
 */
export async function sendOffer(input: SendOfferInput): Promise<SentOffer> {
  const { worker, client, wallet, onProgress } = input;
  if (!isRailAddress(input.employerAddress)) throw new OfferError("Link Shield in Settings first");
  if (!isRailAddress(input.workerAddress)) throw new OfferError("Find the person first");
  if (!bareField(input.employerNameHash)) throw new OfferError("Register a business name on the rail first");
  if (!bareField(input.workerNameHash)) throw new OfferError(NO_NAME_MESSAGE);
  if (!input.termsText.trim()) throw new OfferError("Write the terms of the offer");
  if (!Number.isInteger(input.industryCode) || input.industryCode < 1 || input.industryCode > 255) throw new OfferError("Choose an industry");
  const now = input.now?.() ?? new Date();
  const epochs = offerEpochs(input, input.currentHeight, now.getTime());
  const offerTimeUtc = Math.floor(now.getTime() / 1000);
  const expiresAt = expiryFor(now.toISOString(), input.expiresInDays ?? DEFAULT_EXPIRY_DAYS);
  let terms: Terms;
  try {
    // Version 2, the offer letter: it sits inside the terms, so the agreement record's terms hash
    // commits to its words (validateTerms checks the limits). New offers carry no files.
    terms = validateTerms({
      version: 2,
      kind: "terms",
      agreementId: bareHex(computeOfferTimeHash(offerTimeUtc)),
      termsText: input.termsText,
      payType: worker.payType,
      rate: worker.rate.toString(),
      frequency: worker.frequency,
      startDate: input.startDate,
      businessName: input.businessName,
      offeredAt: now.toISOString(),
      expiresAt,
      letter: validateLetter(input.letter ?? emptyLetter()),
      files: [],
      ...(input.employmentType ? { employmentType: input.employmentType } : {}),
      ...(input.hoursPerWeek ? { hoursPerWeek: input.hoursPerWeek } : {}),
      ...(input.workWeek ? { workWeek: input.workWeek } : {}),
    });
  } catch (e) {
    throw e instanceof TermsError || e instanceof LetterError ? new OfferError(e.message) : e;
  }
  const canonical = canonicalTerms(terms);
  const keepUntil = offerKeepUntil(expiresAt);
  if (new TextEncoder().encode(canonical).length > MAX_PAYLOAD_BYTES) throw new OfferError("The offer letter is too long to send; shorten it or attach the long parts as a PDF");
  // The parties key seals everything the two exchange, so it must be secret: random, never computed from the addresses.
  const partiesKey = keyFor(input);
  const computed = { ...computeAgreementValues(input.employerAddress, input.workerAddress, canonical, offerTimeUtc, VERSIONS.schema_v, VERSIONS.policy_v), parties_key: `0x${partiesKey}` };

  // 1. The terms, packed (deflated when that's smaller), sealed to the two parties, and sent: on
  // chain, as one page to the person (letters, docs/LETTERS.md).
  onProgress?.("sealing");
  const key = partiesKeyFromHex(partiesKey);
  let sealed;
  try {
    sealed = await seal(key, offerTermsKind(bareHex(computed.agreement_id)), TERMS_SLOT, await packPayload(new TextEncoder().encode(canonical)));
  } finally {
    key.fill(0);
  }
  if (sealed.envelope.length > PAGE_BYTES) throw new OfferError("The offer is too long to send on the network; shorten the offer letter");
  onProgress?.("mailbox");
  let slotTaken = false;
  try {
    await client.put(sealed.lookup, sealed.envelope, { keepUntil, ...(input.feeMode ? { feeMode: input.feeMode } : {}) });
  } catch (e) {
    if (e instanceof MailboxError && e.code === "CONFLICT") slotTaken = true;
    else if (e instanceof MailboxError && e.code === "NOT_CONFIGURED") throw new OfferError(MAILBOX_OFF_MESSAGE);
    else throw e;
  }

  // 2. The offer itself, signed in Shield.
  const inputs = createJobOfferInputs({
    computed,
    employerNameHash: input.employerNameHash,
    workerNameHash: input.workerNameHash,
    workerAddress: input.workerAddress,
    industryCode: input.industryCode,
    frequencyCode: FREQUENCY_CODES[worker.frequency],
    epochs,
  });
  onProgress?.("approving");
  const { transactionId: walletId } = await wallet.executeTransaction({ program: OFFER_PROGRAM, function: OFFER_FUNCTION, inputs, privateFee: false, ...(input.feeMode ? { feeMode: input.feeMode } : {}) });
  if (!walletId) throw new OfferError("Shield didn't take the offer");
  onProgress?.("sent");
  const transactionId = await awaitAccepted(wallet, walletId, input);
  onProgress?.("accepted");

  const link: RailLink = {
    workerId: worker.id,
    address: input.workerAddress,
    nameHash: bareField(input.workerNameHash),
    agreementId: bareHex(computed.agreement_id),
    partiesKey,
    status: "offered",
    offeredAt: terms.offeredAt,
  };
  return { link, terms, transactionId, inputs, slotTaken };
}

/** True when the server has no mailbox (503). */
export const isMailboxOff = (e: unknown): boolean => (e instanceof MailboxError && e.code === "NOT_CONFIGURED") || (e instanceof OfferError && e.message === MAILBOX_OFF_MESSAGE);

// ---- Withdrawing an offer ------------------------------------------------------------------
// A pending offer is withdrawn with `terminate_employer_open` (employer_agreement_v4, works on a
// pending agreement): the agreement turns terminated, and `accept_job_offer` needs it pending,
// so the person can no longer accept it anywhere. Used for an expired offer, or any offer the
// business takes back. Its documents then come out of the mailbox.

/** `terminate_employer_open` without the license approval; 4 inputs. */
export const WITHDRAW_FUNCTION = "terminate_employer_open";

/** The 4 inputs that withdraw an offer: agreement id, parties key, both name hashes. */
export function withdrawOfferInputs(link: Pick<RailLink, "agreementId" | "partiesKey" | "nameHash">, employerNameHash: string): string[] {
  if (!link.partiesKey) throw new OfferError("This offer is too old to withdraw from here; import the team member again");
  return [bytesToAleoU8Array(link.agreementId), bytesToAleoU8Array(link.partiesKey), `${bareField(employerNameHash)}field`, `${bareField(link.nameHash)}field`];
}

export type WithdrawInput = {
  link: Pick<RailLink, "agreementId" | "partiesKey" | "nameHash" | "terms">;
  employerNameHash: string;
  wallet: OfferWallet;
  /** Only `drop` is used. */
  client: Pick<MailboxClient, "drop">;
  clock?: Clock;
  sleep?: Sleep;
  limits?: Partial<OfferLimits>;
};

/**
 * Withdraws a pending offer in Shield and waits for the network, then clears its terms and
 * files from the mailbox (best effort: a document already gone is fine). Returns the
 * transaction id.
 */
export async function withdrawOffer(input: WithdrawInput): Promise<string> {
  const inputs = withdrawOfferInputs(input.link, input.employerNameHash);
  const { transactionId: walletId } = await input.wallet.executeTransaction({ program: OFFER_PROGRAM, function: WITHDRAW_FUNCTION, inputs, privateFee: false });
  if (!walletId) throw new OfferError("Shield didn't take the withdrawal");
  const transactionId = await awaitAccepted(input.wallet, walletId, input);
  for (const lookup of offerLookups(input.link)) await input.client.drop(lookup).catch(() => {});
  return transactionId;
}

/** Every mailbox slot an offer uses: its terms, and its files' pieces. */
export function offerLookups(link: Pick<RailLink, "partiesKey" | "terms" | "agreementId">): string[] {
  if (!link.partiesKey) return [];
  const key = partiesKeyFromHex(link.partiesKey);
  let terms: string[];
  try {
    // Its own slot, and the shared slot 0 offers used before (only ever this person's older offer from this business).
    terms = [lookupId(key, offerTermsKind(link.agreementId), TERMS_SLOT), lookupId(key, KINDS.terms, TERMS_SLOT)];
  } finally {
    key.fill(0);
  }
  const t = link.terms;
  return t?.version === 2 && t.files.length > 0 ? [...terms, ...offerFileLookups(link.partiesKey, t.agreementId, t.files)] : terms;
}
