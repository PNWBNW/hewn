// ---------------------------------------------------------------------------
// The work part of a company file: what a person who works for a business
// keeps in their own vault. Their registered name, the agreements they hold
// with employers (and the terms they accepted), their clock-in / clock-out
// punches, the weeks they have sent, and the paystubs that have arrived.
//
// Nothing here talks to the rail or the mailbox. Reading offers, accepting
// them, sending a week and collecting paystubs live in src/chain/work,
// loaded only when the person taps the button; everything saved comes back
// through the pure operations below and the vault like any other change.
//
// Two shapes are a contract shared with the employer's side of the app and
// must not drift: `Terms` (what an offer says, sealed at terms slot 0) and
// the timesheet payload built in hours.ts.
// ---------------------------------------------------------------------------

import type { AttachmentRef } from "@pnw/sales";
import { type ApplicationStatus, type Thread, emptyThread, validateThread } from "./thread";
import { type WorkChannel, applyChannelMessage, validateWorkChannel } from "./channels";
import { agreedChanges, hoursChanges } from "./hours_change";
import { type ConfirmedName, type CoworkerThread, type Identity, MAX_CONFIRMED_NAMES, validateConfirmedName, validateCoworkerThread, validateIdentity } from "./directory";
import { type Letter, type OfferFile, LetterError, validateExpiry, validateFileRefs, validateLetter, validateOfferFiles } from "./offer_letter";
import { type JobFields, validateJobFields } from "./terms_words";
import { type WorkWeek, validateWorkWeek } from "./work_week";

export type Role = "business" | "worker";

export type AgreementStatus = "pending" | "active" | "paused" | "terminated";

/** What an offer says. Sealed by the employer; the person keeps it once accepted. */
export type TermsV1 = {
  version: 1;
  kind: "terms";
  /** The agreement id, or the offer's time hash (the employer may not know the id yet). */
  agreementId: string;
  termsText: string;
  payType: "hourly" | "salary";
  /** Cents, as a decimal string. Hourly: per hour. Salary: per year. */
  rate: string;
  frequency: "weekly" | "biweekly" | "semimonthly" | "monthly";
  startDate: string;
  businessName: string;
  offeredAt: string;
};

/**
 * Version 2, the offer letter: version 1 plus the letter's sections and the attached files
 * (books/offer_letter.ts), the job fields, and, on offers made since, the work week (books/work_week.ts).
 */
export type TermsV2 = Omit<TermsV1, "version"> & JobFields & { version: 2; expiresAt: string; letter: Letter; files: OfferFile[]; workWeek?: WorkWeek };

export type Terms = TermsV1 | TermsV2;

export type WorkAgreement = {
  /** Hex, no `0x`. */
  agreementId: string;
  /** The secret the two parties share, 64 hex characters: what seals every document between them. */
  partiesKey: string;
  employerAddress: string;
  employerNameHash: string;
  employerName?: string;
  status: AgreementStatus;
  terms?: Terms;
  /** The offer letter's attached files, saved in this vault: one per file in `terms.files`, same fingerprints. */
  files?: AttachmentRef[];
  acceptedAt?: string;
};

export type Punch = {
  id: string;
  agreementId: string;
  at: string;
  kind: "in" | "out";
  /** On an out: the person looked at the long shift this closes and confirmed it is right (hours.ts). */
  confirmed?: true;
  /** On an in: this shift is a callout (Joshua, 2026-10-20), paid at the overtime rate with the agreed minimum. */
  callout?: true;
  /** The time this punch had before it was first moved (Joshua, 2026-10-20: the employer sees an edited shift and what it was). */
  was?: string;
  /** The last move was a change both sides agreed to (books/hours_change.ts), not the person's own edit. */
  agreed?: true;
};

export type SentTimesheet = {
  agreementId: string;
  /** The first day of the work week, YYYY-MM-DD (books/hours.ts `weekStartOf`). */
  weekStart: string;
  seq: number;
  lookup: string;
  totalMinutes: number;
  sentAt: string;
  /** When the business's app picked it up, from its receipt. Absent until one arrives. */
  receivedAt?: string;
  /**
   * The punches of the shifts it carried (Joshua, 2026-10-19): those shifts are sent, confirmed by
   * the person and the employer's to change; they can't be edited or removed here any more.
   */
  punchIds?: string[];
};

export type ReceivedPaystub = {
  agreementId: string;
  seq: number;
  lookup: string;
  receivedAt: string;
  /** The paystub document exactly as received (keys in hash order, amounts as decimal strings). */
  document: unknown;
  settlement: { transactionId: string; height?: number; feeMicrocredits?: string };
  businessName: string;
  paystubHash: string;
};

export type WorkProfile = { nameHash: string; name: string; profileAnchored: boolean; registeredAt: string };

export type MailboxSeq = { paystub?: number; timesheet?: number };

