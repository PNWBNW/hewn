import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Paycheck, PayRun, Settlement } from "@pnw/payroll";
import { NOT_ASKED, NOT_LISTED, NOT_PAID, NOT_SEEN, type RailWallet, centsToMinor, recordTag } from "@pnw/rail";
import {
  PAY_AGAIN_NOTE,
  claimedTransfers,
  lookQuery,
  payAgainTarget,
  recordListedForPayAgain,
  rivalPayments,
  shortOnRail,
  stagesAfterPress,
  unconfirmedLabel,
} from "./pay_outcome";

describe("how an unconfirmed payment reads", () => {
  it("says Not confirmed, unless the queue knows it is not seen on chain yet or not paid; never Not sent", () => {
    expect(unconfirmedLabel("Shield reported a problem (failed); the payment may still go through.")).toBe("Not confirmed · Shield reported a problem (failed); the payment may still go through.");
    expect(unconfirmedLabel("No answer from Shield in time; it may still go through.")).toMatch(/^Not confirmed · /);
    expect(unconfirmedLabel(`${NOT_SEEN}: the record this payment spends is still unspent.`)).toBe("Not seen on chain yet: the record this payment spends is still unspent.");
    expect(unconfirmedLabel(`${NOT_PAID}: the record set aside for this payment went into something else.`)).toMatch(/^Not paid: /);
    for (const failure of ["anything", `${NOT_SEEN}: x`, `${NOT_PAID}: x`]) expect(unconfirmedLabel(failure)).not.toMatch(/not sent/i);
  });
});

describe("pay again", () => {
  const tag = "ab".repeat(16);

  it("keeps the record's tag while that record is still listed, so the next try spends the same record", () => {
    expect(payAgainTarget({ attempt: tag, since: 4_210_000 }, true)).toEqual({ status: "failed", failure: PAY_AGAIN_NOTE, attempt: tag, since: 4_210_000 });
  });

  it("takes a fresh record only once the old one is gone, and still keeps the height it was first asked at", () => {
    expect(payAgainTarget({ attempt: tag, since: 4_210_000 }, false)).toEqual({ status: "failed", failure: PAY_AGAIN_NOTE, since: 4_210_000 });
    expect(payAgainTarget({ attempt: tag }, false)).toEqual({ status: "failed", failure: PAY_AGAIN_NOTE });
  });

  it("has nothing to keep for a payment that never set a record aside", () => {
    expect(payAgainTarget({}, true)).toEqual({ status: "failed", failure: PAY_AGAIN_NOTE });
    expect(payAgainTarget(undefined, true)).toEqual({ status: "failed", failure: PAY_AGAIN_NOTE });
  });

  it("asks Shield whether the record is still listed, and takes no answer in time, or an error, as listed", async () => {
    const plaintext = `{\n  owner: aleo1${"m".repeat(58)}.private,\n  amount: 25000000u128.private,\n  _nonce: 7group.public\n}`;
    const attempt = await recordTag(plaintext);
    const wallet = (requestRecords: RailWallet["requestRecords"]) => ({ requestRecords }) as unknown as RailWallet;
    const listing = (spent: boolean) => wallet(async () => [{ recordName: "Token", spent, recordPlaintext: plaintext }]);
    expect(await recordListedForPayAgain(listing(false), attempt, 50)).toBe(true);
    expect(await recordListedForPayAgain(listing(true), attempt, 50)).toBe(false);
    expect(await recordListedForPayAgain(wallet(async () => []), attempt, 50)).toBe(false);
    // Over the relay Shield answers only once its app is open: the record is kept rather than waited on.
    const started = Date.now();
    expect(await recordListedForPayAgain(wallet(() => new Promise(() => {})), attempt, 30)).toBe(true);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(await recordListedForPayAgain(wallet(async () => Promise.reject(new Error("Shield is busy"))), attempt, 50)).toBe(true);
  });
});

