// ---------------------------------------------------------------------------
// The conversation between a business and one person (Joshua, 2026-10-16),
// starting with negotiating an offer. One thread per pair, kept in each
// side's vault; it carries typed messages so later kinds (plain messages)
// join the same thread.
//
// Negotiating, in short: the offer on the chain is always the business's
// current position. The person can ask for changes (`counter`: the terms as
// they'd like them, plus a note). The business answers by keeping the
// original (`stands`) or by sending a revised offer (`revised`: the old one
// withdrawn, a new one in its place, which the person accepts or counters in
// turn). Nothing in the thread signs anything: only accepting an offer on
// the chain does.
//
// Everything that arrives came from the other person's device, so it is
// checked field by field before it is kept, and each side may only send its
// own kinds of message. Pure: no I/O, no React.
// ---------------------------------------------------------------------------

import { formatCents, parseCents } from "@pnw/ledger";
import { LETTER_LABEL, type Letter, letterText, validateLetter } from "./offer_letter";
import { type EmploymentType, type JobFields, cleanHours, employmentLabel, hoursLine, longDate, payLine, validateJobFields } from "./terms_words";

export type Side = "business" | "worker";

const PAY_TYPES = ["hourly", "salary"] as const;
const FREQUENCIES = ["weekly", "biweekly", "semimonthly", "monthly"] as const;
type PayType = (typeof PAY_TYPES)[number];
type Frequency = (typeof FREQUENCIES)[number];

/**
 * An offer's terms as the person would like them: what a counter-offer
 * carries. Employment type and hours are there when the offer has them (or
 * the person asks for them).
 */
export type Proposal = JobFields & {
  payType: PayType;
  /** Cents, as a decimal string: per hour when hourly, per year when salaried. */
  rate: string;
  frequency: Frequency;
  /** YYYY-MM-DD */
  startDate: string;
  termsText: string;
  letter: Letter;
};

export type ThreadBody =
  /** The person asks for changes to the offer `agreementId`. */
  | { type: "counter"; agreementId: string; proposal: Proposal; note: string }
  /** The business keeps the offer `agreementId` as it is. */
  | { type: "stands"; agreementId: string; note: string }
  /** The business withdrew the offer `agreementId` and sent `newAgreementId` in its place. */
  | { type: "revised"; agreementId: string; newAgreementId: string; note: string }
  /** A plain message, from either side. */
  | { type: "text"; text: string }
  /** The business added the person to an announcement channel, or gave it a new key (books/channels.ts). */
  | { type: "channel"; channelId: string; name: string; epoch: number; key: string }
  /** The business took the person out of a channel. */
  | { type: "channel_left"; channelId: string; name: string }
  /** The person lets coworkers at this business find them (books/directory.ts): the name they chose and their public key. */
  | { type: "directory_join"; name: string; publicKey: string }
  /** The person stops being findable. */
  | { type: "directory_leave" }
  /** The business passes on everyone who opted in: names and public keys, nothing else. */
  | { type: "directory"; entries: { name: string; publicKey: string; address?: string }[] }
  /** Between coworkers: a group chat as its admin set it up (books/groups.ts). Sent to each member. */
  | { type: "group"; groupId: string; name: string; admin: string; members: { name: string; publicKey: string }[] }
  /** Between coworkers: one message in a group chat, sent to each member with the same id. */
  | { type: "group_text"; groupId: string; text: string }
  /** Between coworkers: leaving a group chat. */
  | { type: "group_leave"; groupId: string }
  /** The person applies to the business's posting (docs/JOB_BOARD.md): their registered name, a message and their resume as text. The first message of the conversation. */
  | { type: "application"; postingId: string; name: string; nameHash: string; message: string; resume: string }
  /** The business says where an application stands. */
  | { type: "application_status"; postingId: string; status: ApplicationStatus };

/** Where an application stands, as the business tells the person; "applied" is the state before any of these. */
export const APPLICATION_STATUSES = ["seen", "interviewing", "offer_sent", "hired", "not_selected", "closed"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];
export const APPLICATION_STATUS_LABEL: Record<ApplicationStatus | "applied", string> = {
  applied: "Applied",
  seen: "Seen",
  interviewing: "Interviewing",
  offer_sent: "Offer sent",
  hired: "Hired",
  not_selected: "Not selected",
  closed: "Posting closed",
};