export type Work = {
  version: 1;
  displayName: string;
  profile?: WorkProfile;
  agreements: WorkAgreement[];
  punches: Punch[];
  timesheets: SentTimesheet[];
  paystubs: ReceivedPaystub[];
  /** The next unused mailbox slot per agreement and kind of document. Missing means 0. */
  mailboxSeq: Record<string, MailboxSeq>;
  /** One thread per employer, by the pair's parties key (books/thread.ts). */
  threads?: Record<string, Thread>;
  /** Announcement channels businesses added this person to (books/channels.ts). */
  channels?: WorkChannel[];
  /** A key pair per business's coworker directory, by that business's parties key (books/directory.ts). */
  identities?: Record<string, Identity>;
  /** Conversations with coworkers, by their public key. */
  coworkers?: Record<string, CoworkerThread>;
  /** Coworkers' registered names as the chain confirmed them, by account (books/directory.ts `ConfirmedName`). */
  confirmedNames?: Record<string, ConfirmedName>;
  /** Jobs this person applied to on the board (docs/JOB_BOARD.md); the conversation is the thread under the application's key. */
  applications?: Application[];
};

/** One application, as the person's vault keeps it. Its status is read from the thread (applicationStatus). */
export type Application = {
  /** The posting's id on the board: a decimal field, no suffix. */
  postingId: string;
  employerNameHash: string;
  employerName?: string;
  employerAddress: string;
  /** The posting's title when applied, for the list. */
  title: string;
  /** The key only the two of them can make (chain/applications.ts); the thread's key. */
  partiesKey: string;
  sentAt: string;
  transactionId?: string;
};

export class WorkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkError";
  }
}

const ADDRESS = /^aleo1[a-z0-9]{58}$/;
const HEX = /^[0-9a-f]+$/;
const PARTIES_KEY = /^[0-9a-f]{64}$/;
const LOOKUP = /^[0-9a-f]{64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SEQ = 0xffff_ffff;
const PAY_TYPES = ["hourly", "salary"] as const;
const FREQUENCIES = ["weekly", "biweekly", "semimonthly", "monthly"] as const;
const STATUSES: AgreementStatus[] = ["pending", "active", "paused", "terminated"];
const MAILBOX_KINDS = ["paystub", "timesheet"] as const;

export const emptyWork = (displayName: string): Work => ({
  version: 1,
  displayName,
  agreements: [],
  punches: [],
  timesheets: [],
  paystubs: [],
  mailboxSeq: {},
});

// ---- Validation --------------------------------------------------------------

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, what: string): string => {
  if (typeof v !== "string") throw new WorkError(`${what} must be text`);
  return v;
};
const optionalText = (v: unknown, what: string): string | undefined => (v === undefined ? undefined : text(v, what));
const isoDate = (v: unknown, what: string): string => {
  const s = text(v, what);
  if (Number.isNaN(Date.parse(s))) throw new WorkError(`${what} must be a date`);
  return s;
};
const dayDate = (v: unknown, what: string): string => {
  const s = text(v, what);
  if (!DATE.test(s) || Number.isNaN(Date.parse(s))) throw new WorkError(`${what} must be a YYYY-MM-DD date`);
  return s;
};
const seqNumber = (v: unknown, what: string): number => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > MAX_SEQ) throw new WorkError(`${what} must be a whole number`);
  return v;
};
const minutes = (v: unknown, what: string): number => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) throw new WorkError(`${what} must be a whole number of minutes`);
  return v;
};

export function validateTerms(raw: unknown): Terms {
  if (!isObject(raw)) throw new WorkError("Terms must be an object");
  if (raw.version !== 1 && raw.version !== 2) throw new WorkError("Unknown terms version");
  if (raw.kind !== "terms") throw new WorkError("That document isn't an offer's terms");
  const payType = text(raw.payType, "Pay type");
  if (!(PAY_TYPES as readonly string[]).includes(payType)) throw new WorkError("Pay type must be hourly or salary");
  const frequency = text(raw.frequency, "Pay frequency");
  if (!(FREQUENCIES as readonly string[]).includes(frequency)) throw new WorkError("Unknown pay frequency");
  const rate = text(raw.rate, "Rate");
  if (!/^\d+$/.test(rate)) throw new WorkError("Rate must be a whole number of cents");
  const common = {
    kind: "terms" as const,
    agreementId: text(raw.agreementId, "Agreement id"),
    termsText: text(raw.termsText, "Terms text"),
    payType: payType as Terms["payType"],
    rate,
    frequency: frequency as Terms["frequency"],
    startDate: dayDate(raw.startDate, "Start date"),
    businessName: text(raw.businessName, "Business name"),
    offeredAt: isoDate(raw.offeredAt, "Offered at"),
  };
  if (raw.version === 1) return { version: 1, ...common };
  let job: JobFields;
  let workWeek: { workWeek: WorkWeek } | Record<string, never> = {};
  try {
    job = validateJobFields(raw);
    if (raw.workWeek !== undefined) workWeek = { workWeek: validateWorkWeek(raw.workWeek) };
  } catch (e) {
    throw new WorkError(e instanceof Error ? e.message : "The job fields aren't valid");
  }
  try {
    return { version: 2, ...common, expiresAt: validateExpiry(common.offeredAt, raw.expiresAt), letter: validateLetter(raw.letter), files: validateOfferFiles(raw.files), ...job, ...workWeek };
  } catch (e) {
    throw e instanceof LetterError ? new WorkError(e.message) : e;
  }
}

