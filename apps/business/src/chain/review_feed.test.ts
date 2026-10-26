import { describe, expect, it } from "vitest";
import { USDCX_PROGRAM } from "./balances";
import { type FeedDeps, afterStart, classify, findMovements, readTransfer } from "./review_feed";

const ME = "aleo1" + "m".repeat(58);
const DAO = "aleo1" + "d".repeat(58);
const BOSS = "aleo1" + "b".repeat(58);
const tx = (n: number) => `at1${String(n).padStart(58, "x")}`;
const START = { date: "2026-10-15", at: "2026-10-15T10:00:00.000Z" };
const T = (iso: string) => Math.floor(Date.parse(iso) / 1000); // Shield's block timestamps are seconds

const fee = (payer: string) => ({
  program: "credits.aleo",
  function: "fee_public",
  inputs: [{ type: "public", value: "51580u64" }],
  outputs: [{ type: "future", value: `{\n  program_id: credits.aleo,\n  function_name: fee_public,\n  arguments: [\n    ${payer},\n    51580u64\n  ]\n}` }],
});
const publicTransfer = (from: string, to: string, amount: string) => ({
  type: "execute",
  execution: {
    transitions: [
      {
        program: USDCX_PROGRAM,
        function: "transfer_public",
        inputs: [
          { type: "public", value: to },
          { type: "public", value: `${amount}u128` },
        ],
        outputs: [{ type: "future", value: `{ program_id: ${USDCX_PROGRAM}, function_name: transfer_public, arguments: [ ${from}, ${to}, ${amount}u128 ] }` }],
      },
    ],
  },
  fee: { transition: fee(from) },
});
const privateTransfer = {
  type: "execute",
  execution: {
    transitions: [
      {
        program: USDCX_PROGRAM,
        function: "transfer_private",
        inputs: [
          { type: "private", value: "ciphertext1aaa" },
          { type: "private", value: "ciphertext1bbb" },
          { type: "record", id: "1field" },
        ],
        outputs: [{ type: "record", value: "record1ccc" }],
      },
    ],
  },
  fee: { transition: fee(ME) },
};

function deps(over: { history?: unknown[]; records?: unknown[]; docs?: Record<string, unknown> } = {}): FeedDeps & { decrypted: string[] } {
  const decrypted: string[] = [];
  return {
    decrypted,
    wallet: {
      requestTransactionHistory: async () => ({ transactions: over.history ?? [] }),
      requestRecords: async () => over.records ?? [],
      transitionViewKeys: async (id) => (id === tx(4) ? ["9field"] : []),
    },
    fetchTransaction: async (id) => over.docs?.[id] ?? null,
    decrypt: async (t, tvk) => {
      decrypted.push(tvk);
      const opened = structuredClone(t) as { inputs: { type: string; value?: string }[] };
      opened.inputs = [
        { type: "private", value: `${DAO}.private` },
        { type: "private", value: "3000000u128.private" },
        { type: "record" },
      ];
      return opened;
    },
  };
}

const entry = (n: number, iso: string, status = "accepted") => ({ id: `w${n}`, transactionId: tx(n), blockTimestamp: T(iso), functionId: "transfer_public", transactionStatus: status });