/** The messages that negotiate an offer. */
export type OfferStep = Extract<ThreadBody, { type: "counter" | "stands" | "revised" }>;
export const isOfferStep = (b: ThreadBody): b is OfferStep => b.type === "counter" || b.type === "stands" || b.type === "revised";

export type ThreadMessage = { version: 1; id: string; from: Side; sentAt: string; body: ThreadBody };

/**
 * A message as a vault keeps it: whose it is, and the slot it travelled in.
 * `receivedAt` is when the other side's app picked it up: for theirs, when
 * this device did; for mine, from the other side's receipt. `read` marks one
 * of theirs as seen here.
 */
export type ThreadItem = ThreadMessage & { mine: boolean; seq: number; receivedAt?: string; read?: true };

export type Thread = {
  items: ThreadItem[];
  /** The other side's next unread slot. */
  nextIn: number;
  /** This side's next unused slot. */
  nextOut: number;
};

/** Who may send what. */
export const SENDS: Record<ThreadBody["type"], Side | "either"> = {
  counter: "worker",
  stands: "business",
  revised: "business",
  text: "either",
  channel: "business",
  channel_left: "business",
  directory_join: "worker",
  directory_leave: "worker",
  directory: "business",
  group: "either",
  group_text: "either",
  group_leave: "either",
  application: "worker",
  application_status: "business",
};

/** The kinds that only travel between coworkers. */
export const GROUP_TYPES: readonly ThreadBody["type"][] = ["group", "group_text", "group_leave"];
export const MAX_GROUP = 25;

/** A coworker's public key: an uncompressed P-256 point, hex. */
export const PUBLIC_KEY = /^04[0-9a-f]{128}$/;
export const MAX_DIRECTORY = 500;
const ALEO_ADDRESS = /^aleo1[02-9ac-hj-np-z]{58}$/;
const directoryName = (v: unknown): string => {
  if (typeof v !== "string" || !v.trim() || [...v].length > 60) throw new ThreadError("A directory name is 1 to 60 characters");
  return v.trim();
};
const publicKey = (v: unknown): string => {
  if (typeof v !== "string" || !PUBLIC_KEY.test(v)) throw new ThreadError("A public key must be an uncompressed P-256 point in hex");
  return v;
};

export const MAX_NOTE_CHARS = 2_000;
export const MAX_TEXT_CHARS = 4_000;
/** An application's message and resume: a page holds about 7.9 KB packed, and plain English deflates about 3:1. */
export const MAX_APPLICATION_CHARS = 2_000;
export const MAX_RESUME_CHARS = 15_000;
const POSTING_ID = /^[0-9]{1,78}$/;
const postingId = (v: unknown): string => {
  if (typeof v !== "string" || !POSTING_ID.test(v) || /^0+$/.test(v)) throw new ThreadError("A message must name its posting");
  return v;
};
const MAX_TERMS_CHARS = 20_000;
const MAX_SEQ = 0xffff_ffff;
const HEX = /^[0-9a-f]{16,64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class ThreadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ThreadError";
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStamp = (v: unknown): v is string => typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v));
const isSeq = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_SEQ;

function note(v: unknown): string {
  if (typeof v !== "string") throw new ThreadError("A note must be text");
  if ([...v].length > MAX_NOTE_CHARS) throw new ThreadError(`A note can be at most ${MAX_NOTE_CHARS.toLocaleString("en-US")} characters`);
  return v;
}

function agreementId(v: unknown): string {
  if (typeof v !== "string" || !HEX.test(v)) throw new ThreadError("A message must name its offer");
  return v;
}