export function validateAgreement(raw: unknown): WorkAgreement {
  if (!isObject(raw)) throw new WorkError("Each agreement must be an object");
  const agreementId = text(raw.agreementId, "Agreement id").toLowerCase();
  if (!agreementId || !HEX.test(agreementId) || agreementId.length % 2 !== 0) throw new WorkError("Agreement id must be hex");
  const partiesKey = text(raw.partiesKey, "Parties key").toLowerCase();
  if (!PARTIES_KEY.test(partiesKey)) throw new WorkError("The parties key must be 64 hex characters");
  const employerAddress = text(raw.employerAddress, "Employer account");
  if (!ADDRESS.test(employerAddress)) throw new WorkError("Each agreement needs the employer's account");
  const status = text(raw.status, "Status") as AgreementStatus;
  if (!STATUSES.includes(status)) throw new WorkError("Unknown agreement status");
  const a: WorkAgreement = { agreementId, partiesKey, employerAddress, employerNameHash: text(raw.employerNameHash, "Employer name hash"), status };
  const employerName = optionalText(raw.employerName, "Employer name");
  if (employerName !== undefined) a.employerName = employerName;
  if (raw.terms !== undefined) a.terms = validateTerms(raw.terms);
  if (raw.files !== undefined) {
    if (a.terms?.version !== 2) throw new WorkError("Saved files need the offer letter they came with");
    try {
      a.files = validateFileRefs(raw.files, a.terms.files);
    } catch (e) {
      throw e instanceof LetterError ? new WorkError(e.message) : e;
    }
  }
  if (raw.acceptedAt !== undefined) a.acceptedAt = isoDate(raw.acceptedAt, "Accepted at");
  return a;
}

export function validatePunch(raw: unknown): Punch {
  if (!isObject(raw)) throw new WorkError("Each punch must be an object");
  const kind = text(raw.kind, "Punch kind");
  if (kind !== "in" && kind !== "out") throw new WorkError("A punch is in or out");
  const id = text(raw.id, "Punch id");
  if (!id) throw new WorkError("Each punch needs an id");
  if (raw.confirmed !== undefined && raw.confirmed !== true && raw.confirmed !== false) throw new WorkError("Confirmed must be true or false");
  if (raw.callout !== undefined && raw.callout !== true && raw.callout !== false) throw new WorkError("Callout must be true or false");
  const p: Punch = { id, agreementId: text(raw.agreementId, "Agreement id"), at: isoDate(raw.at, "Punch time"), kind };
  if (raw.confirmed === true && kind === "out") p.confirmed = true;
  if (raw.callout === true && kind === "in") p.callout = true;
  if (raw.was !== undefined) {
    const was = isoDate(raw.was, "The punch's earlier time");
    if (was !== p.at) p.was = was;
  }
  if (raw.agreed !== undefined && raw.agreed !== true && raw.agreed !== false) throw new WorkError("Agreed must be true or false");
  if (raw.agreed === true && p.was) p.agreed = true;
  return p;
}

export function validateTimesheet(raw: unknown): SentTimesheet {
  if (!isObject(raw)) throw new WorkError("Each sent week must be an object");
  const lookup = text(raw.lookup, "Lookup");
  if (!LOOKUP.test(lookup)) throw new WorkError("A lookup id is 64 hex characters");
  return {
    agreementId: text(raw.agreementId, "Agreement id"),
    weekStart: dayDate(raw.weekStart, "Week start"),
    seq: seqNumber(raw.seq, "The timesheet sequence number"),
    lookup,
    totalMinutes: minutes(raw.totalMinutes, "Total"),
    sentAt: isoDate(raw.sentAt, "Sent at"),
    ...(raw.receivedAt !== undefined ? { receivedAt: isoDate(raw.receivedAt, "Received at") } : {}),
    ...(raw.punchIds !== undefined ? { punchIds: punchIdList(raw.punchIds) } : {}),
  };
}

function punchIdList(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.some((id) => typeof id !== "string" || !id)) throw new WorkError("The punches sent must be a list of ids");
  return [...new Set(raw as string[])];
}

