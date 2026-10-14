// ---------------------------------------------------------------------------
// The rail: the account this business pays from when it pays its team and
// vendors directly, with no bank in the middle, and which team members have
// a matching account on it. Optional; the books work without it. Kept in the
// company file so a restore brings the link back, and dropped whole on unlink.
//
// Nothing here talks to the rail. Reading and signing live in src/chain,
// loaded only when the user taps Connect in Settings.
// ---------------------------------------------------------------------------

export type RailLink = {
  workerId: string;
  address: string;
  nameHash: string;
  agreementId: string;
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

function validateLink(raw: unknown): RailLink {
  const l = raw as Partial<RailLink> | null;
  if (!l || typeof l !== "object") throw new RailError("Each link must be an object");
  if (typeof l.workerId !== "string" || !l.workerId) throw new RailError("Each link needs a team member");
  if (!isRailAddress(l.address)) throw new RailError("Each link needs a valid account");
  if (typeof l.nameHash !== "string" || typeof l.agreementId !== "string") throw new RailError("Each link needs a name hash and an agreement id");
  return { workerId: l.workerId, address: l.address, nameHash: l.nameHash, agreementId: l.agreementId };
}

/** Checks every field and drops repeated team members (the later link wins). */
export function validateRail(raw: unknown): Rail {
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
  for (const link of r.links.map(validateLink)) byWorker.set(link.workerId, link);
  const rail: Rail = { version: 1, network: r.network, address: r.address, linkedAt: r.linkedAt, links: [...byWorker.values()] };
  const businessNameHash = optionalString(r.businessNameHash, "Business name hash");
  const businessName = optionalString(r.businessName, "Business name");
  if (businessNameHash !== undefined) rail.businessNameHash = businessNameHash;
  if (businessName !== undefined) rail.businessName = businessName;
  if (linkProof) rail.linkProof = linkProof;
  return rail;
}

export function railToJson(rail: Rail): string {
  return JSON.stringify(validateRail(rail));
}

export function railFromJson(text: string): Rail {
  return validateRail(JSON.parse(text));
}

/** Adds or replaces the link for one team member. */
export function addLink(rail: Rail, link: RailLink): Rail {
  return validateRail({ ...rail, links: [...rail.links.filter((l) => l.workerId !== link.workerId), link] });
}
