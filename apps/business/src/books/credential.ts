// ---------------------------------------------------------------------------
// A credential as a vault keeps it (docs/HEWN_ART.md, "A worker's land and
// its landmarks"): a business vouching for a person it has an agreement
// with, employment verified, a skill, a clearance, or something custom. The
// document says what it is, in the business's words; the record on the
// network carries only a hash of it (the scope), a random nonce both sides
// hold, and the commitment its public status is filed under. The person's
// app draws each one as a landmark on their land; the business's app keeps
// its copy. Pure: no network, nothing logged.
// ---------------------------------------------------------------------------

import type { Landmark } from "@pnw/art";

export const CREDENTIAL_KINDS = ["employment", "skills", "clearance", "custom"] as const;
export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];

export const CREDENTIAL_KIND_LABEL: Record<CredentialKind, string> = {
  employment: "Employment verified",
  skills: "Skills",
  clearance: "Clearance",
  custom: "Custom",
};

/** Offered until the person answers; active once they accept; revoked by the business; declined by the person. */
export const CREDENTIAL_STATUSES = ["offered", "active", "revoked", "declined"] as const;
export type CredentialStatus = (typeof CREDENTIAL_STATUSES)[number];

export const CREDENTIAL_STATUS_LABEL: Record<CredentialStatus, string> = {
  offered: "Offered",
  active: "Active",
  revoked: "Revoked",
  declined: "Declined",
};

export class CredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialError";
  }
}

/** What a credential says: the document both vaults hold. The record carries only its hash. */
export type CredentialDocument = {
  version: 1;
  kind: CredentialKind;
  /** In a line: "Carpenter", "OSHA 30", "Site access, level 2". */
  title: string;
  /** From when (YYYY-MM-DD), and until when if it ended or expires. */
  from: string;
  to?: string;
  /** More, in the business's words. */
  details?: string;
};

export const MAX_CREDENTIAL_TITLE = 120;
export const MAX_CREDENTIAL_DETAILS = 2000;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const FIELD = /^\d{1,78}$/;
const ADDRESS = /^aleo1[a-z0-9]{58}$/;

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isDate = (v: unknown): v is string => typeof v === "string" && DATE.test(v) && !Number.isNaN(Date.parse(v));

export function validateCredentialDocument(raw: unknown): CredentialDocument {
  if (!isObject(raw)) throw new CredentialError("A credential's document must be an object");
  if (raw.version !== 1) throw new CredentialError("Unknown credential document version");
  if (!CREDENTIAL_KINDS.includes(raw.kind as CredentialKind)) throw new CredentialError("A credential is employment, skills, clearance or custom");
  if (typeof raw.title !== "string" || !raw.title.trim() || raw.title.length > MAX_CREDENTIAL_TITLE) throw new CredentialError(`A credential needs a title, up to ${MAX_CREDENTIAL_TITLE} characters`);
  if (!isDate(raw.from)) throw new CredentialError("A credential needs the date it is from (YYYY-MM-DD)");
  const doc: CredentialDocument = { version: 1, kind: raw.kind as CredentialKind, title: raw.title, from: raw.from };
  // The canonical form (what travels) writes an absent field as null.
  if (raw.to !== undefined && raw.to !== null) {
    if (!isDate(raw.to)) throw new CredentialError("A credential's end date must be a date (YYYY-MM-DD)");
    if (raw.to < doc.from) throw new CredentialError("A credential can't end before it starts");
    doc.to = raw.to;
  }
  if (raw.details !== undefined && raw.details !== null) {
    if (typeof raw.details !== "string" || raw.details.length > MAX_CREDENTIAL_DETAILS) throw new CredentialError(`A credential's details are up to ${MAX_CREDENTIAL_DETAILS} characters`);
    if (raw.details.trim()) doc.details = raw.details;
  }
  return doc;
}

/** The document's bytes as they are hashed: keys in a fixed order, absent fields null, nothing else. */
export function canonicalCredential(doc: CredentialDocument): string {
  return JSON.stringify({ version: 1, kind: doc.kind, title: doc.title, from: doc.from, to: doc.to ?? null, details: doc.details ?? null });
}

/** A credential as a vault keeps it: the person's own, or a business's copy of one it issued. */
export type Credential = {
  /** The record's commitment, a decimal field: what its public status is filed under. */
  commitment: string;
  kind: CredentialKind;
  document: CredentialDocument;
  /** The document's hash as the record carries it, 64 hex characters. */
  scope: string;
  /** The random nonce both sides hold, 64 hex characters: what makes the commitment unguessable. */
  nonce: string;
  status: CredentialStatus;
  /** The other party's account: the business for the person's copy, the person for the business's. */
  counterpart: string;
  /** The business's copy: the team member it was issued to. */
  workerId?: string;
  /** The block it was issued at, and that block's time, once read. */
  issuedAt?: number;
  since?: string;
};