export function validatePaystub(raw: unknown): ReceivedPaystub {
  if (!isObject(raw)) throw new WorkError("Each paystub must be an object");
  const lookup = text(raw.lookup, "Lookup");
  if (!LOOKUP.test(lookup)) throw new WorkError("A lookup id is 64 hex characters");
  if (!isObject(raw.settlement)) throw new WorkError("Each paystub needs its payment");
  const settlement: ReceivedPaystub["settlement"] = { transactionId: text(raw.settlement.transactionId, "Payment id") };
  if (raw.settlement.height !== undefined) {
    if (typeof raw.settlement.height !== "number" || !Number.isInteger(raw.settlement.height)) throw new WorkError("Height must be a whole number");
    settlement.height = raw.settlement.height;
  }
  const fee = optionalText(raw.settlement.feeMicrocredits, "Fee");
  if (fee !== undefined) {
    if (!/^\d+$/.test(fee)) throw new WorkError("Fee must be a whole number");
    settlement.feeMicrocredits = fee;
  }
  if (raw.document === undefined || raw.document === null) throw new WorkError("Each paystub needs its document");
  const paystubHash = text(raw.paystubHash, "Paystub hash");
  if (!LOOKUP.test(paystubHash)) throw new WorkError("A paystub hash is 64 hex characters");
  return {
    agreementId: text(raw.agreementId, "Agreement id"),
    seq: seqNumber(raw.seq, "The paystub sequence number"),
    lookup,
    receivedAt: isoDate(raw.receivedAt, "Received at"),
    document: raw.document,
    settlement,
    businessName: text(raw.businessName, "Business name"),
    paystubHash,
  };
}

function validateProfile(raw: unknown): WorkProfile {
  if (!isObject(raw)) throw new WorkError("Profile must be an object");
  if (typeof raw.profileAnchored !== "boolean") throw new WorkError("Profile needs to say whether it was created");
  return {
    nameHash: text(raw.nameHash, "Name hash"),
    name: text(raw.name, "Registered name"),
    profileAnchored: raw.profileAnchored,
    registeredAt: isoDate(raw.registeredAt, "Registered at"),
  };
}

function validateSeq(raw: unknown): Record<string, MailboxSeq> {
  if (!isObject(raw)) throw new WorkError("Mailbox sequence numbers must be an object");
  const out: Record<string, MailboxSeq> = {};
  for (const [agreementId, seq] of Object.entries(raw)) {
    if (!isObject(seq)) throw new WorkError("Mailbox sequence numbers must be an object");
    const clean: MailboxSeq = {};
    for (const [kind, n] of Object.entries(seq)) {
      if (!(MAILBOX_KINDS as readonly string[]).includes(kind)) throw new WorkError(`Unknown mailbox document kind: ${kind}`);
      if (n === undefined) continue;
      clean[kind as keyof MailboxSeq] = seqNumber(n, `The ${kind} sequence number`);
    }
    if (Object.keys(clean).length > 0) out[agreementId] = clean;
  }
  return out;
}

const POSTING_ID = /^[0-9]{1,78}$/;
const NAME_HASH = /^[0-9]{1,78}$/;
const TX = /^[a-z0-9_]{1,80}$/;

function validateApplication(raw: unknown): Application {
  if (!isObject(raw)) throw new WorkError("An application must be an object");
  if (typeof raw.postingId !== "string" || !POSTING_ID.test(raw.postingId) || /^0+$/.test(raw.postingId)) throw new WorkError("An application needs its posting");
  if (typeof raw.employerNameHash !== "string" || !NAME_HASH.test(raw.employerNameHash)) throw new WorkError("An application needs the business's name");
  if (typeof raw.employerAddress !== "string" || !ADDRESS.test(raw.employerAddress)) throw new WorkError("An application needs the business's account");
  if (typeof raw.partiesKey !== "string" || !PARTIES_KEY.test(raw.partiesKey)) throw new WorkError("An application needs its key");
  const a: Application = {
    postingId: raw.postingId,
    employerNameHash: raw.employerNameHash,
    employerAddress: raw.employerAddress,
    title: text(raw.title, "The posting's title"),
    partiesKey: raw.partiesKey,
    sentAt: isoDate(raw.sentAt, "The time an application was sent"),
  };
  if (raw.employerName !== undefined) a.employerName = text(raw.employerName, "The business's name");
  if (raw.transactionId !== undefined) {
    if (typeof raw.transactionId !== "string" || !TX.test(raw.transactionId)) throw new WorkError("An application's transaction isn't valid");
    a.transactionId = raw.transactionId;
  }
  return a;
}

