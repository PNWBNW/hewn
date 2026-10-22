import { describe, expect, it } from "vitest";
import {
  type PartyLink,
  type Rail,
  type RailLink,
  addLink,
  bumpSeq,
  isRailAddress,
  linkFor,
  linkStatus,
  payableLinks,
  markLinked,
  markOfferReceived,
  nextSeq,
  partyLinkFor,
  railFromJson,
  railToJson,
  removeLink,
  removePartyLink,
  setPartyAddress,
  setPartyLink,
  shortAddress,
  validateLink,
  validatePartyLink,
  validateRail,
  registeredFor,
  setRegistered,
} from "./rail";

const ADDR = "aleo1" + "q".repeat(58);
const ADDR_B = "aleo1" + "z".repeat(58);
const KEY = "ab".repeat(32);
const KEY_B = "cd".repeat(32);

const link: RailLink = { workerId: "wkr-1", address: ADDR_B, nameHash: "456", agreementId: "01".repeat(32), partiesKey: KEY, status: "linked" };

const rail: Rail = {
  version: 1,
  network: "testnet",
  address: ADDR,
  linkedAt: "2026-10-14T18:00:00.000Z",
  businessNameHash: "123",
  businessName: "brothers",
  linkProof: { message: "hewn:link:v1\ndefault\n" + ADDR + "\n2026-10-14T18:00:00.000Z", signature: "ab".repeat(32) },
  links: [link],
};

describe("rail", () => {
  it("round-trips through JSON", () => {
    expect(railFromJson(railToJson(rail))).toEqual(rail);
  });

  it("round-trips without the optional parts", () => {
    const bare: Rail = { version: 1, network: "testnet", address: ADDR, linkedAt: rail.linkedAt, links: [] };
    expect(railFromJson(railToJson(bare))).toEqual(bare);
    expect(railToJson(bare)).not.toContain("businessName");
  });

  it("rejects a bad account, version, date or link", () => {
    expect(() => validateRail({ ...rail, address: "aleo1short" })).toThrow(/valid account/);
    expect(() => validateRail({ ...rail, address: ADDR.toUpperCase() })).toThrow(/valid account/);
    expect(() => validateRail({ ...rail, version: 2 })).toThrow(/version/);
    expect(() => validateRail({ ...rail, linkedAt: "yesterday" })).toThrow(/date/);
    expect(() => validateRail({ ...rail, links: [{ ...link, address: "nope" }] })).toThrow(/valid account/);
    expect(() => validateRail({ ...rail, links: [{ ...link, workerId: "" }] })).toThrow(/team member/);
    expect(() => validateRail({ ...rail, linkProof: { message: "m" } })).toThrow(/signature/);
    expect(() => railFromJson("null")).toThrow(/object/);
  });

  it("keeps one link per team member, the later one winning", () => {
    const older = { ...link, nameHash: "1", agreementId: "aa" };
    const newer = { ...link, nameHash: "2", agreementId: "bb" };
    expect(validateRail({ ...rail, links: [older, newer] }).links).toEqual([newer]);
    expect(addLink({ ...rail, links: [older] }, newer).links).toEqual([newer]);
    expect(addLink(rail, { ...newer, workerId: "wkr-2" }).links).toHaveLength(2);
  });

  it("recognises and shortens accounts", () => {
    expect(isRailAddress(ADDR)).toBe(true);
    expect(isRailAddress(ADDR + "q")).toBe(false);
    expect(isRailAddress(42)).toBe(false);
    expect(shortAddress(ADDR)).toBe("aleo1qqqq…qqqq");
  });
});

