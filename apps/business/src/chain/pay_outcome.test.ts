import { describe, expect, it } from "vitest";
import { NOT_PAID, NOT_SEEN } from "@pnw/rail";
import { PAY_AGAIN_NOTE, payAgainTarget, unconfirmedLabel } from "./pay_outcome";

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