/** Checks every field; later agreements with the same id replace earlier ones. */
export function validateWork(raw: unknown): Work {
  if (!isObject(raw)) throw new WorkError("Work must be an object");
  if (raw.version !== 1) throw new WorkError("Unknown work version");
  if (!Array.isArray(raw.agreements) || !Array.isArray(raw.punches) || !Array.isArray(raw.timesheets) || !Array.isArray(raw.paystubs)) {
    throw new WorkError("Work needs its agreements, punches, timesheets and paystubs");
  }
  const byId = new Map<string, WorkAgreement>();
  for (const a of raw.agreements.map(validateAgreement)) byId.set(a.agreementId, a);
  const punches = raw.punches.map(validatePunch);
  if (new Set(punches.map((p) => p.id)).size !== punches.length) throw new WorkError("Two punches share an id");
  const work: Work = {
    version: 1,
    displayName: text(raw.displayName, "Name"),
    agreements: [...byId.values()],
    punches: punches.sort(byTime),
    timesheets: raw.timesheets.map(validateTimesheet),
    paystubs: raw.paystubs.map(validatePaystub),
    mailboxSeq: validateSeq(raw.mailboxSeq ?? {}),
  };
  if (raw.profile !== undefined) work.profile = validateProfile(raw.profile);
  if (raw.applications !== undefined) {
    if (!Array.isArray(raw.applications)) throw new WorkError("The applications must be a list");
    const apps = raw.applications.map(validateApplication);
    if (new Set(apps.map((a) => a.postingId)).size !== apps.length) throw new WorkError("An application is listed twice");
    if (apps.length > 0) work.applications = apps;
  }
  if (raw.threads !== undefined) {
    if (!isObject(raw.threads)) throw new WorkError("The threads must be an object");
    const threads: Record<string, Thread> = {};
    for (const [key, t] of Object.entries(raw.threads)) {
      if (!PARTIES_KEY.test(key)) throw new WorkError("A thread is filed under a parties key");
      try {
        threads[key] = validateThread(t);
      } catch (e) {
        throw new WorkError(e instanceof Error ? e.message : "A thread couldn't be read");
      }
    }
    if (Object.keys(threads).length > 0) work.threads = threads;
  }
  try {
    if (raw.identities !== undefined) {
      if (!isObject(raw.identities)) throw new WorkError("The identities must be an object");
      const ids: Record<string, Identity> = {};
      for (const [key, id] of Object.entries(raw.identities)) {
        if (!PARTIES_KEY.test(key)) throw new WorkError("An identity is filed under a business's parties key");
        ids[key] = validateIdentity(id);
      }
      if (Object.keys(ids).length > 0) work.identities = ids;
    }
    if (raw.coworkers !== undefined) {
      if (!isObject(raw.coworkers)) throw new WorkError("The coworkers must be an object");
      const cw: Record<string, CoworkerThread> = {};
      for (const [key, t] of Object.entries(raw.coworkers)) {
        if (!/^04[0-9a-f]{128}$/.test(key)) throw new WorkError("A coworker thread is filed under their public key");
        cw[key] = validateCoworkerThread(t);
      }
      if (Object.keys(cw).length > 0) work.coworkers = cw;
    }
    if (raw.confirmedNames !== undefined) {
      if (!isObject(raw.confirmedNames)) throw new WorkError("The confirmed names must be an object");
      const names: Record<string, ConfirmedName> = {};
      for (const [address, c] of Object.entries(raw.confirmedNames)) {
        if (!ADDRESS.test(address)) throw new WorkError("A confirmed name is filed under an account");
        names[address] = validateConfirmedName(c);
      }
      if (Object.keys(names).length > MAX_CONFIRMED_NAMES) throw new WorkError("Too many confirmed names");
      if (Object.keys(names).length > 0) work.confirmedNames = names;
    }
  } catch (e) {
    throw e instanceof WorkError ? e : new WorkError(e instanceof Error ? e.message : "The coworker data couldn't be read");
  }
  if (raw.channels !== undefined) {
    if (!Array.isArray(raw.channels)) throw new WorkError("The channels must be a list");
    try {
      const channels = raw.channels.map(validateWorkChannel);
      if (channels.length > 0) work.channels = channels;
    } catch (e) {
      throw new WorkError(e instanceof Error ? e.message : "A channel couldn't be read");
    }
  }
  return work;
}

export const workToJson = (work: Work): string => JSON.stringify(validateWork(work));
export const workFromJson = (text: string): Work => validateWork(JSON.parse(text));

// ---- Operations --------------------------------------------------------------

const byTime = (a: Punch, b: Punch) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1);

export const agreementFor = (work: Work, agreementId: string): WorkAgreement | undefined => work.agreements.find((a) => a.agreementId === agreementId);

/** The agreements the person can clock in against. */
export const activeAgreements = (work: Work): WorkAgreement[] => work.agreements.filter((a) => a.status === "active");

/** Adds or replaces one agreement; an existing one keeps its terms, name and acceptance unless the new one brings its own. */
export function upsertAgreement(work: Work, agreement: WorkAgreement): Work {
  const fresh = validateAgreement(agreement);
  const previous = agreementFor(work, fresh.agreementId);
  const merged: WorkAgreement = previous ? { ...previous, ...fresh } : fresh;
  if (previous?.terms && !fresh.terms) merged.terms = previous.terms;
  if (previous?.employerName && !fresh.employerName) merged.employerName = previous.employerName;
  if (previous?.acceptedAt && !fresh.acceptedAt) merged.acceptedAt = previous.acceptedAt;
  return validateWork({ ...work, agreements: [...work.agreements.filter((a) => a.agreementId !== fresh.agreementId), merged] });
}

