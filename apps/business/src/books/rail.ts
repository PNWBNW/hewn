// ---------------------------------------------------------------------------
// The rail: the account this business pays from when it pays its team and
// vendors directly, with no bank in the middle, and which of the parties it
// deals with have a matching account on it. Optional; the books work without
// it. Kept in the company file so a restore brings the link back, and dropped
// whole on unlink.
//
// Two kinds of party, everywhere one can be picked (Joshua, 2026-10-14):
//
//   typed   a name you entered; the books work, nothing else.
//   linked  has a profile and an agreement approved by both sides; only a
//           linked party can be paid on the rail, receive documents, or
//           send hours. In between, "offered": the agreement is sent and
//           waiting for the other side.
//
// Team members link through the employment agreement that exists today
// (`links`). Customers and vendors can carry an address now (`partyLinks`)
// and an agreement later, once a party-agreement program exists; until then
// they only ever read "typed".
//
// Nothing here talks to the rail. Reading and signing live in src/chain,
// loaded only when the user taps Connect in Settings.
// ---------------------------------------------------------------------------

import type { AttachmentRef } from "@pnw/sales";
import { type Card, validateCard } from "./card";
import { type Credential, validateCredential, validateCredentials } from "./credential";
import { type Half, validateHalf } from "./key_ring";
import { LetterError, validateFileRefs } from "./offer_letter";
import { type Terms, validateTerms } from "./work";

/** The documents the mailbox carries that keep a per-link sequence counter here. */
export const MAILBOX_KINDS = ["paystub"] as const;
export type MailboxKind = (typeof MAILBOX_KINDS)[number];

/** Where a party stands: typed (books only), offered (agreement sent), linked (approved by both). */
export type LinkStatus = "typed" | "offered" | "linked";

export type RailLink = {
  workerId: string;
  address: string;
  nameHash: string;
  agreementId: string;
  /**
   * The secret the two parties of the agreement share, 64 hex characters
   * (no `0x`): what seals a paystub to this person. Required on every link
   * made since paystub delivery existed; absent on older links until the
   * team member is imported again.
   */
  partiesKey?: string;
  /**
   * The agreement program the offer went to; absent means employer_agreement_v4. With v5, `half`
   * is this business's P-256 key pair for the agreement (books/key_ring.ts): the public part went
   * in the offer, the private part stays here, and the worker's comes back in the acceptance.
   */
  program?: string;
  half?: Half;
  /** The next unused slot in this person's mailbox, per kind of document. Missing means 0. */
  mailboxSeq?: { [K in MailboxKind]?: number };
  /** `offered` until the other side approves the agreement; links from before this existed load as `linked`. */
  status: Exclude<LinkStatus, "typed">;
  /** ISO timestamp of the offer, when this app sent it. */
  offeredAt?: string;
  /** When the person's app picked the offer up, from their receipt. Absent until one arrives. */
  offerReceivedAt?: string;
  /** ISO timestamp of the approval, when this app saw it. */
  linkedAt?: string;
  /**
   * The terms this business offered, exactly as sent (the worker's app checks
   * them against the agreement's terms fingerprint). Kept from the moment the
   * offer goes out, because the copy in the mailbox is removed once the
   * person accepts. Absent on offers sent before it was kept.
   */
  terms?: Terms;
  /** This business's own saved copies of the offer letter's files (vault attachments), one per file in `terms.files`. */
  offerFiles?: AttachmentRef[];
  /** What else the offer said on the chain (industry, review and end dates), so a revised offer can start from it. */
  offerInputs?: OfferInputs;
  /**
   * The offer went to someone not yet on the team (books/hiring.ts): they
   * join, as an active team member, when they accept, and leave the books if
   * the offer is withdrawn. Cleared once they accept.
   */
  joinsOnAccept?: true;
};

/** An offer's inputs that its terms don't carry. */
export type OfferInputs = { industryCode: number; reviewDate: string; endDate: string };

export type PartyKind = "customer" | "vendor" | "worker";

/**
 * Who a team member, customer or vendor is on the registry: the account and
 * registered name they were found by when they were added (people are added
 * only by their registered name since 2026-10-15). For customers and vendors
 * the agreement fields wait for the party-agreement program, after which a
 * party can be offered to and linked like a team member; a team member's
 * agreement lives in `links`, so their entry here only ever holds who they are.
 */
