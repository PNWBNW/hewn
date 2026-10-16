import { describe, expect, it } from "vitest";
import { emptyPayroll, type Payroll } from "@pnw/payroll";
import { addHours, emptyMailbox } from "./mailbox";
import { buildFeed, hasWaitingOffer } from "./mailbox_feed";
import type { Rail, RailLink } from "./rail";

const ADDRESS = "aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n";
const link = (over: Partial<RailLink>): RailLink => ({ workerId: "wkr-1", address: ADDRESS, nameHash: "7", agreementId: "ab".repeat(32), partiesKey: "11".repeat(32), status: "linked", ...over });
const rail = (...links: RailLink[]): Rail => ({ version: 1, network: "testnet", address: ADDRESS, linkedAt: "2026-10-01T00:00:00.000Z", links });

const payroll = (over: Partial<Payroll> = {}): Payroll => ({
  ...emptyPayroll(),
  workers: [{ id: "wkr-1", name: "Ana Ruiz" }, { id: "wkr-2", name: "Bo Lind" }] as Payroll["workers"],
  ...over,
});

const ENTRY = { date: "2026-10-05", in: "2026-10-05T15:00:00.000Z", out: "2026-10-05T23:30:00.000Z", minutes: 510 };
const hours = (seq: number, receivedAt: string) => ({
  agreementId: "ab".repeat(32),
  seq,
  lookup: "cd".repeat(32),
  receivedAt,
  workerId: "wkr-1",
  weekStart: "2026-10-05",
  entries: [ENTRY],
  totalMinutes: 510,
  sentAt: receivedAt,
});

describe("the mailbox feed", () => {
  it("is empty with nothing on the rail", () => {
    expect(buildFeed({ rail: null, payroll: payroll(), mailbox: null })).toEqual([]);
  });

  it("lists offers, acceptances, paystubs and hours together, newest first", () => {
    const runs = [
      {
        id: "run-1",
        payDate: "2026-10-09",
        paychecks: [
          { workerId: "wkr-1", delivery: { seq: 0, lookup: "ee".repeat(32), sentAt: "2026-10-09T12:00:00.000Z" } },
          { workerId: "wkr-2" }, // never delivered: not in the feed
        ],
      },
    ] as unknown as Payroll["runs"];
    const feed = buildFeed({
      rail: rail(
        link({ workerId: "wkr-2", agreementId: "ff".repeat(32), status: "offered", offeredAt: "2026-10-02T08:00:00.000Z" }),
        link({ linkedAt: "2026-10-03T08:00:00.000Z" }),
      ),
      payroll: payroll({ runs }),
      mailbox: addHours(emptyMailbox(), hours(0, "2026-10-12T09:00:00.000Z")),
    });
    expect(feed.map((i) => [i.kind, i.workerName])).toEqual([
      ["hours", "Ana Ruiz"],
      ["paystub", "Ana Ruiz"],
      ["accepted", "Ana Ruiz"],
      ["offer", "Bo Lind"],
    ]);
    expect(feed[1]).toMatchObject({ kind: "paystub", payDate: "2026-10-09", runId: "run-1" });
  });

  it("carries what the receipts said, and an offer's expiry", () => {
    const terms = {
      version: 2 as const,
      kind: "terms" as const,
      agreementId: "ef".repeat(32),
      termsText: "Carpenter.",
      payType: "hourly" as const,
      rate: "3000",
      frequency: "biweekly" as const,
      startDate: "2026-11-02",
      businessName: "Day Construction",
      offeredAt: "2026-10-02T08:00:00.000Z",
      expiresAt: "2026-10-09T08:00:00.000Z",
      letter: { description: "", requirements: "", handbook: "", other: "" },
      files: [],
    };
    const runs = [
      { id: "run-1", payDate: "2026-10-09", paychecks: [{ workerId: "wkr-1", delivery: { seq: 0, lookup: "ee".repeat(32), sentAt: "2026-10-09T12:00:00.000Z", receivedAt: "2026-10-10T07:00:00.000Z" } }] },
    ] as unknown as Payroll["runs"];
    const feed = buildFeed({
      rail: rail(link({ workerId: "wkr-2", agreementId: "ff".repeat(32), status: "offered", offeredAt: terms.offeredAt, terms, offerReceivedAt: "2026-10-03T08:00:00.000Z" }), link({})),
      payroll: payroll({ runs }),
      mailbox: null,
    });
    expect(feed.find((i) => i.kind === "offer")).toMatchObject({ receivedAt: "2026-10-03T08:00:00.000Z", expiresAt: terms.expiresAt });
    expect(feed.find((i) => i.kind === "paystub")).toMatchObject({ receivedAt: "2026-10-10T07:00:00.000Z" });
  });

  it("lists the conversation with each person, by when each message was sent", () => {
    const item = { version: 1 as const, id: "3".repeat(32), from: "worker" as const, sentAt: "2026-10-04T08:00:00.000Z", body: { type: "stands" as const, agreementId: "ab".repeat(32), note: "" }, mine: false, seq: 0 };
    const mailbox = { ...emptyMailbox(), threads: { ["11".repeat(32)]: { items: [item], nextIn: 1, nextOut: 0, workerId: "wkr-2" } } };
    const feed = buildFeed({ rail: rail(link({ linkedAt: "2026-10-03T08:00:00.000Z" })), payroll: payroll(), mailbox });
    expect(feed[0]).toMatchObject({ kind: "thread", workerName: "Bo Lind", partiesKey: "11".repeat(32), at: item.sentAt, item });
  });

  it("leaves out offers and links it has no date for, and names a team member who's gone", () => {
    const feed = buildFeed({
      rail: rail(link({ status: "offered" }), link({ workerId: "wkr-9", agreementId: "99".repeat(32) })),
      payroll: payroll(),
      mailbox: addHours(emptyMailbox(), { ...hours(0, "2026-10-12T09:00:00.000Z"), workerId: "wkr-9" }),
    });
    expect(feed.map((i) => i.kind)).toEqual(["hours"]);
    expect(feed[0]?.workerName).toBe("A team member");
  });

  it("orders ties the same way every time", () => {
    const m = addHours(addHours(emptyMailbox(), hours(1, "2026-10-12T09:00:00.000Z")), hours(0, "2026-10-12T09:00:00.000Z"));
    expect(buildFeed({ rail: null, payroll: payroll(), mailbox: m }).map((i) => i.key)).toEqual([`hours:${"ab".repeat(32)}:0`, `hours:${"ab".repeat(32)}:1`]);
  });

  it("knows when an offer is still waiting", () => {
    expect(hasWaitingOffer(null)).toBe(false);
    expect(hasWaitingOffer(rail(link({})))).toBe(false);
    expect(hasWaitingOffer(rail(link({ status: "offered" })))).toBe(true);
  });
});