export function setProfile(work: Work, profile: WorkProfile): Work {
  return validateWork({ ...work, profile });
}

/** The next unused slot of `kind` in the mailbox shared with one employer (0 before anything). */
export function nextWorkSeq(work: Work, agreementId: string, kind: keyof MailboxSeq): number {
  return work.mailboxSeq[agreementId]?.[kind] ?? 0;
}

/** Notes that slot `used` has gone (or arrived), so the next one is after it. Never moves backwards. */
export function bumpWorkSeq(work: Work, agreementId: string, kind: keyof MailboxSeq, used: number): Work {
  if (!agreementFor(work, agreementId)) throw new WorkError("No agreement with that id");
  const current = nextWorkSeq(work, agreementId, kind);
  const next = Math.max(current, seqNumber(used, `The ${kind} sequence number`) + 1);
  return validateWork({ ...work, mailboxSeq: { ...work.mailboxSeq, [agreementId]: { ...work.mailboxSeq[agreementId], [kind]: next } } });
}

/** Keeps a paystub that arrived and moves the slot past it. One per agreement and slot. */
export function addPaystub(work: Work, paystub: ReceivedPaystub): Work {
  const fresh = validatePaystub(paystub);
  if (!agreementFor(work, fresh.agreementId)) throw new WorkError("No agreement with that id");
  if (work.paystubs.some((p) => p.agreementId === fresh.agreementId && p.seq === fresh.seq)) return bumpWorkSeq(work, fresh.agreementId, "paystub", fresh.seq);
  return bumpWorkSeq({ ...work, paystubs: [...work.paystubs, fresh] }, fresh.agreementId, "paystub", fresh.seq);
}

/**
 * Records a week sent to an employer and moves the slot past it. A week sent again replaces the
 * earlier record here (the employer's side combines the sends); the punches sent add up.
 */
export function recordTimesheet(work: Work, sent: SentTimesheet): Work {
  const fresh = validateTimesheet(sent);
  if (!agreementFor(work, fresh.agreementId)) throw new WorkError("No agreement with that id");
  const before = work.timesheets.find((t) => t.agreementId === fresh.agreementId && t.weekStart === fresh.weekStart);
  const punchIds = [...new Set([...(before?.punchIds ?? []), ...(fresh.punchIds ?? [])])];
  const kept: SentTimesheet = punchIds.length > 0 ? { ...fresh, punchIds } : fresh;
  const others = work.timesheets.filter((t) => t !== before);
  return bumpWorkSeq({ ...work, timesheets: [...others, kept] }, fresh.agreementId, "timesheet", fresh.seq);
}

/** The punches of every shift sent to an employer: theirs to change now. */
export function sentPunchIds(work: Work, agreementId: string): Set<string> {
  const ids = new Set<string>();
  for (const t of work.timesheets) if (t.agreementId === agreementId) for (const id of t.punchIds ?? []) ids.add(id);
  return ids;
}

const SENT_MESSAGE = "This shift has been sent to the employer and is theirs to change now";

/** Records when the business's app picked up the week in slot `seq` (its receipt). The first time sticks. */
export function markTimesheetReceived(work: Work, agreementId: string, seq: number, receivedAt: string): Work {
  const at = isoDate(receivedAt, "Received at");
  const sent = work.timesheets.find((t) => t.agreementId === agreementId && t.seq === seq);
  if (!sent || sent.receivedAt) return work;
  return { ...work, timesheets: work.timesheets.map((t) => (t === sent ? { ...t, receivedAt: at } : t)) };
}

/** The thread with the employer whose agreements use `partiesKey`, if there is one. */
export const workThread = (work: Work, partiesKey: string): Thread | undefined => work.threads?.[partiesKey];

/** Applies `change` to the thread with one employer (a new one if there was none). */
export function updateWorkThread(work: Work, partiesKey: string, change: (t: Thread) => Thread): Work {
  if (!PARTIES_KEY.test(partiesKey)) throw new WorkError("A thread is filed under a parties key");
  const thread = change(workThread(work, partiesKey) ?? emptyThread());
  // Channel keys and removals arrive in the thread; the channels follow them, in order (replaying is harmless).
  let channels = work.channels ?? [];
  for (const item of thread.items) {
    if (!item.mine && (item.body.type === "channel" || item.body.type === "channel_left")) channels = applyChannelMessage(channels, partiesKey, item.body);
  }
  const punches = applyAgreedHours(work, partiesKey, thread);
  return validateWork({ ...work, punches, threads: { ...work.threads, [partiesKey]: thread }, ...(channels.length > 0 ? { channels } : {}) });
}

/**
 * The punches with every change to the hours both sides agreed to applied, in the order they were
 * asked (books/hours_change.ts): the shift's clock-in and clock-out move to the agreed times, sent
 * or not, each marked with what it was. A change whose shift isn't here as asked (already applied,
 * or edited since) changes nothing, so reading the conversation again is harmless; one that would
 * make shifts overlap is left out.
 */