export type PartyLink = {
  kind: PartyKind;
  /** The team member's, customer's or vendor's id in the books. */
  id: string;
  address?: string;
  nameHash?: string;
  /** The bare registered name (`ana` for ana.hewn), when found on the registry. */
  name?: string;
  agreementId?: string;
  partiesKey?: string;
  status: LinkStatus;
};

/** What Shield signed to prove it controls the account, kept for audit. */
export type RailProof = { message: string; signature: string };

export type Rail = {
  version: 1;
  network: string;
  address: string;
  /** ISO timestamp of the link. */
  linkedAt: string;
  businessNameHash?: string;
  /** The bare registered name; the display suffix comes from brand.ts. */
  businessName?: string;
  linkProof?: RailProof;
  /** Team members, by agreement. */
  links: RailLink[];
  /** Customers and vendors with anything on the rail; left out when there are none. */
  partyLinks?: PartyLink[];
  /** When the books started following this account: the start date, and the opening entry (none when it held nothing). */
  start?: RailStart;
  /** The business's card (books/card.ts), once issued or claimed. */
  card?: Card;
  /** The business's copies of the credentials it issued (books/credential.ts), by commitment, each naming its team member. */
  credentials?: Credential[];
};

/** The day the books began following the linked account, and the entry that opened its balance. */
export type RailStart = {
  date: string;
  /** ISO time the books started; movements after it come in for review. Missing on starts from before it was kept. */
  at?: string;
  entryId?: string;
};

const ADDRESS = /^aleo1[a-z0-9]{58}$/;
const PARTIES_KEY = /^[0-9a-f]{64}$/;
const MAX_SEQ = 0xffff_ffff;
const PARTY_KINDS: readonly PartyKind[] = ["customer", "vendor", "worker"];
const REGISTERED_NAME = /^[a-z0-9_]{1,16}$/;
const NAME_HASH = /^\d{1,80}$/;
const LINK_STATUSES: readonly LinkStatus[] = ["typed", "offered", "linked"];

/** Shown wherever an account is typed by hand. */
export const ADDRESS_HINT = "Enter an account like aleo1…, 63 characters";

export class RailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RailError";
  }
}

export const isRailAddress = (s: unknown): s is string => typeof s === "string" && ADDRESS.test(s);

/**
 * Who can be paid on the rail: people whose agreement both sides approved (`linked`), by team
 * member id → account. An offer not yet accepted (`offered`) isn't enough: its account came from a
 * name lookup, not from an agreement they signed (the security review, 2026-10-22).
 */
export const payableLinks = (rail: Rail | null | undefined): Map<string, string> =>
  new Map((rail?.links ?? []).filter((l) => l.status === "linked").map((l) => [l.workerId, l.address]));

/** `aleo1abcd…wxyz`: enough to recognise an account, short enough for a phone. */
export function shortAddress(address: string): string {
  return address.length > 16 ? `${address.slice(0, 9)}…${address.slice(-4)}` : address;
}

const optionalString = (v: unknown, what: string): string | undefined => {
  if (v === undefined) return undefined;
  if (typeof v !== "string") throw new RailError(`${what} must be text`);
  return v;
};

const optionalDate = (v: unknown, what: string): string | undefined => {
  const s = optionalString(v, what);
  if (s !== undefined && Number.isNaN(Date.parse(s))) throw new RailError(`${what} must be a date`);
  return s;
};

export type ValidateOptions = {
  /** Accept links saved before paystub delivery existed, which have no parties key. */
  allowLegacyLinks?: boolean;
};

/**
 * Checks one team-member link. A new link must carry the parties key; a file
 * from before it existed may not. A link saved before offers existed has no
 * status and loads as `linked`.
 */