/** Checks a proposal and returns a clean copy, keys in a fixed order. */
export function validateProposal(raw: unknown): Proposal {
  if (!isObject(raw)) throw new ThreadError("The proposed terms must be an object");
  const { payType, rate, frequency, startDate, termsText, letter } = raw;
  if (!PAY_TYPES.includes(payType as PayType)) throw new ThreadError("The proposed pay type isn't hourly or salary");
  if (typeof rate !== "string" || !/^\d{1,12}$/.test(rate) || BigInt(rate) <= 0n) throw new ThreadError("The proposed pay must be a positive amount");
  if (!FREQUENCIES.includes(frequency as Frequency)) throw new ThreadError("The proposed pay frequency isn't one this app knows");
  if (typeof startDate !== "string" || !DATE.test(startDate) || Number.isNaN(Date.parse(`${startDate}T00:00:00Z`))) throw new ThreadError("The proposed start date isn't a date");
  if (typeof termsText !== "string" || !termsText.trim()) throw new ThreadError("The proposed terms are empty");
  if ([...termsText].length > MAX_TERMS_CHARS) throw new ThreadError("The proposed terms are too long");
  let cleanLetter: Letter;
  try {
    cleanLetter = validateLetter(letter);
  } catch (e) {
    throw new ThreadError(e instanceof Error ? e.message : "The proposed letter isn't valid");
  }
  let job: JobFields;
  try {
    job = validateJobFields(raw);
  } catch (e) {
    throw new ThreadError(e instanceof Error ? e.message : "The proposed job fields aren't valid");
  }
  return { payType: payType as PayType, rate, frequency: frequency as Frequency, startDate, termsText, letter: cleanLetter, ...job };
}

function validateBody(raw: unknown): ThreadBody {
  if (!isObject(raw)) throw new ThreadError("A message must have a body");
  switch (raw.type) {
    case "counter":
      return { type: "counter", agreementId: agreementId(raw.agreementId), proposal: validateProposal(raw.proposal), note: note(raw.note) };
    case "stands":
      return { type: "stands", agreementId: agreementId(raw.agreementId), note: note(raw.note) };
    case "revised":
      return { type: "revised", agreementId: agreementId(raw.agreementId), newAgreementId: agreementId(raw.newAgreementId), note: note(raw.note) };
    case "channel": {
      const { channelId, name, epoch, key } = raw;
      if (typeof channelId !== "string" || !/^[0-9a-f]{16}$/.test(channelId)) throw new ThreadError("A channel needs its id");
      if (typeof name !== "string" || !name.trim() || [...name].length > 60) throw new ThreadError("A channel needs a name of at most 60 characters");
      if (typeof epoch !== "number" || !Number.isInteger(epoch) || epoch < 0 || epoch > 999_999) throw new ThreadError("A channel's key number must be a whole number");
      if (typeof key !== "string" || !/^[0-9a-f]{64}$/.test(key)) throw new ThreadError("A channel's key must be 64 hex characters");
      return { type: "channel", channelId, name, epoch, key };
    }
    case "channel_left": {
      const { channelId, name } = raw;
      if (typeof channelId !== "string" || !/^[0-9a-f]{16}$/.test(channelId)) throw new ThreadError("A channel needs its id");
      if (typeof name !== "string" || [...name].length > 60) throw new ThreadError("A channel's name is at most 60 characters");
      return { type: "channel_left", channelId, name };
    }
    case "directory_join":
      return { type: "directory_join", name: directoryName(raw.name), publicKey: publicKey(raw.publicKey) };
    case "directory_leave":
      return { type: "directory_leave" };
    case "directory": {
      if (!Array.isArray(raw.entries) || raw.entries.length > MAX_DIRECTORY) throw new ThreadError(`A directory is a list of at most ${MAX_DIRECTORY}`);
      const seen = new Set<string>();
      const entries = raw.entries.map((e) => {
        if (!isObject(e)) throw new ThreadError("Each directory entry must be an object");
        const entry: { name: string; publicKey: string; address?: string } = { name: directoryName(e.name), publicKey: publicKey(e.publicKey) };
        if (e.address !== undefined) {
          if (typeof e.address !== "string" || !ALEO_ADDRESS.test(e.address)) throw new ThreadError("A directory entry's account isn't valid");
          entry.address = e.address;
        }
        if (seen.has(entry.publicKey)) throw new ThreadError("The same key is in the directory twice");
        seen.add(entry.publicKey);
        return entry;
      });
      return { type: "directory", entries };
    }
    case "group": {
      const { groupId, name, admin, members } = raw;
      if (typeof groupId !== "string" || !/^[0-9a-f]{16}$/.test(groupId)) throw new ThreadError("A group needs its id");
      if (!Array.isArray(members) || members.length < 2 || members.length > MAX_GROUP) throw new ThreadError(`A group has 2 to ${MAX_GROUP} people`);
      const seen = new Set<string>();
      const list = members.map((m) => {
        if (!isObject(m)) throw new ThreadError("Each group member must be an object");
        const entry = { name: directoryName(m.name), publicKey: publicKey(m.publicKey) };
        if (seen.has(entry.publicKey)) throw new ThreadError("Someone is in the group twice");
        seen.add(entry.publicKey);
        return entry;
      });
      const adminKey = publicKey(admin);
      if (!seen.has(adminKey)) throw new ThreadError("A group's admin must be in it");
      return { type: "group", groupId, name: directoryName(name), admin: adminKey, members: list };
    }
    case "group_text": {
      if (typeof raw.groupId !== "string" || !/^[0-9a-f]{16}$/.test(raw.groupId)) throw new ThreadError("A group message needs its group");
      if (typeof raw.text !== "string" || !raw.text.trim()) throw new ThreadError("A message can't be empty");
      if ([...raw.text].length > MAX_TEXT_CHARS) throw new ThreadError(`A message can be at most ${MAX_TEXT_CHARS.toLocaleString("en-US")} characters`);
      return { type: "group_text", groupId: raw.groupId, text: raw.text };
    }
    case "group_leave":
      if (typeof raw.groupId !== "string" || !/^[0-9a-f]{16}$/.test(raw.groupId)) throw new ThreadError("Leaving needs the group");
      return { type: "group_leave", groupId: raw.groupId };
    case "application": {
      const { name, nameHash, message, resume } = raw;
      if (typeof nameHash !== "string" || !POSTING_ID.test(nameHash)) throw new ThreadError("An application needs the applicant's registered name");
      if (typeof message !== "string") throw new ThreadError("An application's message must be text");
      if ([...message].length > MAX_APPLICATION_CHARS) throw new ThreadError(`An application's message can be at most ${MAX_APPLICATION_CHARS.toLocaleString("en-US")} characters`);
      if (typeof resume !== "string" || !resume.trim()) throw new ThreadError("An application needs a resume");
      if ([...resume].length > MAX_RESUME_CHARS) throw new ThreadError(`A resume can be at most ${MAX_RESUME_CHARS.toLocaleString("en-US")} characters`);
      return { type: "application", postingId: postingId(raw.postingId), name: directoryName(name), nameHash, message: message.trim(), resume: resume.trim() };
    }
    case "application_status": {
      if (!APPLICATION_STATUSES.includes(raw.status as ApplicationStatus)) throw new ThreadError("That application status isn't one this app knows");
      return { type: "application_status", postingId: postingId(raw.postingId), status: raw.status as ApplicationStatus };
    }
    case "text": {
      if (typeof raw.text !== "string" || !raw.text.trim()) throw new ThreadError("A message can't be empty");
      if ([...raw.text].length > MAX_TEXT_CHARS) throw new ThreadError(`A message can be at most ${MAX_TEXT_CHARS.toLocaleString("en-US")} characters`);
      return { type: "text", text: raw.text };
    }
    default:
      throw new ThreadError("That kind of message isn't one this app knows");
  }
}