describe("the parties key on a link", () => {
  const { partiesKey: _dropped, ...legacy } = link;

  it("is required on a new link and checked as 64 hex characters, no 0x", () => {
    expect(() => validateLink(legacy)).toThrow(/parties key/);
    expect(() => validateRail({ ...rail, links: [legacy] })).toThrow(/parties key/);
    expect(() => addLink(rail, { ...legacy, workerId: "wkr-2" })).toThrow(/parties key/);
    expect(() => validateLink({ ...link, partiesKey: "0x" + KEY })).toThrow(/64 hex/);
    expect(() => validateLink({ ...link, partiesKey: KEY.toUpperCase() })).toThrow(/64 hex/);
    expect(() => validateLink({ ...link, partiesKey: KEY.slice(2) })).toThrow(/64 hex/);
    expect(() => validateLink({ ...link, partiesKey: 7 })).toThrow(/64 hex/);
    expect(validateLink(link)).toEqual(link);
  });

  it("is allowed to be missing on a link loaded from an older file, which saves again as it was", () => {
    const text = JSON.stringify({ ...rail, links: [legacy] });
    const loaded = railFromJson(text);
    expect(loaded.links).toEqual([legacy]);
    expect(loaded.links[0]).not.toHaveProperty("partiesKey");
    expect(railFromJson(railToJson(loaded))).toEqual(loaded);
  });

  it("is filled in by importing the same team member again, in place", () => {
    const loaded = railFromJson(JSON.stringify({ ...rail, links: [legacy, { ...legacy, workerId: "wkr-2", address: ADDR }] }));
    const relinked = addLink(loaded, link);
    expect(relinked.links.map((l) => l.workerId)).toEqual(["wkr-2", "wkr-1"]);
    expect(linkFor(relinked, "wkr-1")).toEqual(link);
    expect(linkFor(relinked, "wkr-2")).not.toHaveProperty("partiesKey");
    expect(linkFor(relinked, "wkr-3")).toBeUndefined();
  });
});

describe("mailbox sequence numbers", () => {
  it("start at 0 and advance one slot at a time", () => {
    expect(nextSeq(link, "paystub")).toBe(0);
    const once = bumpSeq(rail, "wkr-1", "paystub");
    expect(nextSeq(linkFor(once, "wkr-1")!, "paystub")).toBe(1);
    expect(linkFor(once, "wkr-1")!.mailboxSeq).toEqual({ paystub: 1 });
    const twice = bumpSeq(once, "wkr-1", "paystub");
    expect(nextSeq(linkFor(twice, "wkr-1")!, "paystub")).toBe(2);
    expect(rail.links[0]!.mailboxSeq).toBeUndefined(); // pure
    expect(railFromJson(railToJson(twice))).toEqual(twice);
  });

  it("can note a specific slot as used and never move backwards", () => {
    const at5 = bumpSeq(rail, "wkr-1", "paystub", 5);
    expect(nextSeq(linkFor(at5, "wkr-1")!, "paystub")).toBe(6);
    const stale = bumpSeq(at5, "wkr-1", "paystub", 2);
    expect(nextSeq(linkFor(stale, "wkr-1")!, "paystub")).toBe(6);
    expect(() => bumpSeq(rail, "wkr-9", "paystub")).toThrow(/no account/);
    expect(() => bumpSeq(rail, "wkr-1", "paystub", -1)).toThrow(/whole number/);
    expect(() => bumpSeq(rail, "wkr-1", "paystub", 1.5)).toThrow(/whole number/);
  });

  it("are checked on load", () => {
    expect(validateLink({ ...link, mailboxSeq: { paystub: 3 } }).mailboxSeq).toEqual({ paystub: 3 });
    expect(validateLink({ ...link, mailboxSeq: {} })).not.toHaveProperty("mailboxSeq");
    expect(() => validateLink({ ...link, mailboxSeq: { paystub: -1 } })).toThrow(/whole number/);
    expect(() => validateLink({ ...link, mailboxSeq: { paystub: "3" } })).toThrow(/whole number/);
    expect(() => validateLink({ ...link, mailboxSeq: { paystub: 2 ** 32 } })).toThrow(/whole number/);
    expect(() => validateLink({ ...link, mailboxSeq: { letters: 1 } })).toThrow(/Unknown mailbox document kind/);
    expect(() => validateLink({ ...link, mailboxSeq: [1] })).toThrow(/object/);
    expect(() => validateLink({ ...link, mailboxSeq: "paystub" })).toThrow(/object/);
  });

  it("carry over when the same agreement is imported again, and start over for a new one", () => {
    const sent = bumpSeq(rail, "wkr-1", "paystub", 1);
    const same = addLink(sent, link);
    expect(linkFor(same, "wkr-1")!.mailboxSeq).toEqual({ paystub: 2 });
    const relinked = addLink(sent, { ...link, partiesKey: KEY_B });
    expect(linkFor(relinked, "wkr-1")!.partiesKey).toBe(KEY_B);
    expect(linkFor(relinked, "wkr-1")!.mailboxSeq).toBeUndefined();
  });
});