export function validateLink(raw: unknown, options: ValidateOptions = {}): RailLink {
  const l = raw as Partial<RailLink> | null;
  if (!l || typeof l !== "object") throw new RailError("Each link must be an object");
  if (typeof l.workerId !== "string" || !l.workerId) throw new RailError("Each link needs a team member");
  if (!isRailAddress(l.address)) throw new RailError("Each link needs a valid account");
  if (typeof l.nameHash !== "string" || typeof l.agreementId !== "string") throw new RailError("Each link needs a name hash and an agreement id");
  if (l.status !== undefined && l.status !== "offered" && l.status !== "linked") throw new RailError("Each link is offered or linked");
  const link: RailLink = { workerId: l.workerId, address: l.address, nameHash: l.nameHash, agreementId: l.agreementId, status: l.status ?? "linked" };
  if (l.partiesKey !== undefined) {
    if (typeof l.partiesKey !== "string" || !PARTIES_KEY.test(l.partiesKey)) throw new RailError("Each link's parties key must be 64 hex characters");
    link.partiesKey = l.partiesKey;
  } else if (!options.allowLegacyLinks || link.status === "offered") {
    throw new RailError("Each link needs the agreement's parties key");
  }
  if (l.program !== undefined) {
    if (typeof l.program !== "string" || !/^[a-z0-9_]+\.[a-z0-9]+$/.test(l.program)) throw new RailError("A link's program must be a program id");
    link.program = l.program;
  }
  if (l.half !== undefined) {
    try {
      link.half = validateHalf(l.half);
    } catch (e) {
      throw new RailError(e instanceof Error ? e.message : "A link's key half couldn't be read");
    }
  }
  if (l.mailboxSeq !== undefined) {
    const seq = l.mailboxSeq as Record<string, unknown> | null;
    if (!seq || typeof seq !== "object" || Array.isArray(seq)) throw new RailError("Mailbox sequence numbers must be an object");
    const clean: NonNullable<RailLink["mailboxSeq"]> = {};
    for (const [kind, n] of Object.entries(seq)) {
      if (!(MAILBOX_KINDS as readonly string[]).includes(kind)) throw new RailError(`Unknown mailbox document kind: ${kind}`);
      if (n === undefined) continue;
      if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > MAX_SEQ) throw new RailError(`The ${kind} sequence number must be a whole number`);
      clean[kind as MailboxKind] = n;
    }
    if (Object.keys(clean).length > 0) link.mailboxSeq = clean;
  }
  const offeredAt = optionalDate(l.offeredAt, "The offer date");
  const linkedAt = optionalDate(l.linkedAt, "The link date");
  const offerReceivedAt = optionalDate(l.offerReceivedAt, "The offer's receipt date");
  if (offeredAt !== undefined) link.offeredAt = offeredAt;
  if (offerReceivedAt !== undefined) link.offerReceivedAt = offerReceivedAt;
  if (linkedAt !== undefined) link.linkedAt = linkedAt;
  if (l.terms !== undefined) {
    try {
      link.terms = validateTerms(l.terms);
    } catch (e) {
      throw new RailError(`The offer's terms are unreadable: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (l.offerFiles !== undefined) {
    if (link.terms?.version !== 2) throw new RailError("Saved offer files need the offer letter they came with");
    try {
      link.offerFiles = validateFileRefs(l.offerFiles, link.terms.files);
    } catch (e) {
      throw e instanceof LetterError ? new RailError(e.message) : e;
    }
  }
  if (l.offerInputs !== undefined) {
    const o = l.offerInputs as Partial<OfferInputs> | null;
    const day = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
    if (!o || typeof o !== "object") throw new RailError("The offer's inputs must be an object");
    if (typeof o.industryCode !== "number" || !Number.isInteger(o.industryCode) || o.industryCode < 1 || o.industryCode > 255) throw new RailError("The offer's industry isn't valid");
    if (!day(o.reviewDate) || !(o.endDate === "" || day(o.endDate))) throw new RailError("The offer's dates aren't valid");
    link.offerInputs = { industryCode: o.industryCode, reviewDate: o.reviewDate as string, endDate: o.endDate as string };
  }
  if (l.joinsOnAccept !== undefined) {
    if (l.joinsOnAccept !== true) throw new RailError("Joining on acceptance is true or left out");
    if (link.status === "offered") link.joinsOnAccept = true; // an accepted offer has nothing left to join
  }
  return link;
}

/** Checks one customer or vendor link. An offered or linked party needs its agreement; a typed one may hold just an address. */
export function validatePartyLink(raw: unknown): PartyLink {
  const p = raw as Partial<PartyLink> | null;
  if (!p || typeof p !== "object") throw new RailError("Each party link must be an object");
  if (!PARTY_KINDS.includes(p.kind as PartyKind)) throw new RailError("Each party link is for a team member, a customer or a vendor");
  if (typeof p.id !== "string" || !p.id) throw new RailError("Each party link needs a team member, customer or vendor");
  if (!LINK_STATUSES.includes(p.status as LinkStatus)) throw new RailError("Each party link is typed, offered or linked");
  const link: PartyLink = { kind: p.kind as PartyKind, id: p.id, status: p.status as LinkStatus };
  if (p.address !== undefined) {
    if (!isRailAddress(p.address)) throw new RailError(ADDRESS_HINT);
    link.address = p.address;
  }
  const nameHash = optionalString(p.nameHash, "A party's name hash");
  const agreementId = optionalString(p.agreementId, "A party's agreement id");
  if (nameHash !== undefined) link.nameHash = nameHash;
  if (p.name !== undefined) {
    if (typeof p.name !== "string" || !REGISTERED_NAME.test(p.name)) throw new RailError("A registered name is 1 to 16 lower-case letters, digits or underscores");
    link.name = p.name;
  }
  if (agreementId !== undefined) link.agreementId = agreementId;
  if (p.partiesKey !== undefined) {
    if (typeof p.partiesKey !== "string" || !PARTIES_KEY.test(p.partiesKey)) throw new RailError("A party's parties key must be 64 hex characters");
    link.partiesKey = p.partiesKey;
  }
  if (link.status !== "typed" && (!link.address || !link.agreementId || !link.partiesKey)) {
    throw new RailError("An offered or linked party needs an account, an agreement id and a parties key");
  }
  return link;
}

/** Checks every field and drops repeated team members and parties (the later link wins). */
export function validateRail(raw: unknown, options: ValidateOptions = {}): Rail {
  const r = raw as Partial<Rail> | null;
  if (!r || typeof r !== "object") throw new RailError("Rail must be an object");
  if (r.version !== 1) throw new RailError("Unknown rail version");
  if (typeof r.network !== "string" || !r.network) throw new RailError("Rail needs a network");
  if (!isRailAddress(r.address)) throw new RailError("Rail needs a valid account");
  if (typeof r.linkedAt !== "string" || Number.isNaN(Date.parse(r.linkedAt))) throw new RailError("Rail needs the date it was linked");
  if (!Array.isArray(r.links)) throw new RailError("Rail links must be a list");
  if (r.partyLinks !== undefined && !Array.isArray(r.partyLinks)) throw new RailError("Rail party links must be a list");
  let linkProof: RailProof | undefined;
  if (r.linkProof !== undefined) {
    const p = r.linkProof as Partial<RailProof> | null;
    if (!p || typeof p.message !== "string" || typeof p.signature !== "string") throw new RailError("Link proof must hold a message and a signature");
    linkProof = { message: p.message, signature: p.signature };
  }
  const byWorker = new Map<string, RailLink>();
  for (const link of r.links.map((l) => validateLink(l, options))) byWorker.set(link.workerId, link);
  const byParty = new Map<string, PartyLink>();
  for (const link of (r.partyLinks ?? []).map(validatePartyLink)) byParty.set(`${link.kind}:${link.id}`, link);
  const rail: Rail = { version: 1, network: r.network, address: r.address, linkedAt: r.linkedAt, links: [...byWorker.values()] };
  const businessNameHash = optionalString(r.businessNameHash, "Business name hash");
  const businessName = optionalString(r.businessName, "Business name");
  if (businessNameHash !== undefined) rail.businessNameHash = businessNameHash;
  if (businessName !== undefined) rail.businessName = businessName;
  if (linkProof) rail.linkProof = linkProof;
  if (byParty.size > 0) rail.partyLinks = [...byParty.values()];
  if (r.start !== undefined) rail.start = validateStart(r.start);
  if (r.card !== undefined) rail.card = validateCard(r.card);
  if (r.credentials !== undefined) {
    const credentials = validateCredentials(r.credentials);
    if (credentials.length > 0) rail.credentials = credentials;
  }
  return rail;
}

const START_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validateStart(raw: unknown): RailStart {
  const s = raw as Partial<RailStart> | null;
  if (!s || typeof s !== "object") throw new RailError("The start must be an object");
  if (typeof s.date !== "string" || !START_DATE.test(s.date) || Number.isNaN(Date.parse(`${s.date}T00:00:00Z`))) {
    throw new RailError("The start needs a date");
  }
  const start: RailStart = { date: s.date };
  if (s.at !== undefined) {
    if (typeof s.at !== "string" || Number.isNaN(Date.parse(s.at))) throw new RailError("The start time must be a date");
    start.at = s.at;
  }
  const entryId = optionalString(s.entryId, "Opening entry");
  if (entryId !== undefined) start.entryId = entryId;
  return start;
}

// A saved file may still hold links from before the parties key existed; they
// stay as they are until the team member is imported again (addLink is strict).
const LEGACY: ValidateOptions = { allowLegacyLinks: true };

export function railToJson(rail: Rail): string {
  return JSON.stringify(validateRail(rail, LEGACY));
}

export function railFromJson(text: string): Rail {
  return validateRail(JSON.parse(text), LEGACY);
}

/**
 * Adds or replaces the link for one team member; the new link must be
 * complete. Importing the same agreement again keeps the mailbox where it
 * was and remembers when it was offered and what its terms were; a different
 * agreement (a new parties key) starts its mailbox over.
 */
export function addLink(rail: Rail, link: RailLink): Rail {
  const fresh = validateLink(link);
  const previous = linkFor(rail, fresh.workerId);
  if (previous?.mailboxSeq && previous.partiesKey === fresh.partiesKey && fresh.mailboxSeq === undefined) fresh.mailboxSeq = previous.mailboxSeq;
  if (previous?.offeredAt && previous.agreementId === fresh.agreementId && fresh.offeredAt === undefined) fresh.offeredAt = previous.offeredAt;
  if (previous?.offerReceivedAt && previous.agreementId === fresh.agreementId && fresh.offerReceivedAt === undefined) fresh.offerReceivedAt = previous.offerReceivedAt;
  if (previous?.terms && previous.agreementId === fresh.agreementId && fresh.terms === undefined) {
    fresh.terms = previous.terms;
    if (previous.offerFiles) fresh.offerFiles = previous.offerFiles;
  }
  if (previous?.offerInputs && previous.agreementId === fresh.agreementId && fresh.offerInputs === undefined) fresh.offerInputs = previous.offerInputs;
  return validateRail({ ...rail, links: [...rail.links.filter((l) => l.workerId !== fresh.workerId), fresh] }, LEGACY);
}

/** Records when the person's app picked up the offer (their receipt). The first time sticks. */
export function markOfferReceived(rail: Rail, workerId: string, agreementId: string, at: string): Rail {
  const link = linkFor(rail, workerId);
  if (!link || link.agreementId !== agreementId || link.offerReceivedAt) return rail;
  return validateRail({ ...rail, links: rail.links.map((l) => (l.workerId === workerId ? { ...l, offerReceivedAt: at } : l)) }, LEGACY);
}

/** Drops a team member's link (a withdrawn or expired offer): they're typed again, ready for a new offer. */
export function removeLink(rail: Rail, workerId: string): Rail {
  if (!linkFor(rail, workerId)) return rail;
  return validateRail({ ...rail, links: rail.links.filter((l) => l.workerId !== workerId) }, LEGACY);
}

/** The link for one team member, if they have one. */
export const linkFor = (rail: Rail, workerId: string): RailLink | undefined => rail.links.find((l) => l.workerId === workerId);

/** The link for one customer or vendor, if they have one. */
export const partyLinkFor = (rail: Rail, kind: PartyKind, id: string): PartyLink | undefined =>
  rail.partyLinks?.find((p) => p.kind === kind && p.id === id);

/** Where a party stands with the rail. Nobody is more than typed until an account is linked at all. */
export function linkStatus(rail: Rail | null | undefined, kind: "worker" | PartyKind, id: string): LinkStatus {
  if (!rail) return "typed";
  if (kind === "worker") return linkFor(rail, id)?.status ?? "typed";
  return partyLinkFor(rail, kind, id)?.status ?? "typed";
}

/** The other side approved the agreement: an offered team member becomes linked. A linked one is left as is. */
export function markLinked(rail: Rail, workerId: string, linkedAt: string): Rail {
  const link = linkFor(rail, workerId);
  if (!link) throw new RailError("That team member has no agreement on the rail");
  if (link.status === "linked") return rail;
  return validateRail(
    {
      ...rail,
      links: rail.links.map((l) => {
        if (l.workerId !== workerId) return l;
        const { joinsOnAccept: _joined, ...rest } = l;
        return { ...rest, status: "linked", linkedAt };
      }),
    },
    LEGACY,
  );
}

/** Adds or replaces the link for one customer or vendor, in place. */
export function setPartyLink(rail: Rail, link: PartyLink): Rail {
  const fresh = validatePartyLink(link);
  const rest = (rail.partyLinks ?? []).filter((p) => !(p.kind === fresh.kind && p.id === fresh.id));
  return validateRail({ ...rail, partyLinks: [...rest, fresh] }, LEGACY);
}

/** Drops whatever the rail holds for one customer or vendor. */
export function removePartyLink(rail: Rail, kind: PartyKind, id: string): Rail {
  return validateRail({ ...rail, partyLinks: (rail.partyLinks ?? []).filter((p) => !(p.kind === kind && p.id === id)) }, LEGACY);
}

/**
 * Sets (or, with nothing, clears) the account a typed customer or vendor
 * can be reached at, and, when the account was found by its registered name,
 * that name's hash (`null` clears a hash that no longer matches the account;
 * leaving it out keeps whatever is there). An offered or linked party keeps
 * its agreement, so only its address moves. Returns the rail unchanged when
 * nothing is linked.
 */
export function setPartyAddress(
  rail: Rail | null | undefined,
  kind: PartyKind,
  id: string,
  address: string | undefined,
  nameHash?: string | null,
): Rail | undefined {
  if (!rail) return undefined;
  const clean = address?.trim() || undefined;
  const current = partyLinkFor(rail, kind, id);
  if (!clean) {
    if (!current) return rail;
    if (current.status !== "typed") throw new RailError("An offered or linked party keeps its account");
    return removePartyLink(rail, kind, id);
  }
  if (!isRailAddress(clean)) throw new RailError(ADDRESS_HINT);
  if (nameHash && !/^\d{1,80}$/.test(nameHash)) throw new RailError("A name hash is a whole number");
  const next: PartyLink = { ...(current ?? { kind, id, status: "typed" }), address: clean };
  if (nameHash) next.nameHash = nameHash;
  else if (nameHash === null) delete next.nameHash;
  return setPartyLink(rail, next);
}

/** Who someone is on the registry: their account, name hash and bare registered name. */
export type Registered = { address: string; nameHash: string; name: string };

/** The registry identity a team member, customer or vendor was added with, if they have one. */
export function registeredFor(rail: Rail | null | undefined, kind: PartyKind, id: string): Registered | undefined {
  const p = rail ? partyLinkFor(rail, kind, id) : undefined;
  return p?.address && p.nameHash && p.name ? { address: p.address, nameHash: p.nameHash, name: p.name } : undefined;
}

/**
 * Records who a team member, customer or vendor is on the registry. An
 * offered or linked customer or vendor keeps its agreement, so its identity
 * can't move to a different account.
 */
export function setRegistered(rail: Rail, kind: PartyKind, id: string, who: Registered): Rail {
  if (!isRailAddress(who.address)) throw new RailError(ADDRESS_HINT);
  if (!NAME_HASH.test(who.nameHash)) throw new RailError("A name hash is a whole number");
  const current = partyLinkFor(rail, kind, id);
  if (current && current.status !== "typed" && current.address && current.address !== who.address) {
    throw new RailError("An offered or linked party keeps its account");
  }
  return setPartyLink(rail, { ...(current ?? { kind, id, status: "typed" }), address: who.address, nameHash: who.nameHash, name: who.name });
}

/** The next unused slot of `kind` in this person's mailbox (0 before anything was sent). */
export function nextSeq(link: Pick<RailLink, "mailboxSeq">, kind: MailboxKind): number {
  return link.mailboxSeq?.[kind] ?? 0;
}

/**
 * Notes that slot `used` of `kind` has gone to this team member, so the next
 * send takes the slot after it (after the current next when `used` is left
 * out). Never moves backwards.
 */
export function bumpSeq(rail: Rail, workerId: string, kind: MailboxKind, used?: number): Rail {
  const link = linkFor(rail, workerId);
  if (!link) throw new RailError("That team member has no account on the rail");
  const current = nextSeq(link, kind);
  const slot = used ?? current;
  if (!Number.isInteger(slot) || slot < 0 || slot > MAX_SEQ) throw new RailError(`The ${kind} sequence number must be a whole number`);
  const bumped: RailLink = { ...link, mailboxSeq: { ...link.mailboxSeq, [kind]: Math.max(current, slot + 1) } };
  return validateRail({ ...rail, links: rail.links.map((l) => (l.workerId === workerId ? bumped : l)) }, LEGACY);
}

/** The business's copy of one credential, if it holds one. */
export const railCredentialFor = (rail: Rail, commitment: string): Credential | undefined => rail.credentials?.find((c) => c.commitment === commitment);

/** Adds or replaces one issued credential by its commitment; an existing one keeps its date fields unless the new one brings its own. */
export function setRailCredential(rail: Rail, credential: Credential): Rail {
  const fresh = validateCredential(credential);
  const previous = railCredentialFor(rail, fresh.commitment);
  const merged: Credential = previous ? { ...previous, ...fresh } : fresh;
  const rest = (rail.credentials ?? []).filter((c) => c.commitment !== fresh.commitment);
  return validateRail({ ...rail, credentials: [...rest, merged] }, LEGACY);
}