/** Checks a message that arrived from `from`: a known kind, one that side may send, every field in shape. */
export function validateMessage(raw: unknown, from: Side): ThreadMessage {
  if (!isObject(raw)) throw new ThreadError("A message must be an object");
  if (raw.version !== 1) throw new ThreadError("Unknown message version");
  if (raw.from !== from) throw new ThreadError("The message says it's from the wrong side");
  if (typeof raw.id !== "string" || !/^[0-9a-f]{32}$/.test(raw.id)) throw new ThreadError("A message needs an id");
  if (!isStamp(raw.sentAt)) throw new ThreadError("A message needs the time it was sent");
  const body = validateBody(raw.body);
  const may = SENDS[body.type];
  if (may !== "either" && may !== from) throw new ThreadError("That side can't send that kind of message");
  return { version: 1, id: raw.id, from, sentAt: raw.sentAt, body };
}

function validateItem(raw: unknown): ThreadItem {
  if (!isObject(raw)) throw new ThreadError("Each message must be an object");
  const from = raw.from === "business" || raw.from === "worker" ? raw.from : null;
  if (!from) throw new ThreadError("Each message needs its side");
  const m = validateMessage(raw, from);
  if (typeof raw.mine !== "boolean") throw new ThreadError("Each message must say whose it is");
  if (!isSeq(raw.seq)) throw new ThreadError("A slot must be a whole number");
  const item: ThreadItem = { ...m, mine: raw.mine, seq: raw.seq };
  if (raw.receivedAt !== undefined) {
    if (!isStamp(raw.receivedAt)) throw new ThreadError("A message's arrival time isn't a time");
    item.receivedAt = raw.receivedAt;
  }
  if (raw.read !== undefined) {
    if (raw.read !== true || raw.mine) throw new ThreadError("Only their messages can be marked read");
    item.read = true;
  }
  return item;
}

