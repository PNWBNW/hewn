process.env.TZ = "America/Los_Angeles";

import { MailboxError, lookupId, open, partiesKeyFromHex } from "@pnw/mailbox";
import { describe, expect, it } from "vitest";
import { type Work, emptyWork, punch, recordTimesheet, upsertAgreement } from "../../books/work";
import { unpackPayload } from "../compress";
import { LETTER_BYTES } from "../letters";
import { TIMESHEET_KIND, sendTimesheet } from "./timesheet";

const AID = "01".repeat(32);
const KEY_HEX = "ab".repeat(32);
const key = partiesKeyFromHex(KEY_HEX);
const local = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00`).toISOString();

function weekOfWork(): Work {
  let w = upsertAgreement(emptyWork("Ana"), { agreementId: AID, partiesKey: KEY_HEX, employerAddress: "aleo1" + "k".repeat(58), employerNameHash: "1", status: "active" });
  w = punch(w, AID, local("2026-10-13", "08:00"), "a").work;
  w = punch(w, AID, local("2026-10-13", "16:30"), "b").work;
  return w;
}

function fakeClient(status?: MailboxError) {
  const puts: { lookup: string; envelope: Uint8Array }[] = [];
  return {
    puts,
    client: {
      async put(lookup: string, envelope: Uint8Array) {
        puts.push({ lookup, envelope });
        if (status) throw status;
      },
    },
  };
}

const now = () => new Date(local("2026-10-17", "18:00"));

describe("sendTimesheet", () => {
  it("seals the week under the timesheet kind at the next slot, and only the employer's key opens it", async () => {
    const { client, puts } = fakeClient();
    const { sent, payload, slotTaken } = await sendTimesheet({ work: weekOfWork(), agreementId: AID, weekStart: "2026-10-11", client, now });
    expect(slotTaken).toBe(false);
    expect(puts).toHaveLength(1);
    expect(puts[0]!.lookup).toBe(lookupId(key, TIMESHEET_KIND, 0));
    expect(puts[0]!.envelope[0]).toBe(0x01);
    expect(sent).toEqual({ agreementId: AID, weekStart: "2026-10-11", seq: 0, lookup: puts[0]!.lookup, totalMinutes: 510, sentAt: now().toISOString() });
    expect(puts[0]!.envelope.length).toBeLessThanOrEqual(LETTER_BYTES); // one letter, not a page
    const opened = JSON.parse(new TextDecoder().decode(await unpackPayload(await open(key, TIMESHEET_KIND, 0, puts[0]!.envelope))));
    expect(opened).toEqual(payload);
    expect(opened).toMatchObject({ version: 1, kind: "timesheet", agreementId: AID, weekStart: "2026-10-11", totalMinutes: 510 });
    await expect(open(partiesKeyFromHex("cd".repeat(32)), TIMESHEET_KIND, 0, puts[0]!.envelope)).rejects.toThrow();
    const wire = new TextDecoder("utf-8", { fatal: false }).decode(puts[0]!.envelope);
    expect(wire).not.toMatch(/2026-10-13|timesheet|510/);
  });

  it("takes the slot after the last one sent", async () => {
    const w = recordTimesheet(weekOfWork(), { agreementId: AID, weekStart: "2026-10-05", seq: 3, lookup: "e".repeat(64), totalMinutes: 1, sentAt: "2026-10-10T00:00:00.000Z" });
    const { client, puts } = fakeClient();
    const { sent } = await sendTimesheet({ work: w, agreementId: AID, weekStart: "2026-10-11", client, now });
    expect(sent.seq).toBe(4);
    expect(puts[0]!.lookup).toBe(lookupId(key, TIMESHEET_KIND, 4));
  });

  it("counts a taken slot as sent, and passes other failures on", async () => {
    const taken = await sendTimesheet({ work: weekOfWork(), agreementId: AID, weekStart: "2026-10-11", client: fakeClient(new MailboxError("CONFLICT", "taken")).client, now });
    expect(taken.slotTaken).toBe(true);
    const off = sendTimesheet({ work: weekOfWork(), agreementId: AID, weekStart: "2026-10-11", client: fakeClient(new MailboxError("NOT_CONFIGURED", "off")).client, now });
    await expect(off).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    await expect(sendTimesheet({ work: weekOfWork(), agreementId: AID, weekStart: "2026-10-11", client: fakeClient(new MailboxError("REQUEST_FAILED", "502")).client, now })).rejects.toThrow(/502/);
  });

  it("refuses before any request when there is nothing to send or the agreement isn't active", async () => {
    const { client, puts } = fakeClient();
    await expect(sendTimesheet({ work: weekOfWork(), agreementId: AID, weekStart: "2026-10-18", client, now })).rejects.toThrow(/Nothing to send/);
    const paused = upsertAgreement(weekOfWork(), { agreementId: AID, partiesKey: KEY_HEX, employerAddress: "aleo1" + "k".repeat(58), employerNameHash: "1", status: "paused" });
    await expect(sendTimesheet({ work: paused, agreementId: AID, weekStart: "2026-10-11", client, now })).rejects.toThrow(/isn't active/);
    await expect(sendTimesheet({ work: weekOfWork(), agreementId: "ff", weekStart: "2026-10-11", client, now })).rejects.toThrow(/No agreement/);
    expect(puts).toEqual([]);
  });
});