export function applyAgreedHours(work: Work, partiesKey: string, thread: Thread | undefined = workThread(work, partiesKey)): Punch[] {
  const mine = new Set(work.agreements.filter((a) => a.partiesKey === partiesKey).map((a) => a.agreementId));
  let punches = work.punches;
  for (const c of agreedChanges(hoursChanges(thread))) {
    if (!mine.has(c.body.agreementId)) continue;
    const sorted = punches.filter((p) => p.agreementId === c.body.agreementId).sort(byTime);
    const same = (a: string, b: string) => Date.parse(a) === Date.parse(b);
    const at = sorted.findIndex((p) => p.kind === "in" && same(p.at, c.body.shift.in));
    const inP = sorted[at];
    const outP = sorted[at + 1];
    if (!inP || outP?.kind !== "out" || !same(outP.at, c.body.shift.out)) continue;
    const { proposed } = c.body;
    const moved = (p: Punch, to: string): Punch => (same(p.at, to) ? p : validatePunch({ ...p, at: to, was: p.was ?? p.at, agreed: true }));
    const next = punches.map((p) => (p.id === inP.id ? moved(p, proposed.in) : p.id === outP.id ? moved(p, proposed.out) : p));
    try {
      checkPunches(next);
      punches = next;
    } catch {
      // Overlaps another shift here: left as it is.
    }
  }
  return punches;
}

/** Sets the person's key pair for one business's directory. */
/** Keeps the name the chain confirmed for a coworker's account; past the limit, the longest unchecked are dropped. */
export function keepConfirmedName(work: Work, address: string, name: string, checkedAt: string): Work {
  const names = { ...work.confirmedNames, [address]: { name, checkedAt } };
  const extra = Object.keys(names).length - MAX_CONFIRMED_NAMES;
  if (extra > 0) {
    const oldest = Object.entries(names)
      .filter(([a]) => a !== address)
      .sort((x, y) => (x[1].checkedAt < y[1].checkedAt ? -1 : 1))
      .slice(0, extra);
    for (const [a] of oldest) delete names[a];
  }
  return validateWork({ ...work, confirmedNames: names });
}

/** Forgets a confirmed name: the chain no longer says that account is a person's. */
export function forgetConfirmedName(work: Work, address: string): Work {
  if (!work.confirmedNames?.[address]) return work;
  return validateWork({ ...work, confirmedNames: Object.fromEntries(Object.entries(work.confirmedNames).filter(([a]) => a !== address)) });
}

export const setIdentity = (work: Work, businessKey: string, id: Identity): Work => validateWork({ ...work, identities: { ...work.identities, [businessKey]: id } });

/** Applies `change` to the conversation with one coworker (a new one if there was none). */
export function updateCoworker(work: Work, publicKey: string, base: Omit<CoworkerThread, keyof Thread>, change: (t: CoworkerThread) => CoworkerThread): Work {
  const before: CoworkerThread = work.coworkers?.[publicKey] ?? { ...emptyThread(), ...base };
  return validateWork({ ...work, coworkers: { ...work.coworkers, [publicKey]: change(before) } });
}

/** Applies `change` to the person's channels. */
export const updateWorkChannels = (work: Work, change: (channels: WorkChannel[]) => WorkChannel[]): Work => validateWork({ ...work, channels: change(work.channels ?? []) });

export const sentWeek = (work: Work, agreementId: string, weekStart: string): SentTimesheet | undefined =>
  work.timesheets.find((t) => t.agreementId === agreementId && t.weekStart === weekStart);

// ---- Punches ---------------------------------------------------------------------

/**
 * The rule every list of punches must keep, per agreement: in time order they
 * alternate in, out, in, out… starting with an in, and no two share a time.
 * That is what makes "overlapping" shifts impossible.
 */
export function checkPunches(punches: Punch[]): void {
  const byAgreement = new Map<string, Punch[]>();
  for (const p of [...punches].sort(byTime)) {
    const list = byAgreement.get(p.agreementId) ?? [];
    list.push(p);
    byAgreement.set(p.agreementId, list);
  }
  for (const list of byAgreement.values()) {
    let expect: Punch["kind"] = "in";
    let last: string | null = null;
    for (const p of list) {
      if (last !== null && p.at <= last) throw new WorkError("Two punches can't be at the same time");
      if (p.kind !== expect) throw new WorkError(expect === "in" ? "Punches overlap: you were still clocked in" : "Punches overlap: you weren't clocked in");
      expect = expect === "in" ? "out" : "in";
      last = p.at;
    }
  }
}

