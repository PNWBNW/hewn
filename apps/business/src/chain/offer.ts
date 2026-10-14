// ---------------------------------------------------------------------------
// Sending an employment offer to a typed team member, so they can become
// linked: the terms go to their mailbox first, then one `create_job_offer`
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
import { computeAgreementValues, computeOfferTimeHash } from "@pnw/handshake/engine";
import { PAY_FREQUENCY_CODES, type ComputedAgreementValues } from "@pnw/handshake/types";
import { KINDS, MailboxError, type MailboxClient, partiesKeyFromHex, seal } from "@pnw/mailbox";
import type { PayFrequency, Worker } from "@pnw/payroll";
import type { Clock, RailWallet, Sleep } from "@pnw/rail";
import { computeNameHash, queryNameOwner, queryNamePlaintext, queryWorkerName } from "@pnw/records/registry/name_registry";
import { type RailLink, isRailAddress } from "../books/rail";
import { byteArrayHex } from "./parties_key";
import { type Terms, canonicalTerms } from "./terms";

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
export const OFFER_FUNCTION = "create_job_offer";
/** The terms always go to slot 0 of the `terms` kind: one agreement, one parties key, one document. */
export const TERMS_SLOT = 0;

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

/** `create_job_offer`'s inputs in the portal's order and encodings. */
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

export type ResolvedWorker = { address: string; nameHash: string; name?: string };

export type Registry = {
  nameOwner: (nameHash: string) => Promise<string | null>;
  workerName: (address: string) => Promise<string | null>;
  namePlaintext: (nameHash: string) => Promise<string | null>;
};

const registry: Registry = { nameOwner: queryNameOwner, workerName: queryWorkerName, namePlaintext: queryNamePlaintext };

/**
 * A registered name (with or without the display suffix) → its owner's
 * account, or an account → its registered name. Someone without a name
 * can't be offered to: the agreement carries their name hash.
 */
export async function resolveWorker(text: string, suffix: string, reg: Registry = registry): Promise<ResolvedWorker> {
  const raw = text.trim();
  if (!raw) throw new OfferError("Enter their name or account");
  if (raw.startsWith("aleo1")) {
    if (!isRailAddress(raw)) throw new OfferError("That account isn't complete: 63 characters starting aleo1");
    const found = await reg.workerName(raw);
    if (!found) throw new OfferError(NO_NAME_MESSAGE);
    const nameHash = bareField(found);
    const name = (await reg.namePlaintext(nameHash)) || undefined;
    return { address: raw, nameHash, ...(name ? { name } : {}) };
  }
  const name = bareName(raw, suffix);
  if (!name) throw new OfferError("Enter their name or account");
  const nameHash = computeNameHash(name);
  const address = await reg.nameOwner(nameHash);
  if (!address) throw new OfferError(NO_NAME_MESSAGE);
  return { address, nameHash, name };
}

/** A name as typed (any case, with or without the display suffix) → the bare registered name. */
export function bareName(text: string, suffix: string): string {
  return text.trim().toLowerCase().replace(new RegExp(`\\.${suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), "");
}

/**
 * The business's own registered name, typed by hand when the lookup by
 * account found none. It counts only when the registry says this very
 * account owns it: an offer carries the name hash, and nobody may offer
 * work under someone else's name.
 */
export async function resolveBusinessName(text: string, suffix: string, ownAddress: string, reg: Pick<Registry, "nameOwner"> = registry): Promise<{ nameHash: string; name: string }> {
  const name = bareName(text, suffix);
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
  currentHeight: number;
  /** Only `put` is used; a fake with that one method does for tests. */
  client: Pick<MailboxClient, "put">;
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
 * `create_job_offer` through the wallet and waits for acceptance. Returns
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
  const terms: Terms = {
    version: 1,
    kind: "terms",
    agreementId: bareHex(computeOfferTimeHash(offerTimeUtc)),
    termsText: input.termsText,
    payType: worker.payType,
    rate: worker.rate.toString(),
    frequency: worker.frequency,
    startDate: input.startDate,
    businessName: input.businessName,
    offeredAt: now.toISOString(),
  };
  const canonical = canonicalTerms(terms);
  const computed = computeAgreementValues(input.employerAddress, input.workerAddress, canonical, offerTimeUtc, VERSIONS.schema_v, VERSIONS.policy_v);
  const partiesKey = bareHex(computed.parties_key);

  // 1. The terms, sealed to the two parties, in the mailbox.
  onProgress?.("sealing");
  const key = partiesKeyFromHex(partiesKey);
  let sealed;
  try {
    sealed = await seal(key, KINDS.terms, TERMS_SLOT, new TextEncoder().encode(canonical));
  } finally {
    key.fill(0);
  }
  onProgress?.("mailbox");
  let slotTaken = false;
  try {
    await client.put(sealed.lookup, sealed.envelope);
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
  const { transactionId: walletId } = await wallet.executeTransaction({ program: OFFER_PROGRAM, function: OFFER_FUNCTION, inputs, privateFee: false });
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