export const emptyThread = (): Thread => ({ items: [], nextIn: 0, nextOut: 0 });

/** Checks a thread from the vault: every message, and both slots. */
export function validateThread(raw: unknown): Thread {
  if (!isObject(raw)) throw new ThreadError("A thread must be an object");
  if (!Array.isArray(raw.items)) throw new ThreadError("A thread's messages must be a list");
  if (!isSeq(raw.nextIn) || !isSeq(raw.nextOut)) throw new ThreadError("A thread's slots must be whole numbers");
  const byId = new Map<string, ThreadItem>();
  for (const item of raw.items.map(validateItem)) byId.set(item.id, item);
  return { items: [...byId.values()].sort(byTime), nextIn: raw.nextIn, nextOut: raw.nextOut };
}

const byTime = (a: ThreadItem, b: ThreadItem) => (a.sentAt < b.sentAt ? -1 : a.sentAt > b.sentAt ? 1 : a.id < b.id ? -1 : 1);

/** Keeps one message (the same id twice is kept once) and moves the right slot past it. */
export function addToThread(thread: Thread, item: ThreadItem): Thread {
  const fresh = validateItem(item);
  const items = [...thread.items.filter((i) => i.id !== fresh.id), fresh].sort(byTime);
  return fresh.mine
    ? { ...thread, items, nextOut: Math.max(thread.nextOut, fresh.seq + 1) }
    : { ...thread, items, nextIn: Math.max(thread.nextIn, fresh.seq + 1) };
}

/** Moves past an incoming slot that couldn't be read. */
export function skipIncoming(thread: Thread, seq: number): Thread {
  if (!isSeq(seq)) throw new ThreadError("A slot must be a whole number");
  return { ...thread, nextIn: Math.max(thread.nextIn, seq + 1) };
}