export function validateCredential(raw: unknown): Credential {
  if (!isObject(raw)) throw new CredentialError("A credential must be an object");
  if (typeof raw.commitment !== "string" || !FIELD.test(raw.commitment)) throw new CredentialError("A credential needs its commitment");
  const document = validateCredentialDocument(raw.document);
  if (raw.kind !== document.kind) throw new CredentialError("A credential's kind must match its document");
  if (typeof raw.scope !== "string" || !HEX64.test(raw.scope)) throw new CredentialError("A credential needs its scope hash");
  if (typeof raw.nonce !== "string" || !HEX64.test(raw.nonce)) throw new CredentialError("A credential needs its nonce");
  if (!CREDENTIAL_STATUSES.includes(raw.status as CredentialStatus)) throw new CredentialError("A credential is offered, active, revoked or declined");
  if (typeof raw.counterpart !== "string" || !ADDRESS.test(raw.counterpart)) throw new CredentialError("A credential needs the other party's account");
  const c: Credential = { commitment: raw.commitment, kind: document.kind, document, scope: raw.scope, nonce: raw.nonce, status: raw.status as CredentialStatus, counterpart: raw.counterpart };
  if (raw.workerId !== undefined) {
    if (typeof raw.workerId !== "string" || !raw.workerId) throw new CredentialError("A credential's team member must be named");
    c.workerId = raw.workerId;
  }
  if (raw.issuedAt !== undefined) {
    if (typeof raw.issuedAt !== "number" || !Number.isInteger(raw.issuedAt) || raw.issuedAt < 0 || raw.issuedAt > 0xffff_ffff) throw new CredentialError("A credential's issue block must be a block height");
    c.issuedAt = raw.issuedAt;
  }
  if (raw.since !== undefined) {
    if (typeof raw.since !== "string" || Number.isNaN(Date.parse(raw.since))) throw new CredentialError("A credential's date must be a date");
    c.since = raw.since;
  }
  return c;
}

/** Later entries with the same commitment replace earlier ones; order is kept otherwise. */
export function validateCredentials(raw: unknown): Credential[] {
  if (!Array.isArray(raw)) throw new CredentialError("Credentials must be a list");
  const byCommitment = new Map<string, Credential>();
  for (const c of raw.map(validateCredential)) byCommitment.set(c.commitment, c);
  return [...byCommitment.values()];
}

/**
 * The landmarks a person's land draws from their credentials (docs/HEWN_ART.md): one offered is
 * the bare frame, one active is built and lit, one revoked stays as a ghost; a declined one
 * leaves no mark. Where each stands comes from its commitment, so it stands in the same spot on
 * every card, every day. Private view only: the public card draws none.
 */
export function landmarksOf(credentials: readonly Credential[]): Landmark[] {
  const out: Landmark[] = [];
  for (const c of credentials) {
    if (c.status === "declined") continue;
    out.push({ type: c.kind, seed: `credential:${c.commitment}`, status: c.status === "active" ? "active" : c.status === "offered" ? "pending" : "revoked" });
  }
  return out;
}

/** "2026-03-02 to 2026-10-01", or "from 2026-03-02" while it runs. */
export const credentialSpan = (doc: Pick<CredentialDocument, "from" | "to">): string => (doc.to ? `${doc.from} to ${doc.to}` : `from ${doc.from}`);

/**
 * A credential the business has started issuing: the document and the nonce are kept here
 * before the letter goes and the transaction is sent, so nothing is lost if the record takes a
 * while to show in Shield, or the send fails part way. Resolved into a credential once the
 * record with this nonce is read; dropped if the business gives up.
 */
export type CredentialDraft = {
  nonce: string;
  workerId: string;
  kind: CredentialKind;
  document: CredentialDocument;
  scope: string;
  counterpart: string;
  startedAt: string;
};

export function validateCredentialDraft(raw: unknown): CredentialDraft {
  if (!isObject(raw)) throw new CredentialError("A credential draft must be an object");
  if (typeof raw.nonce !== "string" || !HEX64.test(raw.nonce)) throw new CredentialError("A draft needs its nonce");
  if (typeof raw.workerId !== "string" || !raw.workerId) throw new CredentialError("A draft's team member must be named");
  const document = validateCredentialDocument(raw.document);
  if (raw.kind !== document.kind) throw new CredentialError("A draft's kind must match its document");
  if (typeof raw.scope !== "string" || !HEX64.test(raw.scope)) throw new CredentialError("A draft needs its scope hash");
  if (typeof raw.counterpart !== "string" || !ADDRESS.test(raw.counterpart)) throw new CredentialError("A draft needs the person's account");
  if (typeof raw.startedAt !== "string" || Number.isNaN(Date.parse(raw.startedAt))) throw new CredentialError("A draft needs the time it started");
  return { nonce: raw.nonce, workerId: raw.workerId, kind: document.kind, document, scope: raw.scope, counterpart: raw.counterpart, startedAt: raw.startedAt };
}

/** One draft per nonce, the later one winning. */
export function validateCredentialDrafts(raw: unknown): CredentialDraft[] {
  if (!Array.isArray(raw)) throw new CredentialError("Credential drafts must be a list");
  const byNonce = new Map<string, CredentialDraft>();
  for (const d of raw.map(validateCredentialDraft)) byNonce.set(d.nonce, d);
  return [...byNonce.values()];
}
