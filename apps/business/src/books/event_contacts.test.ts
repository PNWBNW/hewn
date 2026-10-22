import { describe, expect, it } from "vitest";
import { addToThread, emptyThread, validateMessage } from "./thread";
import { emptyMailbox, updateThread } from "./mailbox";
import { jobGuests, myAnswerIn, teamGuests, threadOfContact } from "./event_contacts";
import { type Invite, eventWho } from "./shared_events";
import { type Work, emptyWork, upsertAgreement, updateWorkThread } from "./work";
import type { Rail } from "./rail";

const KEY_A = "a1".repeat(32);
const KEY_B = "b2".repeat(32);
const ADDR = (c: string) => `aleo1${c.repeat(58)}`;
const ME = `04${"1".repeat(128)}`;
const LEE = `04${"2".repeat(128)}`;
const NOBODY = `04${"3".repeat(128)}`;

describe("who a business can invite", () => {
  it("is everyone linked who still works there", () => {
    const rail: Rail = {
      version: 1,
      network: "testnet",
      address: ADDR("q"),
      linkedAt: "2026-10-14T18:00:00.000Z",
      links: [
        { workerId: "w1", address: ADDR("z"), nameHash: "1", agreementId: "01".repeat(32), status: "linked", partiesKey: KEY_A },
        { workerId: "w2", address: ADDR("y"), nameHash: "2", agreementId: "02".repeat(32), status: "offered", partiesKey: KEY_B },
        { workerId: "w3", address: ADDR("x"), nameHash: "3", agreementId: "03".repeat(32), status: "linked", partiesKey: "c3".repeat(32) },
      ],
    };
    const workers = [
      { id: "w1", name: "Ana Ruiz", active: true },
      { id: "w2", name: "Bo Chen", active: true },
      { id: "w3", name: "Gone Now", active: false },
    ];
    expect(teamGuests(rail, workers)).toEqual([{ name: "Ana Ruiz", address: ADDR("z"), contact: { via: "pair", partiesKey: KEY_A } }]);
    expect(teamGuests(null, workers)).toEqual([]);
  });
});

describe("who a person can invite at a job", () => {
  const agreement = { agreementId: "01".repeat(32), partiesKey: KEY_A, employerAddress: ADDR("q"), employerNameHash: "9", status: "active" as const };
  const directory = (entries: { name: string; publicKey: string; address?: string }[]) =>
    ({ ...validateMessage({ version: 1, id: "d".repeat(32), from: "business", sentAt: "2026-10-22T15:00:00.000Z", body: { type: "directory", entries } }, "business"), mine: false, seq: 0 });

  it("is the employer, and coworkers in the directory with an account, when this person is listed there", () => {
    let work: Work = upsertAgreement(emptyWork("Ana"), agreement);
    work = updateWorkThread(work, KEY_A, (t) => addToThread(t, directory([{ name: "Me", publicKey: ME, address: ADDR("z") }, { name: "Lee", publicKey: LEE, address: ADDR("p") }, { name: "No account", publicKey: NOBODY }])));
    // Not in the directory yet: the employer only.
    expect(jobGuests(work, agreement, "Day Construction").map((g) => g.name)).toEqual(["Day Construction"]);
    work = { ...work, identities: { [KEY_A]: { publicKey: ME, privateKey: { kty: "EC", crv: "P-256", x: "x", y: "y", d: "d" }, createdAt: "2026-10-22T15:00:00.000Z", listed: true, name: "Me" } } };
    expect(jobGuests(work, agreement, "Day Construction")).toEqual([
      { name: "Day Construction", address: ADDR("q"), contact: { via: "pair", partiesKey: KEY_A } },
      { name: "Lee", address: ADDR("p"), contact: { via: "coworker", businessKey: KEY_A, publicKey: LEE } },
    ]);
  });

  it("finds the conversation behind a contact, and this account's own answer in it", () => {
    const answer = { ...validateMessage({ version: 1, id: "e".repeat(32), from: "business", sentAt: "2026-10-22T16:00:00.000Z", body: { type: "event_answer", eventId: "1".repeat(32), rev: 1, title: "Walkthrough", answer: "yes", note: "" } }, "business"), mine: true, seq: 0 };
    const mailbox = updateThread(emptyMailbox(), KEY_B, "w2", (t) => addToThread(t, answer));
    expect(threadOfContact({ via: "pair", partiesKey: KEY_B }, { mailbox })?.items).toHaveLength(1);
    expect(threadOfContact({ via: "coworker", businessKey: KEY_A, publicKey: LEE }, { mailbox })).toBeUndefined();
    const invite = { eventId: "1".repeat(32), from: { via: "pair", partiesKey: KEY_B }, me: eventWho(KEY_B) } as Invite;
    expect(myAnswerIn({ mailbox })(invite)).toMatchObject({ answer: "yes", rev: 1 });
    expect(myAnswerIn({ mailbox: emptyMailbox() })(invite)).toBeUndefined();
    expect(emptyThread().items).toEqual([]);
  });
});
