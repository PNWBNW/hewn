import { describe, expect, it } from "vitest";
import type { Paycheck, PayRun, Settlement } from "@pnw/payroll";
import { NOT_PAID, NOT_SEEN, centsToMinor } from "@pnw/rail";
import { PAY_AGAIN_NOTE, claimedTransfers, payAgainTarget, rivalPayments, unconfirmedLabel } from "./pay_outcome";

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
});