describe("what the pay panel shows once a press ends part-way", () => {
  const DUE = centsToMinor(2_00n);

  it("calls the rail short of funds, and holds Continue back, only when the balance read is all there is", () => {
    expect(shortOnRail(0n, DUE, null)).toBe(true);
    expect(shortOnRail(centsToMinor(1_99n), DUE, NOT_ASKED)).toBe(true);
    expect(shortOnRail(DUE, DUE, null)).toBe(false);
    expect(shortOnRail(null, DUE, null)).toBe(false); // not read yet
    // The run stopped because what its last payment left isn't listed yet: the balance read then is missing it.
    expect(shortOnRail(0n, DUE, NOT_LISTED)).toBe(false);
  });

  it("gives a line the run never reached back to the books, and keeps what this press said of the rest", () => {
    const stages = {
      w1: { kind: "settled", transactionId: "at1x" },
      w2: { kind: "unconfirmed", failure: "Shield reported a problem (User rejected the request)" },
      w3: { kind: "waiting" },
      w4: { kind: "waiting" },
    };
    expect(stagesAfterPress(stages)).toEqual({ w1: stages.w1, w2: stages.w2 });
    expect(stagesAfterPress({})).toEqual({});
  });

  it("is what the pay panel goes by", () => {
    const panel = readFileSync(new URL("./PayPanel.tsx", import.meta.url), "utf8");
    expect(panel).toMatch(/const short = shortOnRail\(balance, centsToMinor\(totalDue\), stopped\);/);
    expect(panel).toMatch(/setStopped\(stalledWhy\)/);
    expect(panel).toMatch(/setStages\(\(all\) => stagesAfterPress\(all\)\)/);
  });
});

