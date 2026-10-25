import { describe, expect, it } from "vitest";
import { PROGRAMS } from "@pnw/config/programs";
import { packedWords } from "@pnw/records/packed";
import type { CredentialDocument } from "@/books/credential";
import {
  ACCEPT_CREDENTIAL,
  CREDENTIALS_PROGRAM,
  CredentialsError,
  DECLINE_CREDENTIAL,
  ISSUE_CREDENTIAL,
  REVOKE_CREDENTIAL,
  awaitCredentialStatus,
  credentialDocKind,
  credentialFromDraft,
  credentialFromRecord,
  credentialLookup,
  documentMatchesRecord,
  findRecordByNonce,
  openCredentialDocument,
  sealCredentialDocument,
  explorerCredentialRead,
  issueInputs,
  kindCode,
  kindOfCode,
  moveInputs,
  newNonce,
  parseCredentialRecord,
  parseCredentialRecords,
  queryCredentialAnchor,
  queryCredentialStatus,
  readCredentialRecords,
  scopeHash,
  statusOfCode,
} from "./credentials";

const BIZ = "aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n";
const PERSON = "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px";
const KEY = "9a".repeat(32);
const NONCE = "7c".repeat(32);
const COMMITMENT = "4150315520783996034609855426744788863384829253862985467052843096256898893367";
const doc: CredentialDocument = { version: 1, kind: "employment", title: "Carpenter", from: "2026-03-02" };

function record(owner: string, role: 1 | 2, over: { spent?: boolean; name?: string; scope?: string } = {}) {
  return {
    recordName: over.name ?? "Credential",
    spent: over.spent ?? false,
    recordPlaintext: [
      "{",
      `  owner: ${owner}.private,`,
      `  role: ${role}u8.private,`,
      "  kind: 1u8.private,",
      `  issuer: ${BIZ}.private,`,
      `  subject: ${PERSON}.private,`,
      `  scope: ${packedWords(over.scope ?? scopeHash(doc), 2)}.private,`,
      `  nonce: ${packedWords(NONCE, 2)}.private,`,
      `  commitment: ${COMMITMENT}field.private,`,
      "  _nonce: 1group.public",
      "}",
    ].join("\n"),
  };
}

const fakeFetch = (handler: (url: string) => { status: number; body?: unknown }): typeof fetch =>
  (async (input: string | URL | Request) => {
    const r = handler(String(input));
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body } as Response;
  }) as typeof fetch;

describe("the credentials program's calls", () => {
  it("go to hewn_credentials_v1, by the names the manifest gives", () => {
    expect(CREDENTIALS_PROGRAM).toBe("hewn_credentials_v1.aleo");
    expect(CREDENTIALS_PROGRAM).toBe(PROGRAMS.credentials.hewn_credentials);
    expect([ISSUE_CREDENTIAL, ACCEPT_CREDENTIAL, DECLINE_CREDENTIAL, REVOKE_CREDENTIAL].map((c) => c.function)).toEqual(["issue", "accept", "decline", "revoke"]);
  });

  it("number the kinds and statuses as the program does", () => {
    expect(["employment", "skills", "clearance", "custom"].map((k) => kindCode(k as never))).toEqual([1, 2, 3, 4]);
    expect(kindOfCode(3)).toBe("clearance");
    expect(kindOfCode(5)).toBeNull();
    expect([0, 1, 2, 3, 4, 5].map(statusOfCode)).toEqual([null, "offered", "active", "revoked", "declined", null]);
  });

  it("issue with five private inputs, the key, the scope and the nonce packed as two u128 words", () => {
    const scope = scopeHash(doc);
    expect(issueInputs(KEY, PERSON, "skills", scope, NONCE)).toEqual([packedWords(KEY, 2), PERSON, "2u8", packedWords(scope, 2), packedWords(NONCE, 2)]);
    expect(() => issueInputs("ab", PERSON, "skills", scope, NONCE)).toThrow(/key/);
    expect(() => issueInputs(KEY, "nobody", "skills", scope, NONCE)).toThrow(/account/);
    expect(() => issueInputs(KEY, PERSON, "medal" as never, scope, NONCE)).toThrow(CredentialsError);
    expect(() => issueInputs(KEY, PERSON, "skills", "zz", NONCE)).toThrow(/scope/);
    expect(() => issueInputs(KEY, PERSON, "skills", scope, "00".repeat(32))).toThrow(/not zero/);
  });

  it("hash the document the same way every time, and differently for a different document", () => {
    expect(scopeHash(doc)).toMatch(/^[0-9a-f]{64}$/);
    expect(scopeHash(doc)).toBe(scopeHash({ ...doc }));
    expect(scopeHash(doc)).not.toBe(scopeHash({ ...doc, title: "Carpenter " }));
    expect(scopeHash(doc)).not.toBe(scopeHash({ ...doc, to: "2026-10-01" }));
    expect(newNonce()).toMatch(/^[0-9a-f]{64}$/);
    expect(newNonce()).not.toBe(newNonce());
  });

  it("move a credential with the mover's own copy alone", () => {
    expect(moveInputs({ plaintext: "{ … }" })).toEqual(["{ … }"]);
  });
});