describe("typed, offered and linked team members", () => {
  const { status: _status, ...unstated } = link;
  const offered: RailLink = { ...link, status: "offered", offeredAt: "2026-10-14T19:00:00.000Z" };

  it("reads a link saved before offers existed as linked, and saves it that way from then on", () => {
    expect(validateLink(unstated).status).toBe("linked");
    const loaded = railFromJson(JSON.stringify({ ...rail, links: [unstated] }));
    expect(loaded.links[0]).toEqual(link);
    expect(railFromJson(railToJson(loaded))).toEqual(loaded);
    expect(JSON.parse(railToJson(loaded))).not.toHaveProperty("partyLinks");
  });

  it("checks the status and its dates", () => {
    expect(validateLink(offered)).toEqual(offered);
    expect(validateLink({ ...link, linkedAt: "2026-10-16T09:00:00.000Z" }).linkedAt).toBe("2026-10-16T09:00:00.000Z");
    expect(() => validateLink({ ...link, status: "typed" })).toThrow(/offered or linked/);
    expect(() => validateLink({ ...link, status: "sent" })).toThrow(/offered or linked/);
    expect(() => validateLink({ ...offered, offeredAt: "soon" })).toThrow(/offer date/);
    expect(() => validateLink({ ...link, linkedAt: 5 })).toThrow(/link date/);
    // An offered link is always new, so it always carries the parties key.
    const { partiesKey: _k, ...keyless } = offered;
    expect(() => validateLink(keyless, { allowLegacyLinks: true })).toThrow(/parties key/);
    expect(railFromJson(railToJson({ ...rail, links: [offered] })).links).toEqual([offered]);
  });

  it("tells typed from offered from linked, for anyone, even with nothing linked", () => {
    expect(linkStatus(null, "worker", "wkr-1")).toBe("typed");
    expect(linkStatus({ ...rail, links: [] }, "worker", "wkr-1")).toBe("typed");
    expect(linkStatus({ ...rail, links: [offered] }, "worker", "wkr-1")).toBe("offered");
    expect(linkStatus(rail, "worker", "wkr-1")).toBe("linked");
    expect(linkStatus(rail, "worker", "wkr-9")).toBe("typed");
  });

  it("pays only people whose agreement both sides approved, never an offer not yet accepted", () => {
    const other: RailLink = { ...offered, workerId: "wkr-2", agreementId: "02".repeat(32), partiesKey: KEY_B, address: "aleo1" + "y".repeat(58) };
    expect([...payableLinks({ ...rail, links: [link, other] })]).toEqual([["wkr-1", link.address]]);
    expect(payableLinks(null).size).toBe(0);
  });

  it("becomes linked when the other side approves, keeping everything else", () => {
    const sent = addLink({ ...rail, links: [] }, offered);
    const done = markLinked(sent, "wkr-1", "2026-10-16T09:00:00.000Z");
    expect(linkFor(done, "wkr-1")).toEqual({ ...offered, status: "linked", linkedAt: "2026-10-16T09:00:00.000Z" });
    expect(markLinked(done, "wkr-1", "2026-10-17T09:00:00.000Z")).toBe(done); // already linked: untouched
    expect(() => markLinked(rail, "wkr-9", "2026-10-16T09:00:00.000Z")).toThrow(/no agreement/);
    expect(linkFor(sent, "wkr-1")!.status).toBe("offered"); // pure
  });

  it("keeps the offer time when the same agreement is imported again, and drops it for another", () => {
    const sent = addLink({ ...rail, links: [] }, offered);
    const same = addLink(sent, { ...link, linkedAt: "2026-10-16T09:00:00.000Z" });
    expect(linkFor(same, "wkr-1")).toEqual({ ...link, offeredAt: offered.offeredAt, linkedAt: "2026-10-16T09:00:00.000Z" });
    const other = addLink(sent, { ...link, agreementId: "02".repeat(32), partiesKey: KEY_B });
    expect(linkFor(other, "wkr-1")).not.toHaveProperty("offeredAt");
  });
});

