import { describe, expect, it } from "vitest";
import {
  CREDENTIAL_KIND_LABEL,
  type Credential,
  type CredentialDocument,
  CredentialError,
  canonicalCredential,
  credentialSpan,
  landmarksOf,
  validateCredential,
  validateCredentialDocument,
  validateCredentialDraft,
  validateCredentialDrafts,
  validateCredentials,
} from "./credential";

const BIZ = "aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n";
const doc: CredentialDocument = { version: 1, kind: "employment", title: "Carpenter", from: "2026-03-02", to: "2026-10-01", details: "Framing crew, full time." };
const cred: Credential = { commitment: "1234567890", kind: "employment", document: doc, scope: "ab".repeat(32), nonce: "cd".repeat(32), status: "active", counterpart: BIZ };

describe("a credential's document", () => {
  it("has a kind, a title and a start, with an end and details when given", () => {
    expect(validateCredentialDocument(doc)).toEqual(doc);
    expect(validateCredentialDocument({ version: 1, kind: "skills", title: "OSHA 30", from: "2026-01-15" })).toEqual({ version: 1, kind: "skills", title: "OSHA 30", from: "2026-01-15" });
    expect(validateCredentialDocument({ ...doc, details: "   " })).not.toHaveProperty("details");
    // The canonical form writes absent fields as null; reading it back gives the same document.
    expect(validateCredentialDocument(JSON.parse(canonicalCredential({ version: 1, kind: "custom", title: "Night shift lead", from: "2026-05-01" })))).toEqual({ version: 1, kind: "custom", title: "Night shift lead", from: "2026-05-01" });
    expect(CREDENTIAL_KIND_LABEL.clearance).toBe("Clearance");
  });

  it("refuses an unknown kind, a missing title, a bad date, an end before the start, and too much text", () => {
    expect(() => validateCredentialDocument({ ...doc, kind: "medal" })).toThrow(CredentialError);
    expect(() => validateCredentialDocument({ ...doc, title: " " })).toThrow(/title/);
    expect(() => validateCredentialDocument({ ...doc, from: "March 2nd" })).toThrow(/date/);
    expect(() => validateCredentialDocument({ ...doc, to: "2026-03-01" })).toThrow(/before it starts/);
    expect(() => validateCredentialDocument({ ...doc, title: "x".repeat(121) })).toThrow(/120/);
    expect(() => validateCredentialDocument({ ...doc, details: "x".repeat(2001) })).toThrow(/2000/);
    expect(() => validateCredentialDocument({ ...doc, version: 2 })).toThrow(/version/);
  });

  it("hashes to a fixed form: keys in order, absent fields null", () => {
    expect(canonicalCredential(doc)).toBe('{"version":1,"kind":"employment","title":"Carpenter","from":"2026-03-02","to":"2026-10-01","details":"Framing crew, full time."}');
    expect(canonicalCredential({ version: 1, kind: "custom", title: "Night shift lead", from: "2026-05-01" })).toBe('{"version":1,"kind":"custom","title":"Night shift lead","from":"2026-05-01","to":null,"details":null}');
  });
});

describe("a credential in the vault", () => {
  it("keeps the commitment, the document, the scope and nonce, the status and the other party, and the business's extras", () => {
    expect(validateCredential(cred)).toEqual(cred);
    const issued = { ...cred, workerId: "w1", issuedAt: 20810000, since: "2026-10-25T03:00:00.000Z" };
    expect(validateCredential(issued)).toEqual(issued);
  });

  it("refuses a kind that disagrees with the document, a short hash, a bad status or account", () => {
    expect(() => validateCredential({ ...cred, kind: "skills" })).toThrow(/match its document/);
    expect(() => validateCredential({ ...cred, scope: "ab" })).toThrow(/scope/);
    expect(() => validateCredential({ ...cred, nonce: "zz".repeat(32) })).toThrow(/nonce/);
    expect(() => validateCredential({ ...cred, status: "lost" })).toThrow(/offered, active/);
    expect(() => validateCredential({ ...cred, counterpart: "nobody" })).toThrow(/account/);
    expect(() => validateCredential({ ...cred, commitment: "12field" })).toThrow(/commitment/);
    expect(() => validateCredential({ ...cred, issuedAt: -1 })).toThrow(/block/);
  });

  it("keeps one entry per commitment, the later one winning", () => {
    const list = validateCredentials([cred, { ...cred, commitment: "99" }, { ...cred, status: "revoked" }]);
    expect(list.map((c) => [c.commitment, c.status])).toEqual([["1234567890", "revoked"], ["99", "active"]]);
    expect(() => validateCredentials({})).toThrow(/list/);
  });
});

describe("the landmarks a person's credentials put on their land", () => {
  it("are one per credential, placed by its commitment: offered a frame, active lit, revoked a ghost, declined gone", () => {
    const list = [
      { ...cred, commitment: "1", status: "active" as const },
      { ...cred, commitment: "2", kind: "skills" as const, document: { ...doc, kind: "skills" as const }, status: "offered" as const },
      { ...cred, commitment: "3", kind: "clearance" as const, document: { ...doc, kind: "clearance" as const }, status: "revoked" as const },
      { ...cred, commitment: "4", kind: "custom" as const, document: { ...doc, kind: "custom" as const }, status: "declined" as const },
    ];
    expect(landmarksOf(list)).toEqual([
      { type: "employment", seed: "credential:1", status: "active" },
      { type: "skills", seed: "credential:2", status: "pending" },
      { type: "clearance", seed: "credential:3", status: "revoked" },
    ]);
    expect(landmarksOf([])).toEqual([]);
  });
});

describe("a credential the business is still issuing", () => {
  const draft = { nonce: "ef".repeat(32), workerId: "w1", kind: "employment" as const, document: doc, scope: "ab".repeat(32), counterpart: BIZ, startedAt: "2026-10-25T03:00:00.000Z" };

  it("keeps the nonce, the team member, the document and its scope until the record is read", () => {
    expect(validateCredentialDraft(draft)).toEqual(draft);
    expect(validateCredentialDrafts([draft, { ...draft, workerId: "w2" }]).map((d) => d.workerId)).toEqual(["w2"]);
    expect(() => validateCredentialDraft({ ...draft, nonce: "short" })).toThrow(/nonce/);
    expect(() => validateCredentialDraft({ ...draft, kind: "skills" })).toThrow(/match its document/);
    expect(() => validateCredentialDraft({ ...draft, startedAt: "yesterday" })).toThrow(/time/);
    expect(() => validateCredentialDrafts("x")).toThrow(/list/);
  });

  it("says the dates in a line", () => {
    expect(credentialSpan(doc)).toBe("2026-03-02 to 2026-10-01");
    expect(credentialSpan({ from: "2026-05-01" })).toBe("from 2026-05-01");
  });
});
