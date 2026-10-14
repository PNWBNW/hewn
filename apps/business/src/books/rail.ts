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
  /** The next unused slot in this person's mailbox, per kind of document. Missing means 0. */
  mailboxSeq?: { [K in MailboxKind]?: number };
  /** `offered` until the other side approves the agreement; links from before this existed load as `linked`. */
  status: Exclude<LinkStatus, "typed">;
  /** ISO timestamp of the offer, when this app sent it. */
  offeredAt?: string;
  /** ISO timestamp of the approval, when this app saw it. */
  linkedAt?: string;
};

export type PartyKind = "customer" | "vendor";

/**
 * A customer or vendor on the rail. Today only the address can be set (the
 * party stays typed); the agreement fields wait for the party-agreement
 * program, after which a party can be offered to and linked like a team member.
 */
export type PartyLink = {
  kind: PartyKind;
  /** The customer's or vendor's id in the books. */
  id: string;
  address?: string;
  nameHash?: string;
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
};

const ADDRESS = /^aleo1[a-z0-9]{58}$/;
const PARTIES_KEY = /^[0-9a-f]{64}$/;
const MAX_SEQ = 0xffff_ffff;
const PARTY_KINDS: readonly PartyKind[] = ["customer", "vendor"];
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
  if (offeredAt !== undefined) link.offeredAt = offeredAt;
  if (linkedAt !== undefined) link.linkedAt = linkedAt;
  return link;
}

/** Checks one customer or vendor link. An offered or linked party needs its agreement; a typed one may hold just an address. */
export function validatePartyLink(raw: unknown): PartyLink {
  const p = raw as Partial<PartyLink> | null;
  if (!p || typeof p !== "object") throw new RailError("Each party link must be an object");
  if (!PARTY_KINDS.includes(p.kind as PartyKind)) throw new RailError("Each party link is for a customer or a vendor");
  if (typeof p.id !== "string" || !p.id) throw new RailError("Each party link needs a customer or vendor");
  if (!LINK_STATUSES.includes(p.status as LinkStatus)) throw new RailError("Each party link is typed, offered or linked");
  const link: PartyLink = { kind: p.kind as PartyKind, id: p.id, status: p.status as LinkStatus };
  if (p.address !== undefined) {
    if (!isRailAddress(p.address)) throw new RailError(ADDRESS_HINT);
    link.address = p.address;
  }
  const nameHash = optionalString(p.nameHash, "A party's name hash");
  const agreementId = optionalString(p.agreementId, "A party's agreement id");
  if (nameHash !== undefined) link.nameHash = nameHash;
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
  return rail;
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
 * was and remembers when it was offered; a different agreement (a new
 * parties key) starts its mailbox over.
 */
export function addLink(rail: Rail, link: RailLink): Rail {
  const fresh = validateLink(link);
  const previous = linkFor(rail, fresh.workerId);
  if (previous?.mailboxSeq && previous.partiesKey === fresh.partiesKey && fresh.mailboxSeq === undefined) fresh.mailboxSeq = previous.mailboxSeq;
  if (previous?.offeredAt && previous.agreementId === fresh.agreementId && fresh.offeredAt === undefined) fresh.offeredAt = previous.offeredAt;
  return validateRail({ ...rail, links: [...rail.links.filter((l) => l.workerId !== fresh.workerId), fresh] }, LEGACY);
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
  return validateRail({ ...rail, links: rail.links.map((l) => (l.workerId === workerId ? { ...l, status: "linked", linkedAt } : l)) }, LEGACY);
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
 * can be reached at. An offered or linked party keeps its agreement, so only
 * its address moves. Returns the rail unchanged when nothing is linked.
 */
export function setPartyAddress(rail: Rail | null | undefined, kind: PartyKind, id: string, address: string | undefined): Rail | undefined {
  if (!rail) return undefined;
  const clean = address?.trim() || undefined;
  const current = partyLinkFor(rail, kind, id);
  if (!clean) {
    if (!current) return rail;
    if (current.status !== "typed") throw new RailError("An offered or linked party keeps its account");
    return removePartyLink(rail, kind, id);
  }
  if (!isRailAddress(clean)) throw new RailError(ADDRESS_HINT);
  return setPartyLink(rail, { ...(current ?? { kind, id, status: "typed" }), address: clean });
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