describe("customers and vendors on the rail", () => {
  const typed: PartyLink = { kind: "vendor", id: "vend-1", address: ADDR_B, status: "typed" };
  const linkedParty: PartyLink = { kind: "customer", id: "cust-1", address: ADDR_B, nameHash: "9", agreementId: "03".repeat(32), partiesKey: KEY, status: "linked" };

  it("round-trip, and are left out of the file when there are none", () => {
    const withParties: Rail = { ...rail, partyLinks: [typed, linkedParty] };
    expect(railFromJson(railToJson(withParties))).toEqual(withParties);
    expect(JSON.parse(railToJson(rail))).not.toHaveProperty("partyLinks");
    expect(validateRail({ ...rail, partyLinks: [] })).not.toHaveProperty("partyLinks");
    expect(validateRail({ ...rail, partyLinks: [typed, { ...typed, address: ADDR }] }).partyLinks).toEqual([{ ...typed, address: ADDR }]);
  });

  it("are checked", () => {
    expect(validatePartyLink(typed)).toEqual(typed);
    expect(validatePartyLink(linkedParty)).toEqual(linkedParty);
    expect(validatePartyLink({ ...typed, kind: "worker" }).kind).toBe("worker"); // team members carry their registry identity here too
    expect(() => validatePartyLink({ ...typed, kind: "partner" })).toThrow(/team member, a customer or a vendor/);
    expect(() => validatePartyLink({ ...typed, id: "" })).toThrow(/needs a team member, customer or vendor/);
    expect(() => validatePartyLink({ ...typed, status: "sent" })).toThrow(/typed, offered or linked/);
    expect(() => validatePartyLink({ ...typed, address: "aleo1short" })).toThrow(/aleo1/);
    expect(() => validatePartyLink({ ...linkedParty, partiesKey: "0x" + KEY })).toThrow(/64 hex/);
    expect(() => validatePartyLink({ ...typed, status: "offered" })).toThrow(/needs an account, an agreement id and a parties key/);
    expect(() => validatePartyLink({ ...linkedParty, agreementId: undefined })).toThrow(/needs an account/);
    expect(() => validateRail({ ...rail, partyLinks: {} })).toThrow(/list/);
  });

  it("tell typed from linked, and are set, replaced and removed in place", () => {
    expect(linkStatus(rail, "vendor", "vend-1")).toBe("typed");
    const one = setPartyLink(rail, typed);
    expect(partyLinkFor(one, "vendor", "vend-1")).toEqual(typed);
    expect(linkStatus(one, "vendor", "vend-1")).toBe("typed");
    const two = setPartyLink(one, linkedParty);
    expect(linkStatus(two, "customer", "cust-1")).toBe("linked");
    expect(linkStatus(two, "vendor", "cust-1")).toBe("typed"); // a vendor with the same id is someone else
    const replaced = setPartyLink(two, { ...typed, address: ADDR });
    expect(replaced.partyLinks).toEqual([linkedParty, { ...typed, address: ADDR }]);
    expect(removePartyLink(replaced, "vendor", "vend-1").partyLinks).toEqual([linkedParty]);
    expect(removePartyLink(removePartyLink(replaced, "vendor", "vend-1"), "customer", "cust-1")).not.toHaveProperty("partyLinks");
    expect(rail.partyLinks).toBeUndefined(); // pure
  });

  it("take an account from the form, trimmed, and drop the party when it is cleared", () => {
    expect(setPartyAddress(null, "vendor", "vend-1", ADDR_B)).toBeUndefined();
    expect(setPartyAddress(undefined, "vendor", "vend-1", ADDR_B)).toBeUndefined();
    expect(setPartyAddress(rail, "vendor", "vend-1", "")).toBe(rail);
    expect(setPartyAddress(rail, "vendor", "vend-1", undefined)).toBe(rail);
    const set = setPartyAddress(rail, "vendor", "vend-1", `  ${ADDR_B} `)!;
    expect(partyLinkFor(set, "vendor", "vend-1")).toEqual(typed);
    expect(setPartyAddress(set, "vendor", "vend-1", "")).not.toHaveProperty("partyLinks");
    expect(() => setPartyAddress(rail, "vendor", "vend-1", "aleo1short")).toThrow(/aleo1/);
    expect(() => setPartyAddress(rail, "vendor", "vend-1", ADDR_B.toUpperCase())).toThrow(/aleo1/);
    // A linked party keeps its agreement; only its account moves, and it can't be cleared.
    const withLinked = setPartyLink(rail, linkedParty);
    expect(partyLinkFor(setPartyAddress(withLinked, "customer", "cust-1", ADDR)!, "customer", "cust-1")).toEqual({ ...linkedParty, address: ADDR });
    expect(() => setPartyAddress(withLinked, "customer", "cust-1", "")).toThrow(/keeps its account/);
  });

  it("keep the hash of the registered name an account was found by, until the account is edited by hand", () => {
    const found = setPartyAddress(rail, "vendor", "vend-1", ADDR_B, "123456789")!;
    expect(partyLinkFor(found, "vendor", "vend-1")).toEqual({ ...typed, nameHash: "123456789" });
    // Saving again without saying anything about the name keeps it.
    expect(partyLinkFor(setPartyAddress(found, "vendor", "vend-1", ADDR_B)!, "vendor", "vend-1")?.nameHash).toBe("123456789");
    // The account typed over by hand no longer matches the name: null drops it.
    expect(partyLinkFor(setPartyAddress(found, "vendor", "vend-1", ADDR, null)!, "vendor", "vend-1")).toEqual({ ...typed, address: ADDR });
    // A hash is a whole number.
    expect(() => setPartyAddress(rail, "vendor", "vend-1", ADDR_B, "not a hash")).toThrow(/whole number/);
  });
});

