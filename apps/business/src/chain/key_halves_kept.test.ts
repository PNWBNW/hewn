// The other places a public key from someone else is taken in: a FinalAgreement's half on the
// business's team screen, a coworker's key when invitations are read, a hello, an application.
// Each is a point on the curve before it is used or kept, and one that isn't touches only its own
// conversation (books/key_point.ts).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type Thread, emptyThread } from "../books/thread";
import { type Work, emptyWork } from "../books/work";
import { acceptedHalves } from "./agreement_programs";
import { applicantKey, businessKey, newHiringKey } from "./applications";
import { readHellos } from "./clients";
import { newIdentity } from "./coworkers";
import { workListening } from "./events";
import { newHalf } from "./key_ring";
import type { LetterRecord } from "./letters";

/** The same x with y moved by one: a public key's shape, but not a point on the curve. */
const offCurve = (key: string): string => key.slice(0, -2) + ((parseInt(key.slice(-2), 16) + 1) & 0xff).toString(16).padStart(2, "0");
const BIZ = `aleo1${"q".repeat(58)}`;
const ANA = `aleo1${"p".repeat(58)}`;
const BO = `aleo1${"z".repeat(58)}`;
const BUSINESS = "ab".repeat(32);
const AT = "2026-10-23T12:00:00.000Z";

describe("an accepted offer's half", () => {
  it("seeds a conversation only when it is a point on the curve", async () => {
    const good = (await newHalf()).publicKey;
    const accepted = new Map<string, { workerHalf?: string }>([
      ["a", { workerHalf: good }],
      ["b", { workerHalf: offCurve((await newHalf()).publicKey) }],
      ["c", {}],
    ]);
    expect(await acceptedHalves(accepted)).toEqual(new Map([["a", good]]));
  });

  it("is taken from there wherever accepted offers are linked", () => {
    for (const file of ["acceptance.ts", "RailPanel.tsx"]) {
      const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
      expect(source, file).toContain("acceptOffers(");
      expect(source, file).toContain("await acceptedHalves(");
      expect(source, file).not.toMatch(/\.workerHalf\s*\?/);
    }
  });
});

describe("invitations from coworkers", () => {
  it("are still listened for from the rest when one coworker's kept key can't make a pair", async () => {
    const me = await newIdentity("Me");
    const ana = (await newIdentity("Ana")).publicKey;
    const bo = offCurve((await newIdentity("Bo")).publicKey);
    const keyItem = (circleId: string) => ({ version: 1 as const, id: circleId, from: "worker" as const, sentAt: AT, body: { type: "event_key" as const, circleId, epoch: 1, key: "cd".repeat(32) }, mine: false, seq: 0, receivedAt: AT });
    const coworker = (name: string, circleId: string) => ({ ...emptyThread(), items: [keyItem(circleId)], businessKey: BUSINESS, name }) as Thread & { businessKey: string; name: string };
    const directory: Thread = {
      ...emptyThread(),
      items: [
        {
          version: 1,
          id: "d".repeat(32),
          from: "business",
          sentAt: AT,
          body: {
            type: "directory",
            entries: [
              { name: "Ana", publicKey: ana, address: ANA },
              { name: "Bo", publicKey: bo, address: BO },
            ],
          },
          mine: false,
          seq: 0,
          receivedAt: AT,
        },
      ],
    };
    const work: Work = {
      ...emptyWork("Me"),
      threads: { [BUSINESS]: directory },
      identities: { [BUSINESS]: { ...me, listed: true } },
      // Bo's comes first, so the one that can't be used is met before the one that can.
      coworkers: { [bo]: coworker("Bo", "2".repeat(32)), [ana]: coworker("Ana", "1".repeat(32)) },
    };
    const listening = await workListening(work);
    expect(listening.map((l) => l.organizer)).toEqual([ANA]);
  });
});

describe("a hello", () => {
  it("whose key isn't a point on the curve is left out, and an earlier one from that sender stands", async () => {
    const good = (await newHalf()).publicKey;
    const hello = (publicKey: string) => new TextEncoder().encode(JSON.stringify({ v: 1, type: "hello", side: "customer", name: "rowan", nameHash: "42", publicKey }));
    const places = [
      [{ sender: ANA, envelope: hello(good) }],
      [
        { sender: ANA, envelope: hello(offCurve(good)) },
        { sender: BO, envelope: hello(offCurve(good)) },
      ],
    ] as unknown as LetterRecord[][];
    let n = 0;
    const found = await readHellos(async () => places[n++] ?? [], BIZ);
    expect(found).toEqual([{ sender: ANA, hello: expect.objectContaining({ publicKey: good }) }]);
  });
});

describe("an application's keys", () => {
  it("are refused, as an application's own error, when they aren't points on the curve", async () => {
    const hiring = await newHiringKey();
    await expect(applicantKey(offCurve(hiring.publicKey), "42")).rejects.toThrow(/posting's hiring key isn't a valid key/);
    const { oneTimePublicKey } = await applicantKey(hiring.publicKey, "42");
    await expect(businessKey(hiring, offCurve(oneTimePublicKey), "42")).rejects.toThrow(/applicant's key isn't a valid key/);
  });
});