describe("finding what moved in the account", () => {
  it("reads public payments both ways, with the amount and the other side", async () => {
    const r = await findMovements({
      me: ME,
      start: START,
      known: new Set(),
      deps: deps({
        history: [entry(1, "2026-10-16T09:00:00Z"), entry(2, "2026-10-16T10:00:00Z")],
        docs: { [tx(1)]: publicTransfer(ME, DAO, "4625000"), [tx(2)]: publicTransfer(BOSS, ME, "4250000") },
      }),
    });
    expect(r.unread).toBe(0);
    expect(r.items).toEqual([
      { id: tx(2), date: "2026-10-16", at: "2026-10-16T10:00:00.000Z", minor: "4250000", kind: "transfer_public", direction: "in", counterparty: BOSS, status: "new" },
      { id: tx(1), date: "2026-10-16", at: "2026-10-16T09:00:00.000Z", minor: "4625000", kind: "transfer_public", direction: "out", counterparty: DAO, status: "new" },
    ]);
  });

  it("opens a private payment it sent with Shield's view key", async () => {
    const d = deps({ history: [entry(4, "2026-10-16T11:00:00Z")], docs: { [tx(4)]: privateTransfer } });
    const r = await findMovements({ me: ME, start: START, known: new Set(), deps: d });
    expect(d.decrypted).toEqual(["9field"]);
    expect(r.items).toEqual([expect.objectContaining({ id: tx(4), direction: "out", minor: "3000000", counterparty: DAO, kind: "transfer_private" })]);
  });

  it("picks up a private payment received from its record, with Shield's sender", async () => {
    const r = await findMovements({
      me: ME,
      start: START,
      known: new Set(),
      deps: deps({
        records: [
          { recordName: "Token", transactionId: tx(5), blockTimestamp: T("2026-10-16T12:00:00Z"), sender: BOSS, functionName: "transfer_private", recordPlaintext: `{ owner: ${ME}.private, amount: 1500000u128.private }` },
          { recordName: "Credentials", transactionId: tx(6), blockTimestamp: T("2026-10-16T12:00:00Z") },
        ],
      }),
    });
    expect(r.items).toEqual([expect.objectContaining({ id: tx(5), direction: "in", minor: "1500000", counterparty: BOSS, status: "new" })]);
  });

  it("leaves out what's already listed, what came before the start, and transactions that failed", async () => {
    const r = await findMovements({
      me: ME,
      start: START,
      known: new Set([tx(1)]),
      deps: deps({
        history: [entry(1, "2026-10-16T09:00:00Z"), entry(2, "2026-10-15T09:59:00Z"), entry(3, "2026-10-16T09:00:00Z", "rejected")],
        docs: { [tx(1)]: publicTransfer(ME, DAO, "1"), [tx(2)]: publicTransfer(ME, DAO, "1"), [tx(3)]: publicTransfer(ME, DAO, "1") },
      }),
    });
    expect(r.items).toEqual([]);
  });

  it("takes every movement when the books weren't started from the Shield balance (Joshua, 2026-10-26)", async () => {
    const r = await findMovements({
      me: ME,
      start: null,
      known: new Set(),
      deps: deps({ history: [entry(2, "2026-10-15T09:59:00Z")], docs: { [tx(2)]: publicTransfer(ME, DAO, "1") } }),
    });
    expect(r.items.map((i) => i.id)).toEqual([tx(2)]);
  });

  it("takes a private payment received from its record when Shield's history lists it too but can't open it (Joshua's test, 2026-10-26)", async () => {
    const received = { ...privateTransfer, fee: { transition: fee(BOSS) } };
    const r = await findMovements({
      me: ME,
      start: START,
      known: new Set(),
      deps: deps({
        history: [{ ...entry(8, "2026-10-16T12:00:00Z"), functionId: "transfer_private" }],
        docs: { [tx(8)]: received },
        records: [{ recordName: "Token", transactionId: tx(8), blockTimestamp: T("2026-10-16T12:00:00Z"), sender: BOSS, functionName: "transfer_private", recordPlaintext: `{ owner: ${ME}.private, amount: 5750000u128.private }` }],
      }),
    });
    expect(r.unread).toBe(0);
    expect(r.items).toEqual([expect.objectContaining({ id: tx(8), direction: "in", minor: "5750000", counterparty: BOSS, status: "new" })]);
  });

  it("opens the record a private payment made for this account with Shield when the record list doesn't have it", async () => {
    const d = deps({ history: [{ ...entry(9, "2026-10-16T12:00:00Z"), functionId: "transfer_private" }], docs: { [tx(9)]: privateTransfer } });
    const opened: string[] = [];
    d.wallet.decryptRecord = async (c) => {
      opened.push(c);
      if (c !== "record1ccc") throw new Error("not yours");
      return `{\n  owner: ${ME}.private,\n  amount: 5750000u128.private,\n  _nonce: 1group.public\n}`;
    };
    const r = await findMovements({ me: ME, start: START, known: new Set(), deps: d });
    expect(opened).toEqual(["record1ccc"]);
    expect(r).toMatchObject({ items: [expect.objectContaining({ id: tx(9), direction: "in", minor: "5750000", status: "new" })], unread: 0, why: [] });
    // Someone else's record: still unread, never guessed.
    d.wallet.decryptRecord = async () => `{ owner: ${DAO}.private, amount: 5750000u128.private }`;
    const notMine = await findMovements({ me: ME, start: START, known: new Set(), deps: d });
    expect(notMine).toMatchObject({ items: [], unread: 1 });
    expect(notMine.why).toEqual([{ id: tx(9), why: "Shield has no view key for it (someone else sent it); Shield's decrypt on its 1 records: someone else's; not in Shield's record list" }]);
    d.wallet.decryptRecord = async () => {
      throw new Error("Decrypt not supported");
    };
    expect((await findMovements({ me: ME, start: START, known: new Set(), deps: d })).why![0]!.why).toMatch(/refused \(Decrypt not supported\)/);
  });

  it("counts a transaction it can't read yet and tries it again next time", async () => {
    const r = await findMovements({ me: ME, start: START, known: new Set(), deps: deps({ history: [entry(7, "2026-10-16T09:00:00Z")] }) });
    expect(r).toMatchObject({ items: [], unread: 1, why: [{ id: tx(7), why: "the explorer doesn't have it yet; not in Shield's record list" }] });
  });

  it("sends a move between the account's public and private halves to review, marked as one (Joshua, 2026-10-26)", () => {
    const when = new Date("2026-10-16T09:00:00Z");
    expect(classify({ me: ME, id: tx(8), when, fn: "transfer_public_to_private", to: ME, from: ME, minor: 4_750_000n })).toMatchObject({ status: "new", within: true });
    expect(classify({ me: ME, id: tx(8), when, fn: "transfer_private", to: ME, from: ME, minor: 1n })).toMatchObject({ status: "new", within: true });
    expect(classify({ me: ME, id: tx(8), when, fn: "transfer_private", to: ME, from: BOSS, minor: 1n })).not.toHaveProperty("within");
    expect(classify({ me: ME, id: tx(8), when, fn: "mint_public", to: ME, from: null, minor: 5n })).toMatchObject({ direction: "in", status: "new" });
    expect(classify({ me: ME, id: tx(8), when, fn: "transfer_public", to: DAO, from: ME, minor: 0n })).toBeNull();
  });

  it("reads a transfer's recipient, amount and sender from public values and the fee", () => {
    const t = publicTransfer(BOSS, ME, "42").execution.transitions[0]!;
    expect(readTransfer(t, fee(BOSS))).toEqual({ fn: "transfer_public", to: ME, minor: 42n, from: BOSS });
    expect(readTransfer({ ...t, outputs: [] }, fee(BOSS)).from).toBe(BOSS);
    expect(readTransfer(privateTransfer.execution.transitions[0]!, null)).toEqual({ fn: "transfer_private", to: null, minor: null, from: null });
  });

  it("counts from the start's exact time, or from the next day for a start without one", () => {
    expect(afterStart(new Date("2026-10-15T10:00:01Z"), START)).toBe(true);
    expect(afterStart(new Date("2026-10-15T09:59:59Z"), START)).toBe(false);
    expect(afterStart(new Date("2026-10-15T23:00:00Z"), { date: "2026-10-15" })).toBe(false);
    expect(afterStart(new Date("2026-10-16T00:00:01Z"), { date: "2026-10-15" })).toBe(true);
  });
});