describe("registered identities", () => {
  const base: Rail = { version: 1, network: "testnet", address: "aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n", linkedAt: "2026-10-15T00:00:00.000Z", links: [] };
  const ANA = { address: "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px", nameHash: "123456789", name: "ana" };

  it("record who a team member, customer or vendor is, and read it back", () => {
    let r = setRegistered(base, "worker", "wkr-1", ANA);
    r = setRegistered(r, "vendor", "vend-1", { ...ANA, name: "dayco" });
    expect(registeredFor(r, "worker", "wkr-1")).toEqual(ANA);
    expect(registeredFor(r, "vendor", "vend-1")?.name).toBe("dayco");
    expect(registeredFor(r, "customer", "wkr-1")).toBeUndefined();
    expect(registeredFor(null, "worker", "wkr-1")).toBeUndefined();
    expect(linkStatus(r, "worker", "wkr-1")).toBe("typed"); // a team member's agreement lives in links, not here
    expect(railFromJson(railToJson(r))).toEqual(r);
  });

  it("refuse a bad account, hash or name", () => {
    expect(() => setRegistered(base, "worker", "wkr-1", { ...ANA, address: "aleo1short" })).toThrow(/aleo1/);
    expect(() => setRegistered(base, "worker", "wkr-1", { ...ANA, nameHash: "abc" })).toThrow(/whole number/);
    expect(() => setRegistered(base, "worker", "wkr-1", { ...ANA, name: "Ana Ruiz" })).toThrow(/registered name/);
    expect(() => validatePartyLink({ kind: "boss", id: "x", status: "typed" })).toThrow(/team member, a customer or a vendor/);
  });

  it("don't move an offered or linked party to another account", () => {
    const linked = setPartyLink(base, { kind: "vendor", id: "vend-1", address: ANA.address, agreementId: "a", partiesKey: "11".repeat(32), status: "linked" });
    expect(() => setRegistered(linked, "vendor", "vend-1", { ...ANA, address: "aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n" })).toThrow(/keeps its account/);
    expect(registeredFor(setRegistered(linked, "vendor", "vend-1", ANA), "vendor", "vend-1")).toEqual(ANA);
  });
});