describe("what the books tell a look for an unconfirmed payment", () => {
  const ANA = "aleo1" + "a".repeat(58);
  const BEN = "aleo1" + "b".repeat(58);
  const tx = (n: number) => `at1${String(n).padStart(58, "x")}`;
  const tag = (c: string) => c.repeat(32);
  const check = (workerId: string, net: bigint, settlement: Settlement = { status: "pending" }) => ({ workerId, net, settlement }) as Paycheck;
  const run = (id: string, paychecks: Paycheck[], mode: PayRun["mode"] = "rail") => ({ id, mode, paychecks });
  const links = new Map([
    ["ana", ANA],
    ["ben", BEN],
    ["ana-again", ANA],
  ]);
  const NET = 17_00n;
  const asking = { to: ANA, minor: centsToMinor(NET), attempt: tag("a") };
  const self = { runId: "run-a", workerId: "ana" };
  const mine = check("ana", NET, { status: "pending", failure: "No answer from Shield in time", attempt: tag("a"), since: 4_000_000 });

  it("claims every settled paycheck's transfer, in any run, and nothing else", () => {
    const runs = [
      run("run-a", [check("ana", NET, { status: "settled", reference: tx(1).toUpperCase() }), check("ben", NET, { status: "pending", reference: "shield-request-7" })]),
      run("run-b", [check("ana", NET, { status: "settled", reference: tx(2) }), check("ben", NET, { status: "failed", reference: tx(3) })]),
      run("paid-by-bank", [check("ana", NET, { status: "settled", reference: "batch 42" })], "external"),
    ];
    expect(claimedTransfers(runs)).toEqual(new Set([tx(1), tx(2)]));
  });

  it("is contested by another run's open paycheck to the same person for the same amount, once Shield was asked for it", () => {
    for (const theirs of [
      { status: "pending", attempt: tag("b") },
      { status: "pending", reference: "shield-request-7" },
      { status: "pending", failure: "Shield reported a problem (failed)", since: 4_000_100 },
      { status: "failed", failure: "Approval expired" },
      { status: "failed", failure: PAY_AGAIN_NOTE },
    ] satisfies Settlement[]) {
      expect(rivalPayments([run("run-a", [mine]), run("run-b", [check("ana", NET, theirs)])], links, self, asking)).toEqual({ contested: true, sameRecord: false });
    }
    // The same account under another payee id counts too: the look knows a transfer by account and amount.
    expect(rivalPayments([run("run-a", [mine]), run("run-b", [check("ana-again", NET, { status: "pending", attempt: tag("b") })])], links, self, asking).contested).toBe(true);
  });

  it("is not contested by itself, a settled paycheck, another amount or person, a run paid outside the app, or one Shield was never asked for", () => {
    for (const other of [
      run("run-b", [check("ana", NET, { status: "settled", reference: tx(2) })]),
      run("run-b", [check("ana", NET + 1n, { status: "pending", attempt: tag("b") })]),
      run("run-b", [check("ben", NET, { status: "pending", attempt: tag("b") })]),
      run("run-b", [check("nobody", NET, { status: "pending", attempt: tag("b") })]),
      run("run-b", [check("ana", NET, { status: "pending", attempt: tag("b") })], "external"),
      run("run-b", [check("ana", NET)]), // posted, not yet paid: it can't have a transfer
      run("run-b", [check("ana", 0n, { status: "pending", attempt: tag("b") })]),
    ]) {
      expect(rivalPayments([run("run-a", [mine]), other], links, self, asking)).toEqual({ contested: false, sameRecord: false });
    }
    expect(rivalPayments([run("run-a", [mine])], links, self, asking)).toEqual({ contested: false, sameRecord: false });
  });

  it("is contested by a line paid alongside it in the same run, asked yet or not", () => {
    expect(rivalPayments([run("run-a", [mine, check("ana-again", NET)])], links, self, asking)).toEqual({ contested: true, sameRecord: false });
    expect(rivalPayments([run("run-a", [mine, check("ana-again", NET, { status: "settled", reference: tx(1) })])], links, self, asking).contested).toBe(false);
  });

  it("says when a contesting payment set aside the very same record, and only then", () => {
    const sameTag = run("run-b", [check("ana", NET, { status: "pending", attempt: tag("a") })]);
    expect(rivalPayments([run("run-a", [mine]), sameTag], links, self, asking)).toEqual({ contested: true, sameRecord: true });
    // The same record under a payment to someone else, or for another amount, isn't this payment's rival.
    expect(rivalPayments([run("run-a", [mine]), run("run-b", [check("ben", NET, { status: "pending", attempt: tag("a") })])], links, self, asking)).toEqual({ contested: false, sameRecord: false });
    // A look that has no record to go by shares none.
    expect(rivalPayments([run("run-a", [mine]), sameTag], links, self, { to: ANA, minor: centsToMinor(NET) })).toEqual({ contested: true, sameRecord: false });
  });
  it("tells the look what the books say: transfers already settled, a rival paycheck, and the record only when no rival set aside the same one", () => {
    const q = { workerId: "ana", to: ANA, minor: centsToMinor(NET), attempt: tag("a"), ids: [tx(9)], since: 4_000_000 };
    const settled = run("run-c", [check("ben", NET, { status: "settled", reference: tx(3) })]);
    // Alone: the record and the floor are passed on, nothing contests it, and settled transfers are claimed.
    expect(lookQuery([run("run-a", [mine]), settled], links, "run-a", q)).toEqual({
      to: ANA,
      minor: centsToMinor(NET),
      ids: [tx(9)],
      claimed: new Set([tx(3)]),
      contested: false,
      attempt: tag("a"),
      since: 4_000_000,
    });
    // Another run's open paycheck to the same person for the same amount, with its own record: contested, record kept.
    const rival = run("run-b", [check("ana", NET, { status: "pending", attempt: tag("b") })]);
    expect(lookQuery([run("run-a", [mine]), rival], links, "run-a", q)).toMatchObject({ contested: true, attempt: tag("a") });
    // One that set aside the very same record: contested, and the look gets no record to go by.
    const sameRecord = run("run-b", [check("ana", NET, { status: "pending", attempt: tag("a") })]);
    const told = lookQuery([run("run-a", [mine]), sameRecord], links, "run-a", q);
    expect(told.contested).toBe(true);
    expect(told).not.toHaveProperty("attempt");
    // No floor and no record: none is made up.
    expect(lookQuery([run("run-a", [mine])], links, "run-a", { workerId: "ana", to: ANA, minor: centsToMinor(NET), ids: [] })).toEqual({
      to: ANA,
      minor: centsToMinor(NET),
      ids: [],
      claimed: new Set(),
      contested: false,
    });
  });
});