function newPunchId(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(8));
  return `pch-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** The open shift for one agreement (an in with no out after it), if any. */
export function openPunch(work: Work, agreementId: string): Punch | undefined {
  const last = [...work.punches].filter((p) => p.agreementId === agreementId).sort(byTime).at(-1);
  return last?.kind === "in" ? last : undefined;
}

/** Clocks in or out: the opposite of the last punch, at `at` (now by default). */
export function punch(
  work: Work,
  agreementId: string,
  at: string = new Date().toISOString(),
  id: string = newPunchId(),
  options: { callout?: boolean } = {},
): { work: Work; punch: Punch } {
  const agreement = agreementFor(work, agreementId);
  if (!agreement) throw new WorkError("No agreement with that id");
  if (agreement.status !== "active") throw new WorkError("This agreement isn't active");
  const kind: Punch["kind"] = openPunch(work, agreementId) ? "out" : "in";
  if (options.callout && kind !== "in") throw new WorkError("A callout starts with a clock-in");
  const p = validatePunch({ id, agreementId, at, kind, ...(options.callout ? { callout: true } : {}) });
  const punches = [...work.punches, p];
  checkPunches(punches);
  return { work: validateWork({ ...work, punches }), punch: p };
}

/**
 * Moves one punch to a new time (and kind). The list must still alternate. A
 * shift whose end moves loses its confirmation: the person looks again.
 */
export function updatePunch(work: Work, id: string, changes: Partial<Pick<Punch, "at" | "kind">>): Work {
  const existing = work.punches.find((p) => p.id === id);
  if (!existing) throw new WorkError("No punch with that id");
  if (sentPunchIds(work, existing.agreementId).has(id)) throw new WorkError(SENT_MESSAGE);
  const { confirmed: _confirmed, agreed: _agreed, ...rest } = existing;
  // The first time it had is kept, so the employer sees the shift was edited and from what.
  const next = validatePunch({ ...rest, ...changes, was: existing.was ?? existing.at });
  // The other end of the same shift, if the moved punch is its in: its confirmation goes too.
  const sorted = work.punches.filter((p) => p.agreementId === existing.agreementId).sort(byTime);
  const after = existing.kind === "in" ? sorted[sorted.findIndex((p) => p.id === id) + 1] : undefined;
  const punches = work.punches.map((p) => {
    if (p.id === id) return next;
    if (after && p.id === after.id && p.kind === "out" && p.confirmed) {
      const { confirmed: _c, ...plain } = p;
      return plain;
    }
    return p;
  });
  checkPunches(punches);
  return validateWork({ ...work, punches });
}

/** The person confirms the long shift that ends at out punch `id` is right as it stands. */
export function confirmShift(work: Work, id: string): Work {
  const existing = work.punches.find((p) => p.id === id);
  if (!existing) throw new WorkError("No punch with that id");
  if (existing.kind !== "out") throw new WorkError("Only a clock-out closes a shift");
  if (existing.confirmed) return work;
  return validateWork({ ...work, punches: work.punches.map((p) => (p.id === id ? { ...p, confirmed: true } : p)) });
}

/**
 * Removes one punch. If the rest no longer alternates on its own (an in
 * whose out would be left dangling), the other end of the same shift goes
 * with it; a last out can go alone, which leaves that shift open.
 */
export function removePunch(work: Work, id: string): Work {
  const existing = work.punches.find((p) => p.id === id);
  if (!existing) throw new WorkError("No punch with that id");
  if (sentPunchIds(work, existing.agreementId).has(id)) throw new WorkError(SENT_MESSAGE);
  let punches = work.punches.filter((p) => p.id !== id);
  try {
    checkPunches(punches);
  } catch {
    const sorted = work.punches.filter((p) => p.agreementId === existing.agreementId).sort(byTime);
    const at = sorted.findIndex((p) => p.id === id);
    // The other half of the same shift: the next punch after an in, the one before an out.
    const partner = existing.kind === "in" ? sorted[at + 1] : sorted[at - 1];
    if (partner && sentPunchIds(work, existing.agreementId).has(partner.id)) throw new WorkError(SENT_MESSAGE);
    punches = punches.filter((p) => p.id !== partner?.id);
    checkPunches(punches);
  }
  return validateWork({ ...work, punches });
}

// ---- Applications ------------------------------------------------------------

/** Keeps an application (one per posting; a later one for the same posting replaces it), newest first. */
export function addApplication(work: Work, application: Application): Work {
  const rest = (work.applications ?? []).filter((a) => a.postingId !== application.postingId);
  return validateWork({ ...work, applications: [application, ...rest].sort((a, b) => (a.sentAt < b.sentAt ? 1 : -1)) });
}

export const applicationFor = (work: Work, postingId: string): Application | undefined => work.applications?.find((a) => a.postingId === postingId);

/** Where an application stands: the business's latest word in the thread, else "applied". */
export function applicationStatus(work: Work, application: Application): ApplicationStatus | "applied" {
  const thread = workThread(work, application.partiesKey);
  const latest = [...(thread?.items ?? [])].reverse().find((i) => !i.mine && i.body.type === "application_status" && i.body.postingId === application.postingId);
  return latest && latest.body.type === "application_status" ? latest.body.status : "applied";
}