describe("the terms a business offered", () => {
  const terms = {
    version: 1 as const,
    kind: "terms" as const,
    agreementId: "ef".repeat(32),
    termsText: "Carpenter, 40 hours a week.\nTwo weeks' notice.",
    payType: "hourly" as const,
    rate: "3000",
    frequency: "biweekly" as const,
    startDate: "2026-11-02",
    businessName: "Brothers Building",
    offeredAt: "2026-10-16T18:00:00.000Z",
  };
  const offered: RailLink = { ...link, status: "offered", offeredAt: terms.offeredAt, terms };

  it("are kept on the link and survive a save and load", () => {
    expect(validateLink(offered).terms).toEqual(terms);
    const saved = railFromJson(railToJson({ ...rail, links: [offered] }));
    expect(linkFor(saved, "wkr-1")!.terms).toEqual(terms);
  });

  it("are optional, so links from before they were kept still load", () => {
    expect(validateLink(link)).not.toHaveProperty("terms");
  });

  it("are refused when they aren't a terms document", () => {
    expect(() => validateLink({ ...offered, terms: { ...terms, kind: "paystub" } })).toThrow(/offer's terms are unreadable/);
    expect(() => validateLink({ ...offered, terms: { ...terms, rate: "30.00" } })).toThrow(/offer's terms are unreadable/);
    expect(() => validateLink({ ...offered, terms: "Carpenter" })).toThrow(/offer's terms are unreadable/);
  });

  it("stay through approval and through importing the same agreement again, and go with a new agreement", () => {
    const sent = addLink({ ...rail, links: [] }, offered);
    expect(linkFor(markLinked(sent, "wkr-1", "2026-10-17T09:00:00.000Z"), "wkr-1")!.terms).toEqual(terms);
    const { terms: _t, offeredAt: _o, ...imported } = { ...offered, status: "linked" as const };
    expect(linkFor(addLink(sent, imported), "wkr-1")!.terms).toEqual(terms);
    const another = { ...imported, agreementId: "02".repeat(32), partiesKey: KEY_B };
    expect(linkFor(addLink(sent, another), "wkr-1")).not.toHaveProperty("terms");
  });
});

describe("an offer letter's files, saved by the business", () => {
  const sha = "b".repeat(64);
  const terms = {
    version: 2 as const,
    kind: "terms" as const,
    agreementId: "ef".repeat(32),
    termsText: "Carpenter.",
    payType: "hourly" as const,
    rate: "3000",
    frequency: "biweekly" as const,
    startDate: "2026-11-02",
    businessName: "Brothers Building",
    offeredAt: "2026-10-16T18:00:00.000Z",
    expiresAt: "2026-10-23T18:00:00.000Z",
    letter: { description: "Framing.", requirements: "", handbook: "", other: "" },
    files: [{ name: "contract.pdf", type: "application/pdf", size: 300_000, sha256: sha, chunks: 2 }],
  };
  const ref = { attachmentId: "att-1", sha256: sha, type: "application/pdf", size: 300_000, name: "contract.pdf" };
  const offered: RailLink = { ...link, status: "offered", offeredAt: terms.offeredAt, terms, offerFiles: [ref] };

  it("are kept with the letter they belong to, through a save and an import of the same agreement", () => {
    expect(validateLink(offered).offerFiles).toEqual([ref]);
    expect(linkFor(railFromJson(railToJson({ ...rail, links: [offered] })), "wkr-1")!.offerFiles).toEqual([ref]);
    const { terms: _t, offerFiles: _f, ...imported } = { ...offered, status: "linked" as const };
    expect(linkFor(addLink(addLink({ ...rail, links: [] }, offered), imported), "wkr-1")!.offerFiles).toEqual([ref]);
  });

  it("must match the letter's files, and need the letter", () => {
    expect(() => validateLink({ ...offered, offerFiles: [{ ...ref, sha256: "c".repeat(64) }] })).toThrow(/isn't one of the offer's files/);
    const { terms: _t, ...noTerms } = offered;
    expect(() => validateLink(noTerms)).toThrow(/need the offer letter/);
  });
});

describe("removing a team member's link", () => {
  it("drops only that link, so the person is typed again and can get a new offer", () => {
    const offered: RailLink = { ...link, workerId: "wkr-2", agreementId: "02".repeat(32), partiesKey: KEY_B, status: "offered", offeredAt: "2026-10-16T18:00:00.000Z" };
    const both = addLink(rail, offered);
    const after = removeLink(both, "wkr-2");
    expect(linkStatus(after, "worker", "wkr-2")).toBe("typed");
    expect(linkFor(after, "wkr-1")).toEqual(link);
    expect(removeLink(after, "wkr-9")).toBe(after);
  });
});

describe("an offer's receipt", () => {
  const offered: RailLink = { ...link, status: "offered", offeredAt: "2026-10-16T18:00:00.000Z" };
  const sent = { ...rail, links: [offered] };

  it("is kept once, for the offer it answers, through a save and an import of the same agreement", () => {
    const got = markOfferReceived(sent, "wkr-1", offered.agreementId, "2026-10-16T20:00:00.000Z");
    expect(linkFor(got, "wkr-1")!.offerReceivedAt).toBe("2026-10-16T20:00:00.000Z");
    expect(markOfferReceived(got, "wkr-1", offered.agreementId, "2026-10-17T20:00:00.000Z")).toBe(got);
    expect(linkFor(railFromJson(railToJson(got)), "wkr-1")!.offerReceivedAt).toBe("2026-10-16T20:00:00.000Z");
    expect(linkFor(addLink(got, { ...link }), "wkr-1")!.offerReceivedAt).toBe("2026-10-16T20:00:00.000Z");
  });

  it("is ignored for another offer, and goes with a new agreement", () => {
    expect(markOfferReceived(sent, "wkr-1", "02".repeat(32), "2026-10-16T20:00:00.000Z")).toBe(sent);
    expect(markOfferReceived(sent, "wkr-9", offered.agreementId, "2026-10-16T20:00:00.000Z")).toBe(sent);
    const got = markOfferReceived(sent, "wkr-1", offered.agreementId, "2026-10-16T20:00:00.000Z");
    expect(linkFor(addLink(got, { ...offered, agreementId: "02".repeat(32), partiesKey: KEY_B }), "wkr-1")).not.toHaveProperty("offerReceivedAt");
    expect(() => validateLink({ ...offered, offerReceivedAt: "soon" })).toThrow();
  });
});

describe("an offer's other inputs", () => {
  const offered: RailLink = { ...link, status: "offered", offeredAt: "2026-10-16T18:00:00.000Z", offerInputs: { industryCode: 4, reviewDate: "2027-01-31", endDate: "" } };

  it("are kept for a revision, through a save and an import of the same agreement, and go with a new one", () => {
    expect(validateLink(offered).offerInputs).toEqual({ industryCode: 4, reviewDate: "2027-01-31", endDate: "" });
    expect(linkFor(railFromJson(railToJson({ ...rail, links: [offered] })), "wkr-1")!.offerInputs).toEqual(offered.offerInputs);
    const sent = addLink({ ...rail, links: [] }, offered);
    const { offerInputs: _i, ...imported } = { ...offered, status: "linked" as const };
    expect(linkFor(addLink(sent, imported), "wkr-1")!.offerInputs).toEqual(offered.offerInputs);
    expect(linkFor(addLink(sent, { ...imported, agreementId: "02".repeat(32), partiesKey: KEY_B }), "wkr-1")).not.toHaveProperty("offerInputs");
  });

  it("are refused when malformed", () => {
    expect(() => validateLink({ ...offered, offerInputs: { industryCode: 0, reviewDate: "2027-01-31", endDate: "" } })).toThrow(/industry/);
    expect(() => validateLink({ ...offered, offerInputs: { industryCode: 4, reviewDate: "soon", endDate: "" } })).toThrow(/dates/);
  });
});