describe("reading credential records", () => {
  it("parses a copy, knowing whose it is", () => {
    const mine = parseCredentialRecord(record(PERSON, 2), PERSON)!;
    expect(mine).toMatchObject({ role: "subject", kind: "employment", issuer: BIZ, subject: PERSON, scope: scopeHash(doc), nonce: NONCE, commitment: COMMITMENT });
    expect(mine.plaintext).toBe(record(PERSON, 2).recordPlaintext);
    expect(parseCredentialRecord(record(BIZ, 1), BIZ)).toMatchObject({ role: "issuer", commitment: COMMITMENT });
    expect(documentMatchesRecord(doc, mine)).toBe(true);
    expect(documentMatchesRecord({ ...doc, title: "Foreman" }, mine)).toBe(false);
    expect(documentMatchesRecord({ ...doc, kind: "skills" }, { ...mine, scope: scopeHash({ ...doc, kind: "skills" }), kind: "employment" })).toBe(false);
  });

  it("drops spent records, other programs' records, copies owned by someone else, and a copy whose role disagrees with its owner", () => {
    expect(parseCredentialRecord(record(PERSON, 2, { spent: true }), PERSON)).toBeNull();
    expect(parseCredentialRecord(record(PERSON, 2, { name: "FinalAgreement" }), PERSON)).toBeNull();
    expect(parseCredentialRecord(record(PERSON, 2), BIZ)).toBeNull();
    expect(parseCredentialRecord(record(PERSON, 1), PERSON)).toBeNull();
    expect(parseCredentialRecord(null, PERSON)).toBeNull();
  });

  it("keeps one record per commitment, and reads them from the program's records in Shield", async () => {
    expect(parseCredentialRecords([record(PERSON, 2), record(PERSON, 2), record(PERSON, 2, { spent: true })], PERSON)).toHaveLength(1);
    const asked: [string, boolean | undefined][] = [];
    const found = await readCredentialRecords(async (p, all) => (asked.push([p, all]), [record(PERSON, 2)]), PERSON);
    expect(asked).toEqual([["hewn_credentials_v1.aleo", true]]);
    expect(found).toHaveLength(1);
    expect(await readCredentialRecords(async () => "nothing" as unknown as unknown[], PERSON)).toEqual([]);
  });

  it("reads the public status and the issue block by the commitment, null when there is none", async () => {
    const urls: string[] = [];
    const fetchImpl = fakeFetch((url) => {
      urls.push(url);
      if (url.endsWith(`credential_status/${COMMITMENT}field`)) return { status: 200, body: "2u8" };
      if (url.endsWith(`credential_anchor/${COMMITMENT}field`)) return { status: 200, body: "20810000u32" };
      return { status: 404 };
    });
    expect(await queryCredentialStatus(COMMITMENT, explorerCredentialRead("credential_status", "https://x/testnet", fetchImpl))).toBe("active");
    expect(await queryCredentialAnchor(COMMITMENT, explorerCredentialRead("credential_anchor", "https://x/testnet", fetchImpl))).toBe(20810000);
    expect(await queryCredentialStatus("7", explorerCredentialRead("credential_status", "https://x/testnet", fetchImpl))).toBeNull();
    expect(urls[0]).toBe(`https://x/testnet/program/hewn_credentials_v1.aleo/mapping/credential_status/${COMMITMENT}field`);
    await expect(explorerCredentialRead("credential_status", "https://x/testnet", fetchImpl)("abc")).rejects.toThrow(/commitment/);
    await expect(queryCredentialStatus(COMMITMENT, explorerCredentialRead("credential_status", "https://x/testnet", fakeFetch(() => ({ status: 500 }))))).rejects.toThrow(/couldn't be read/);
  });
});

describe("the document as a letter", () => {
  it("goes under its own slot, named by the scope, under the agreement's key", async () => {
    const scope = scopeHash(doc);
    expect(credentialDocKind(scope)).toBe(`cred_${scope.slice(0, 24)}`);
    expect(credentialDocKind(scope).length).toBeLessThanOrEqual(32);
    expect(() => credentialDocKind("zz")).toThrow(/scope/);
    expect(credentialLookup(KEY, scope)).toMatch(/^[0-9a-f]{64}$/);
    expect(credentialLookup(KEY, scope)).not.toBe(credentialLookup("ab".repeat(32), scope));
    const sealed = await sealCredentialDocument(KEY, doc);
    expect(sealed.scope).toBe(scope);
    expect(sealed.lookup).toBe(credentialLookup(KEY, scope));
    expect(new TextDecoder().decode(sealed.envelope)).not.toContain("Carpenter");
  });

  it("opens back to the same document, and refuses the wrong key or a document that isn't the record's", async () => {
    const sealed = await sealCredentialDocument(KEY, doc);
    expect(await openCredentialDocument(KEY, sealed.scope, sealed.envelope)).toEqual(doc);
    await expect(openCredentialDocument("ab".repeat(32), sealed.scope, sealed.envelope)).rejects.toThrow();
    const other = await sealCredentialDocument(KEY, { ...doc, title: "Foreman" });
    await expect(openCredentialDocument(KEY, sealed.scope, other.envelope)).rejects.toThrow();
  });
});

describe("from the record to the vault", () => {
  const draft = { nonce: NONCE, workerId: "w1", kind: "employment" as const, document: doc, scope: scopeHash(doc), counterpart: PERSON, startedAt: "2026-10-25T03:00:00.000Z" };

  it("finds the business's record by the draft's nonce and makes the business's copy, offered", () => {
    const records = parseCredentialRecords([record(BIZ, 1), record(BIZ, 1, { scope: "11".repeat(32) })], BIZ);
    const mine = findRecordByNonce(records, NONCE)!;
    expect(mine.commitment).toBe(COMMITMENT);
    expect(findRecordByNonce(records, "00".repeat(32))).toBeUndefined();
    expect(credentialFromDraft(draft, mine)).toEqual({ commitment: COMMITMENT, kind: "employment", document: doc, scope: scopeHash(doc), nonce: NONCE, status: "offered", counterpart: PERSON, workerId: "w1" });
    expect(() => credentialFromDraft({ ...draft, nonce: "00".repeat(32) }, mine)).toThrow(/draft/);
    expect(() => credentialFromDraft(draft, parseCredentialRecord(record(PERSON, 2), PERSON)!)).toThrow(/draft/);
  });

  it("makes the person's copy from their record and the document that came, in the status the network says", () => {
    const mine = parseCredentialRecord(record(PERSON, 2), PERSON)!;
    expect(credentialFromRecord(mine, doc, "active")).toEqual({ commitment: COMMITMENT, kind: "employment", document: doc, scope: scopeHash(doc), nonce: NONCE, status: "active", counterpart: BIZ });
    expect(() => credentialFromRecord(mine, { ...doc, title: "Foreman" }, "offered")).toThrow(/match/);
    expect(() => credentialFromRecord(parseCredentialRecord(record(BIZ, 1), BIZ)!, doc, "offered")).toThrow(/person/);
  });

  it("waits for the status the move should leave, and gives up honestly", async () => {
    const answers = [null, "1u8", "2u8"];
    let i = 0;
    const read = async () => answers[Math.min(i++, answers.length - 1)] ?? null;
    expect(await awaitCredentialStatus(COMMITMENT, { read, until: (s) => s === "active", sleep: async () => {} })).toBe("active");
    expect(i).toBe(3);
    await expect(awaitCredentialStatus(COMMITMENT, { read: async () => "1u8", until: (s) => s === "revoked", attempts: 2, sleep: async () => {} })).rejects.toThrow(/isn't showing yet/);
  });
});