/** A fresh message id: 16 random bytes, hex. */
export function newMessageId(): string {
  const b = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

// ---- Reading a thread ------------------------------------------------------

type Counter = ThreadItem & { body: Extract<ThreadBody, { type: "counter" }> };

/** The person's latest request for changes to `agreementId` that the business hasn't answered, if any. */
export function openCounter(thread: Thread | undefined, agreementId: string): Counter | undefined {
  if (!thread) return undefined;
  let open: Counter | undefined;
  for (const item of thread.items) {
    const b = item.body;
    if (!("agreementId" in b) || b.agreementId !== agreementId) continue;
    if (b.type === "counter") open = item as Counter;
    else open = undefined; // answered
  }
  return open;
}

/** The business's answer to `agreementId`, if it gave one. */
type Answer = ThreadItem & { body: Extract<ThreadBody, { type: "stands" | "revised" }> };

export function answerFor(thread: Thread | undefined, agreementId: string): Answer | undefined {
  return thread?.items.filter((i): i is Answer => (i.body.type === "stands" || i.body.type === "revised") && i.body.agreementId === agreementId).at(-1);
}

/** The offer `newAgreementId` replaced, if the thread says it was a revision. */
export function revisedFrom(thread: Thread | undefined, newAgreementId: string): string | undefined {
  for (const i of thread?.items ?? []) if (i.body.type === "revised" && i.body.newAgreementId === newAgreementId) return i.body.agreementId;
  return undefined;
}

/** The `revised` message that put `newAgreementId` in place of an older offer, if there is one. */
export function revisionOf(thread: Thread | undefined, newAgreementId: string): (ThreadItem & { body: Extract<ThreadBody, { type: "revised" }> }) | undefined {
  return thread?.items.find((i): i is ThreadItem & { body: Extract<ThreadBody, { type: "revised" }> } => i.body.type === "revised" && i.body.newAgreementId === newAgreementId);
}

// ---- Reading and receipts ----------------------------------------------------

/** How many of their messages haven't been seen here (only those `only` picks, when given). */
export const unreadIn = (thread: Thread | undefined, only?: (item: ThreadItem) => boolean): number =>
  thread?.items.filter((i) => !i.mine && !i.read && (!only || only(i))).length ?? 0;

/** Marks some of their messages as seen. The same thread back when there was nothing to mark. */
export function markItemsRead(thread: Thread, ids: ReadonlySet<string>): Thread {
  if (!thread.items.some((i) => !i.mine && !i.read && ids.has(i.id))) return thread;
  return { ...thread, items: thread.items.map((i) => (i.mine || i.read || !ids.has(i.id) ? i : { ...i, read: true as const })) };
}

/** Marks every one of their messages as seen. The same thread back when there was nothing to mark. */
export function markThreadRead(thread: Thread): Thread {
  if (!thread.items.some((i) => !i.mine && !i.read)) return thread;
  return { ...thread, items: thread.items.map((i) => (i.mine || i.read ? i : { ...i, read: true as const })) };
}

/** Records the other side's receipt for my message in slot `seq`. The first time sticks. */
export function markDelivered(thread: Thread, seq: number, receivedAt: string): Thread {
  if (!isStamp(receivedAt)) throw new ThreadError("A receipt needs the time it was received");
  if (!thread.items.some((i) => i.mine && i.seq === seq && !i.receivedAt)) return thread;
  return { ...thread, items: thread.items.map((i) => (i.mine && i.seq === seq && !i.receivedAt ? { ...i, receivedAt } : i)) };
}

/** A line for a conversation list: the latest message, in a few words. */
export function preview(item: ThreadItem | undefined): string {
  if (!item) return "No messages yet";
  const b = item.body;
  const who = item.mine ? "You: " : "";
  if (b.type === "text") return who + (b.text.length > 80 ? `${b.text.slice(0, 79)}…` : b.text);
  if (b.type === "channel") return item.mine ? `You gave them the key to “${b.name}”` : `Added you to “${b.name}”`;
  if (b.type === "channel_left") return item.mine ? `You took them out of “${b.name}”` : `Took you out of “${b.name}”`;
  if (b.type === "directory_join") return item.mine ? "You let coworkers find you" : "Joined the coworker directory";
  if (b.type === "directory_leave") return item.mine ? "You left the coworker directory" : "Left the coworker directory";
  if (b.type === "directory") return item.mine ? "You updated the coworker directory" : "Updated the coworker directory";
  if (b.type === "group") return `Group: ${b.name}`;
  if (b.type === "group_text") return (item.mine ? "You: " : "") + b.text.slice(0, 80);
  if (b.type === "group_leave") return "Left a group";
  if (b.type === "application") return item.mine ? "You applied" : "Applied";
  if (b.type === "application_status") return item.mine ? `You marked the application: ${APPLICATION_STATUS_LABEL[b.status]}` : `Your application: ${APPLICATION_STATUS_LABEL[b.status]}`;
  if (b.type === "counter") return item.mine ? "You asked for changes to the offer" : "Asked for changes to the offer";
  if (b.type === "stands") return item.mine ? "You kept the offer as it is" : "Kept the offer as it is";
  return item.mine ? "You sent a revised offer" : "Sent a revised offer";
}

// ---- What changed ----------------------------------------------------------

export type Change = { field: keyof Proposal; label: string; was: string; wants: string };

const FREQUENCY_LABEL: Record<Frequency, string> = { weekly: "Every week", biweekly: "Every two weeks", semimonthly: "Twice a month", monthly: "Every month" };

/** Pay as people say it: "$30.00 an hour", "$52,000.00 a year". */
export const payLabel = (payType: PayType, rate: string): string => `$${formatCents(BigInt(rate))} ${payType === "hourly" ? "an hour" : "a year"}`;

/** Every field the proposal changes from `from`, as "was → wants", in the order the offer shows them. */
export function proposalChanges(from: Proposal, to: Proposal): Change[] {
  const out: Change[] = [];
  if (from.payType !== to.payType || from.rate !== to.rate) out.push({ field: "rate", label: "Pay", was: payLabel(from.payType, from.rate), wants: payLabel(to.payType, to.rate) });
  if (from.frequency !== to.frequency) out.push({ field: "frequency", label: "Paid", was: FREQUENCY_LABEL[from.frequency], wants: FREQUENCY_LABEL[to.frequency] });
  if (from.employmentType !== to.employmentType) {
    out.push({ field: "employmentType", label: "Employment", was: from.employmentType ? employmentLabel(from.employmentType) : NOT_STATED, wants: to.employmentType ? employmentLabel(to.employmentType) : NOT_STATED });
  }
  if (from.hoursPerWeek !== to.hoursPerWeek) {
    out.push({ field: "hoursPerWeek", label: "Hours", was: from.hoursPerWeek ? hoursLine(from.hoursPerWeek) : NOT_STATED, wants: to.hoursPerWeek ? hoursLine(to.hoursPerWeek) : NOT_STATED });
  }
  if (from.startDate !== to.startDate) out.push({ field: "startDate", label: "Start date", was: from.startDate, wants: to.startDate });
  if (from.termsText !== to.termsText) out.push({ field: "termsText", label: "Terms", was: from.termsText, wants: to.termsText });
  // The letter as one text, as the single box shows it.
  const was = letterText(from.letter);
  const wants = letterText(to.letter);
  if (was !== wants) out.push({ field: "letter", label: LETTER_LABEL, was, wants });
  return out;
}

const NOT_STATED = "Not stated";

/** An offer's terms as a proposal: the starting point the person edits. */
export function proposalOf(t: JobFields & { payType: PayType; rate: string; frequency: Frequency; startDate: string; termsText: string; letter?: Letter }): Proposal {
  return {
    payType: t.payType,
    rate: t.rate,
    frequency: t.frequency,
    startDate: t.startDate,
    termsText: t.termsText,
    letter: t.letter ?? { description: "", requirements: "", handbook: "", other: "" },
    ...(t.employmentType ? { employmentType: t.employmentType } : {}),
    ...(t.hoursPerWeek ? { hoursPerWeek: t.hoursPerWeek } : {}),
  };
}

/**
 * The written terms with the pay, the employment type, the hours and the
 * start date brought in step with `to`, wherever they still say what `from`
 * said (the draft writes each in these exact words). Anything else in the
 * text is left as it is.
 */
export function syncTermsText(text: string, from: Proposal, to: Proposal): string {
  let out = text;
  const swap = (was: string, now: string) => {
    if (was !== now) out = out.split(was).join(now);
  };
  if (from.employmentType && to.employmentType) swap(`Employment: ${employmentLabel(from.employmentType)}.`, `Employment: ${employmentLabel(to.employmentType)}.`);
  if (from.hoursPerWeek && to.hoursPerWeek) swap(`Hours: ${hoursLine(from.hoursPerWeek)}.`, `Hours: ${hoursLine(to.hoursPerWeek)}.`);
  const payWas = payLine(from.payType, BigInt(from.rate), from.frequency);
  const payNow = payLine(to.payType, BigInt(to.rate), to.frequency);
  if (payWas !== payNow) out = out.split(payWas).join(payNow);
  const startWas = longDate(from.startDate);
  const startNow = longDate(to.startDate);
  if (startWas !== startNow) out = out.split(startWas).join(startNow);
  return out;
}

// ---- The form ----------------------------------------------------------------

/** A proposal as a form holds it: the rate and the hours as typed, the employment type "" when not stated. */
export type ProposalDraft = Omit<Proposal, "rate" | "employmentType" | "hoursPerWeek"> & { rateText: string; employmentType: EmploymentType | ""; hoursText: string };

export const draftOf = (p: Proposal): ProposalDraft => {
  const { rate, employmentType, hoursPerWeek, ...rest } = p;
  return { ...rest, rateText: formatCents(BigInt(rate)).replace(/,/g, ""), employmentType: employmentType ?? "", hoursText: hoursPerWeek ?? "" };
};

/** The proposal a form holds, or why it can't be one yet. */
export function proposalFromDraft(d: ProposalDraft): { proposal: Proposal } | { problem: string } {
  let cents: bigint;
  try {
    cents = parseCents(d.rateText);
  } catch {
    return { problem: "Pay must be an amount, like 32.50" };
  }
  if (cents <= 0n) return { problem: "Pay must be more than zero" };
  if (!d.termsText.trim()) return { problem: "The written terms can't be empty" };
  if (!DATE.test(d.startDate)) return { problem: "Pick a start date" };
  const hours = d.hoursText.trim() ? cleanHours(d.hoursText) : undefined;
  if (hours === null) return { problem: "Hours a week must be a number up to 168, like 40 or 37.5" };
  const { rateText: _rateText, employmentType, hoursText: _hoursText, ...rest } = d;
  return { proposal: { ...rest, rate: cents.toString(), ...(employmentType ? { employmentType } : {}), ...(hours ? { hoursPerWeek: hours } : {}) } };
}
