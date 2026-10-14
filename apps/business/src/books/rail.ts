// ---------------------------------------------------------------------------
// The rail: the account this business pays from when it pays its team and
// vendors directly, with no bank in the middle, and which team members have
// a matching account on it. Optional; the books work without it. Kept in the
// company file so a restore brings the link back, and dropped whole on unlink.
//
// Nothing here talks to the rail. Reading and signing live in src/chain,
// loaded only when the user taps Connect in Settings.
// ---------------------------------------------------------------------------

/** The documents the mailbox carries that keep a per-link sequence counter here. */
export const MAILBOX_KINDS = ["paystub"] as const;
export type MailboxKind = (typeof MAILBOX_KINDS)[number];

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
  links: RailLink[];
};

const ADDRESS = /^aleo1[a-z0-9]{58}$/;
const PARTIES_KEY = /^[0-9a-f]{64}$/;
const MAX_SEQ = 0xffff_ffff;

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

export type ValidateOptions = {
  /** Accept links saved before paystub delivery existed, which have no parties key. */
  allowLegacyLinks?: boolean;
};

/** Checks one link. A new link must carry the parties key; a file from before it existed may not. */
export function validateLink(raw: unknown, options: ValidateOptions = {}): RailLink {
  const l = raw as Partial<RailLink> | null;
  if (!l || typeof l !== "object") throw new RailError("Each link must be an object");
  if (typeof l.workerId !== "string" || !l.workerId) throw new RailError("Each link needs a team member");
  if (!isRailAddress(l.address)) throw new RailError("Each link needs a valid account");
  if (typeof l.nameHash !== "string" || typeof l.agreementId !== "string") throw new RailError("Each link needs a name hash and an agreement id");
  const link: RailLink = { workerId: l.workerId, address: l.address, nameHash: l.nameHash, agreementId: l.agreementId };
  if (l.partiesKey !== undefined) {
    if (typeof l.partiesKey !== "string" || !PARTIES_KEY.test(l.partiesKey)) throw new RailError("Each link's parties key must be 64 hex characters");
    link.partiesKey = l.partiesKey;
  } else if (!options.allowLegacyLinks) {
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
  return link;
}

/** Checks every field and drops repeated team members (the later link wins). */
export function validateRail(raw: unknown, options: ValidateOptions = {}): Rail {
  const r = raw as Partial<Rail> | null;
  if (!r || typeof r !== "object") throw new RailError("Rail must be an object");
  if (r.version !== 1) throw new RailError("Unknown rail version");
  if (typeof r.network !== "string" || !r.network) throw new RailError("Rail needs a network");
  if (!isRailAddress(r.address)) throw new RailError("Rail needs a valid account");
  if (typeof r.linkedAt !== "string" || Number.isNaN(Date.parse(r.linkedAt))) throw new RailError("Rail needs the date it was linked");
  if (!Array.isArray(r.links)) throw new RailError("Rail links must be a list");
  let linkProof: RailProof | undefined;
  if (r.linkProof !== undefined) {
    const p = r.linkProof as Partial<RailProof> | null;
    if (!p || typeof p.message !== "string" || typeof p.signature !== "string") throw new RailError("Link proof must hold a message and a signature");
    linkProof = { message: p.message, signature: p.signature };
  }
  const byWorker = new Map<string, RailLink>();
  for (const link of r.links.map((l) => validateLink(l, options))) byWorker.set(link.workerId, link);
  const rail: Rail = { version: 1, network: r.network, address: r.address, linkedAt: r.linkedAt, links: [...byWorker.values()] };
  const businessNameHash = optionalString(r.businessNameHash, "Business name hash");
  const businessName = optionalString(r.businessName, "Business name");
  if (businessNameHash !== undefined) rail.businessNameHash = businessNameHash;
  if (businessName !== undefined) rail.businessName = businessName;
  if (linkProof) rail.linkProof = linkProof;
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
 * was; a different agreement (a new parties key) starts its mailbox over.
 */
export function addLink(rail: Rail, link: RailLink): Rail {
  const fresh = validateLink(link);
  const previous = linkFor(rail, fresh.workerId);
  if (previous?.mailboxSeq && previous.partiesKey === fresh.partiesKey && fresh.mailboxSeq === undefined) fresh.mailboxSeq = previous.mailboxSeq;
  return validateRail({ ...rail, links: [...rail.links.filter((l) => l.workerId !== fresh.workerId), fresh] }, LEGACY);
}

/** The link for one team member, if they have one. */
export const linkFor = (rail: Rail, workerId: string): RailLink | undefined => rail.links.find((l) => l.workerId === workerId);

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
