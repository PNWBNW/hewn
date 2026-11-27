// The period proofs the native verifier's Rust tests check (verify/tests/fixtures/), made by
// @pnw/ledger's own code (hashEntry, periodRoot, buildPeriodProof). The test fails when the
// committed files differ from what the ledger makes today, so the Rust port is held to the
// JavaScript byte for byte, on entries that use every field the hash reads: a memo with quotes, a
// line break, a control character and characters outside ASCII, a document hash (the second
// layout), names, tags, a reversal, a gap in the sequence, two payments and a previous root.
// Made-up books: no real business, wage or account.
//
//   pnpm vitest run --project native                         # check
//   HEWN_WRITE_FIXTURES=1 pnpm vitest run --project native   # rewrite them
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GENESIS_HASH, hashEntry } from "../../../packages/ledger/src/hash";
import { buildPeriodProof, periodProofToJson } from "../../../packages/ledger/src/period_proof";
import { periodRoot } from "../../../packages/ledger/src/period_root";
import type { Entry } from "../../../packages/ledger/src/books";

const OUT = join(__dirname, "..", "verify", "tests", "fixtures");
const SECRET = new Uint8Array(32).fill(7); // a fixed test secret, as the ledger's own tests use
const ACCOUNTS = [
  { id: "acct-checking", name: "Checking", type: "bank", number: "1000" },
  { id: "acct-rent", name: "Rent", type: "expense" },
  { id: "acct-wages", name: "Wages", type: "expense" },
  { id: "acct-sales", name: "Sales", type: "income" },
] as const;
// Two transaction ids snarkVM reads (bech32m of the field elements 1 and 2): made up, on no chain.
const TX1 = "at1qyqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq7fymfh";
const TX2 = "at1qgqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq5ragwl";

type Draft = Omit<Entry, "hash" | "prevHash">;

/** Entries chained by their hashes, as the journal posts them. */
function journal(drafts: Draft[], prev: string = GENESIS_HASH): Entry[] {
  const out: Entry[] = [];
  for (const d of drafts) {
    const entry = { ...d, prevHash: prev } as Omit<Entry, "hash">;
    const hash = hashEntry(entry);
    out.push({ ...entry, hash });
    prev = hash;
  }
  return out;
}

function proofs(): Record<string, string> {
  const before = journal([
    { id: "e-0", seq: 1, date: "2026-10-20", source: { kind: "manual" }, postedAt: "2026-10-20T09:00:00.000Z", lines: [{ accountId: "acct-rent", debit: 100n, credit: 0n }, { accountId: "acct-checking", debit: 0n, credit: 100n }] },
  ] as Draft[]);
  const entries = journal(
    [
      {
        id: "e-1",
        seq: 2,
        date: "2026-10-25",
        memo: 'Rent — October, "late" fee\nsecond line 😀 \u0001',
        source: { kind: "bill", ref: "bill-7" },
        postedAt: "2026-10-25T10:00:00.000Z",
        lines: [
          { accountId: "acct-rent", debit: 120000n, credit: 0n, memo: "line memo", name: { kind: "vendor", id: "v-1" }, tags: { class: "c-1", location: "l-1", project: "p-1" } },
          { accountId: "acct-checking", debit: 0n, credit: 120000n },
        ],
      },
      {
        id: "e-2",
        seq: 4,
        date: "2026-10-28",
        source: { kind: "payroll", ref: "run-1", doc: "ab".repeat(32) },
        postedAt: "2026-10-28T12:00:00.000Z",
        lines: [
          { accountId: "acct-wages", debit: 250000n, credit: 0n, name: { kind: "employee", id: "w-1" } },
          { accountId: "acct-checking", debit: 0n, credit: 250000n },
        ],
      },
      {
        id: "e-3",
        seq: 5,
        date: "2026-10-30",
        memo: "",
        source: { kind: "invoice" },
        postedAt: "2026-10-30T08:30:00.000Z",
        lines: [{ accountId: "acct-checking", debit: 5n, credit: 0n, tags: { project: "p-2" } }, { accountId: "acct-sales", debit: 0n, credit: 5n }],
      },
      {
        id: "e-4",
        seq: 9,
        date: "2026-10-31",
        source: { kind: "manual" },
        postedAt: "2026-11-01T08:00:00.000Z",
        reverses: "e-3",
        lines: [{ accountId: "acct-sales", debit: 5n, credit: 0n }, { accountId: "acct-checking", debit: 0n, credit: 5n }],
      },
    ] as Draft[],
    before[0]!.hash,
  );
  const settlements = [
    { entryHash: entries[1]!.hash, txId: TX1, recipient: "aleo1" + "p".repeat(58) },
    { entryHash: entries[1]!.hash, txId: TX2, recipient: "aleo1" + "q".repeat(58) },
  ];
  const input = { anchorSecret: SECRET, start: "2026-10-25", end: "2026-10-31", entries, settlements, prevRoot: "cd".repeat(32) };
  const root = periodRoot(input).root;
  const full = buildPeriodProof(
    {
      ...input,
      business: "Example Woodworks",
      madeAt: "2026-11-05T00:00:00.000Z",
      accounts: ACCOUNTS as never,
      closes: [
        { start: "2026-10-25", end: "2026-10-31", root, closedAt: "2026-11-03T00:00:00.000Z", anchorTx: TX1 },
        { start: "2026-10-25", end: "2026-10-31", root: "ef".repeat(32), closedAt: "2026-11-02T00:00:00.000Z", anchorTx: TX2, reopenedAt: "2026-11-02T12:00:00.000Z" },
      ],
    },
    root,
  );
  const emptyInput = { anchorSecret: SECRET, start: "2026-12-01", end: "2026-12-31", entries: [], settlements: [] };
  const empty = buildPeriodProof({ ...emptyInput, business: "Example Woodworks", madeAt: "2026-11-05T00:00:00.000Z", accounts: [], closes: [] }, periodRoot(emptyInput).root);
  return { "period_proof.json": `${periodProofToJson(full)}\n`, "period_proof_empty.json": `${periodProofToJson(empty)}\n` };
}

describe("the native verifier's period fixtures", () => {
  for (const [name, text] of Object.entries(proofs())) {
    it(`${name} is what @pnw/ledger makes`, () => {
      const path = join(OUT, name);
      if (process.env.HEWN_WRITE_FIXTURES === "1") writeFileSync(path, text);
      expect(readFileSync(path, "utf8")).toBe(text);
    });
  }
});
