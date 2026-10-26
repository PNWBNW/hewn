import { describe, expect, it } from "vitest";
import { transactionUrl } from "./TxLink";

const TX = "at1" + "q".repeat(58);

describe("a transaction's explorer link", () => {
  it("links a network id on its network, and nothing else", () => {
    expect(transactionUrl(TX)).toBe(`https://testnet.explorer.provable.com/transaction/${TX}`);
    expect(transactionUrl(TX, "mainnet")).toBe(`https://explorer.provable.com/transaction/${TX}`);
    expect(transactionUrl("shield-wallet-id-123")).toBeNull();
    expect(transactionUrl(`${TX}/../x`)).toBeNull();
  });
});
