// Group chats end to end through a fake mailbox: the admin sets a group up,
// messages go to each member privately with one id, a removed member gets
// nothing new, and a member can't pass themselves off as the admin.
import { describe, expect, it } from "vitest";
import { MailboxError } from "@pnw/mailbox";
import type { Identity } from "../books/directory";
import { groupsFor, newGroupId } from "../books/groups";
import { addToThread, skipIncoming } from "../books/thread";
import { type Work, emptyWork, setIdentity, updateCoworker } from "../books/work";
import { COWORKER_KINDS, coworkerAccepts, mySide, newIdentity, pairKey } from "./coworkers";
import { fanOut, keepSent } from "./groups";
import { readThread } from "./thread";

const BIZ = "ab".repeat(32);

function fakeMailbox() {
  const slots = new Map<string, Uint8Array<ArrayBuffer>>();
  return {
    async put(lookup: string, envelope: Uint8Array) {
      if (slots.has(lookup)) throw new MailboxError("CONFLICT", "taken");
      slots.set(lookup, new Uint8Array(envelope));
    },
    async get(lookup: string) {
      return slots.get(lookup) ?? null;
    },
    async drop(lookup: string) {
      slots.delete(lookup);
    },
  };
}

type Person = { id: Identity; work: Work };
const person = async (name: string): Promise<Person> => {
  const id = { ...(await newIdentity(name)), listed: true };
  return { id, work: setIdentity(emptyWork(name), BIZ, id) };
};
const entry = (p: Person) => ({ name: p.id.name, publicKey: p.id.publicKey });

/** `me` reads what each of `from` sent them. */
async function readFrom(box: ReturnType<typeof fakeMailbox>, me: Person, from: Person[]) {
  for (const them of from) {
    const key = await pairKey(me.id, them.id.publicKey);
    const base = { businessKey: BIZ, name: them.id.name };
    await readThread({
      client: box,
      partiesKey: key,
      reader: mySide(me.id.publicKey, them.id.publicKey),
      thread: me.work.coworkers?.[them.id.publicKey],
      kinds: COWORKER_KINDS,
      accept: coworkerAccepts,
      store: async (item) => void (me.work = updateCoworker(me.work, them.id.publicKey, base, (t) => ({ ...t, ...addToThread(t, item) }))),
      skip: async (seq) => void (me.work = updateCoworker(me.work, them.id.publicKey, base, (t) => ({ ...t, ...skipIncoming(t, seq) }))),
    });
  }
}

describe("group chats through the mailbox", () => {
  it("reach every member privately, show who sent what, and shut out whoever is taken out", async () => {
    const box = fakeMailbox();
    const [ana, bo, cy] = await Promise.all([person("Ana"), person("Bo"), person("Cy")]);
    const groupId = newGroupId();
    const members = [entry(ana), entry(bo), entry(cy)];
    ana.work = keepSent(ana.work, BIZ, await fanOut(() => box, ana.work, ana.id, members, { type: "group", groupId, name: "Night crew", admin: ana.id.publicKey, members }));
    await readFrom(box, bo, [ana]);
    await readFrom(box, cy, [ana]);
    expect(groupsFor(bo.work, BIZ)).toMatchObject([{ id: groupId, name: "Night crew", joined: true, isAdmin: false }]);
    expect(groupsFor(ana.work, BIZ)[0]!.isAdmin).toBe(true);

    const sent = await fanOut(() => box, bo.work, bo.id, members, { type: "group_text", groupId, text: "Who's got the forklift key?" });
    expect(new Set(sent.sent.map((s) => s.item.id)).size).toBe(1); // one id for every copy
    bo.work = keepSent(bo.work, BIZ, sent);
    await readFrom(box, ana, [bo]);
    await readFrom(box, cy, [bo]);
    for (const p of [ana, cy]) {
      const g = groupsFor(p.work, BIZ)[0]!;
      expect(g.messages.map((m) => [m.text, m.from])).toEqual([["Who's got the forklift key?", bo.id.publicKey]]);
      expect(g.unread).toBe(1);
    }
    expect(groupsFor(bo.work, BIZ)[0]!.messages[0]!.mine).toBe(true);

    // Ana takes Cy out: everyone hears, Cy sees she's out, and gets nothing new.
    await new Promise((r) => setTimeout(r, 5)); // a later setup, by the clock
    const without = [entry(ana), entry(bo)];
    ana.work = keepSent(ana.work, BIZ, await fanOut(() => box, ana.work, ana.id, members, { type: "group", groupId, name: "Night crew", admin: ana.id.publicKey, members: without }));
    await readFrom(box, cy, [ana]);
    await readFrom(box, bo, [ana]);
    expect(groupsFor(cy.work, BIZ)[0]!.joined).toBe(false);
    const g = groupsFor(bo.work, BIZ)[0]!;
    bo.work = keepSent(bo.work, BIZ, await fanOut(() => box, bo.work, bo.id, g.members, { type: "group_text", groupId, text: "Found it" }));
    await readFrom(box, cy, [bo]);
    expect(groupsFor(cy.work, BIZ)[0]!.messages.map((m) => m.text)).toEqual(["Who's got the forklift key?"]);
  });

  it("ignores a setup from anyone but the admin", async () => {
    const box = fakeMailbox();
    const [ana, bo, cy] = await Promise.all([person("Ana"), person("Bo"), person("Cy")]);
    const groupId = newGroupId();
    const members = [entry(ana), entry(bo), entry(cy)];
    ana.work = keepSent(ana.work, BIZ, await fanOut(() => box, ana.work, ana.id, members, { type: "group", groupId, name: "Night crew", admin: ana.id.publicKey, members }));
    // Bo claims Ana set it up differently: renamed, Cy taken out.
    await fanOut(() => box, bo.work, bo.id, [entry(cy)], { type: "group", groupId, name: "Bo's crew", admin: ana.id.publicKey, members: [entry(ana), entry(bo)] });
    await readFrom(box, cy, [ana, bo]);
    expect(groupsFor(cy.work, BIZ)).toMatchObject([{ name: "Night crew", joined: true }]);
  });

  it("lets anyone leave, after which their messages stop showing", async () => {
    const box = fakeMailbox();
    const [ana, bo] = await Promise.all([person("Ana"), person("Bo")]);
    const groupId = newGroupId();
    const members = [entry(ana), entry(bo)];
    ana.work = keepSent(ana.work, BIZ, await fanOut(() => box, ana.work, ana.id, members, { type: "group", groupId, name: "Lunch", admin: ana.id.publicKey, members }));
    await readFrom(box, bo, [ana]);
    await new Promise((r) => setTimeout(r, 5));
    bo.work = keepSent(bo.work, BIZ, await fanOut(() => box, bo.work, bo.id, members, { type: "group_leave", groupId }));
    await readFrom(box, ana, [bo]);
    expect(groupsFor(ana.work, BIZ)[0]!.members.map((m) => m.name)).toEqual(["Ana"]);
    expect(groupsFor(bo.work, BIZ)[0]!.joined).toBe(false);
  });
});
