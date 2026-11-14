// The look the pay queue takes before it calls a payment's outcome unknown: a fake Shield (records,
// history, transition view keys) and a fake explorer, no key and no network. What it must never do
// is as much the subject as what it finds: a wrong "found" leaves someone unpaid, a wrong "none"
// invites a second payment.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Paycheck, Settlement } from "@pnw/payroll";
import { type RailNetwork, RailNetworkError, centsToMinor, recordTag } from "@pnw/rail";
import { USDCX_PROGRAM } from "./balances";
import { claimedTransfers, rivalPayments } from "./pay_outcome";
import { type SentPaymentDeps, type SentRead, findSentPayment } from "./sent_payment";

const ME = "aleo1" + "m".repeat(58);
const ANA = "aleo1" + "a".repeat(58);
const BEN = "aleo1" + "b".repeat(58);
const tx = (n: number) => `at1${String(n).padStart(58, "x")}`;
const chainTag = (n: number) => `${n}`.repeat(20) + "field";
const PLAIN = `{\n  owner: ${ME}.private,\n  amount: 25000000u128.private,\n  _nonce: 7group.public\n}`;
const PAY = 17_000_000n;
const FLOOR = 4_000_000;

/** One transaction the account's history may list, as the chain holds it. */
type Sent = {
  n: number;
  /** transfer_private unless said. */
  fn?: string;
  to?: string;
  minor?: bigint;
  height?: number;
  /** The explorer's own answer carries the height (otherwise it is looked up by block). */
  inline?: boolean;
  /** The chain's tag of the record it spent. */
  spends?: string;
  /** Shield has no view key for it. */
  sealed?: boolean;
  rejected?: boolean;
  /** The explorer doesn't have it. */
  missing?: boolean;
  /** The explorer answers for it without saying it was accepted, or with another transaction. */
  vague?: "no status" | "pending" | "another id";
};

function world(sent: Sent[], opts: { history?: unknown[] | "down" | "odd"; records?: unknown[]; keysDown?: boolean } = {}) {
  const byId = new Map(sent.map((s) => [tx(s.n), s]));
  const asked = { wallet: [] as string[], network: [] as string[] };
  const transition = (s: Sent) => ({
    program: USDCX_PROGRAM,
    function: s.fn ?? "transfer_private",
    inputs: [
      { type: "private", value: "ciphertext1a" },
      { type: "private", value: "ciphertext1b" },
      { type: "record", id: "1field", ...(s.spends ? { tag: s.spends } : {}) },
      { type: "private", value: "ciphertext1c" },
    ],
    outputs: [],
  });
  const network: RailNetwork = {
    async fetchJson(path) {
      asked.network.push(path);
      const t = /^transaction\/confirmed\/(at1\w+)$/.exec(path);
      if (t) {
        const s = byId.get(t[1]!);
        if (!s || s.missing) throw new RailNetworkError("not found", 404);
        // A rejected execution, as the network keeps it: the fee alone went through, and what was asked for sits beside it.
        if (s.rejected) return { type: "execute", status: "rejected", index: 0, transaction: { type: "fee", id: t[1] }, rejected: { type: "execution", execution: { transitions: [transition(s)] } } };
        return {
          type: "execute",
          index: 0,
          ...(s.vague === "no status" ? {} : { status: s.vague === "pending" ? "pending" : "accepted" }),
          transaction: { type: "execute", id: s.vague === "another id" ? tx(999) : t[1], execution: { transitions: [transition(s)] } },
          finalize: [],
          ...(s.inline ? { block_height: s.height } : {}),
        };
      }
      const h = /^find\/blockHash\/(at1\w+)$/.exec(path);
      if (h) {
        const s = byId.get(h[1]!);
        if (!s || s.height === undefined) throw new RailNetworkError("not found", 404);
        return `ab1block${s.n}`;
      }
      const b = /^block\/ab1block(\d+)$/.exec(path);
      if (b) return { header: { metadata: { height: sent.find((s) => s.n === Number(b[1]))!.height } } };
      throw new RailNetworkError("not found", 404);
    },
  };
  const deps: SentPaymentDeps = {
    shieldWaitMs: 50,
    network,
    wallet: {
      async requestRecords(program) {
        asked.wallet.push(`records ${program}`);
        return opts.records ?? [];
      },
      async requestTransactionHistory(program) {
        asked.wallet.push(`history ${program}`);
        if (opts.history === "down") return new Promise(() => {});
        if (opts.history === "odd") return {};
        // Everything but the id is made misleading on purpose: none of it may be believed.
        return { transactions: opts.history ?? sent.map((s) => ({ transactionId: tx(s.n), transactionStatus: "failed", blockTimestamp: 1, blockHeight: 1, functionId: "join" })) };
      },
      async transitionViewKeys(id) {
        asked.wallet.push("view keys");
        if (opts.keysDown) throw new Error("Shield is busy");
        return byId.get(id)?.sealed ? [] : [`k-${id}`];
      },
    },
    async decrypt(t, tvk) {
      const s = byId.get(tvk.slice(2))!;
      const opened = structuredClone(t) as { inputs: { type: string; value?: string }[] };
      opened.inputs = [{ type: "private", value: `${s.to}.private` }, { type: "private", value: `${s.minor}u128.private` }, { type: "record" }, { type: "private", value: "{ siblings: [ 0field ] }" }];
      return opened;
    },
  };
  return { deps, asked };
}

const none = new Set<string>();
const look = (deps: SentPaymentDeps, over: Partial<Parameters<typeof findSentPayment>[0]> = {}) => findSentPayment({ to: ANA, minor: PAY, since: FLOOR, claimed: none, contested: false, deps, ...over });
/** Shield's record list holding the record the payment set aside, spent, with the chain's tag for it. */
const records = (tag: string | undefined) => [{ recordName: "Token", spent: true, recordPlaintext: PLAIN, ...(tag ? { tag } : {}) }];

describe("findSentPayment, with the record's tag", () => {
  it("finds the transfer that spent the record the payment set aside, whatever block it is in", async () => {
    const attempt = await recordTag(PLAIN);
    const w = world([{ n: 1, to: ANA, minor: PAY, height: FLOOR - 50, spends: chainTag(7) }], { records: records(chainTag(7)) });
    expect(await look(w.deps, { attempt })).toEqual({ found: tx(1) });
    // Without the tag, a transfer in a block older than the floor is not this payment.
    expect(await look(w.deps)).toBe("unknown");
  });

  it("says none when the record went into something that isn't a payment to them: records combined, a split, a payment to someone else", async () => {
    const attempt = await recordTag(PLAIN);
    for (const spender of [
      { n: 1, fn: "join", spends: chainTag(7) },
      { n: 1, fn: "split", spends: chainTag(7) },
      { n: 1, to: BEN, minor: PAY, height: FLOOR + 5, spends: chainTag(7) },
      { n: 1, to: ANA, minor: PAY - 1n, height: FLOOR + 5, spends: chainTag(7) },
    ] satisfies Sent[]) {
      const w = world([spender, { n: 2, to: BEN, minor: 5n, height: FLOOR + 9 }], { records: records(chainTag(7)) });
      expect(await look(w.deps, { attempt })).toBe("none");
    }
  });

  it("says unknown when what spent the record isn't in the history, or is a transfer Shield can't open", async () => {
    const attempt = await recordTag(PLAIN);
    const absent = world([{ n: 2, fn: "join", spends: chainTag(8) }], { records: records(chainTag(7)) });
    expect(await look(absent.deps, { attempt })).toBe("unknown");
    const closed = world([{ n: 1, to: ANA, minor: PAY, height: FLOOR + 5, spends: chainTag(7), sealed: true }], { records: records(chainTag(7)) });
    expect(await look(closed.deps, { attempt })).toBe("unknown");
    // And when Shield's record list gives the record no tag, or doesn't list it: there is nothing to say "none" with.
    for (const list of [records(undefined), [], [{ recordName: "Token", spent: true, recordPlaintext: PLAIN, tag: "not-a-tag" }]]) {
      const untagged = world([{ n: 1, fn: "join", spends: chainTag(7) }], { records: list });
      expect(await look(untagged.deps, { attempt })).toBe("unknown");
    }
  });

  it("finds an earlier try's transfer even when this try's record was combined: never none while a payment to them stands", async () => {
    const attempt = await recordTag(PLAIN);
    const w = world(
      [
        { n: 1, fn: "join", spends: chainTag(7) }, // this try's record went into a join
        { n: 2, to: ANA, minor: PAY, height: FLOOR + 3, spends: chainTag(6) }, // an earlier try, with another record, landed
      ],
      { records: records(chainTag(7)) },
    );
    expect(await look(w.deps, { attempt })).toEqual({ found: tx(2) });
  });

  it("never says none while anything since the floor is unread", async () => {
    const attempt = await recordTag(PLAIN);
    const join: Sent = { n: 1, fn: "join", spends: chainTag(7) };
    const rec = { records: records(chainTag(7)) };
    // A transfer since the floor that Shield can't open; one whose block can't be placed; one the explorer doesn't have.
    expect(await look(world([join, { n: 2, to: ANA, minor: PAY, height: FLOOR + 1, sealed: true }], rec).deps, { attempt })).toBe("unknown");
    expect(await look(world([join, { n: 2, to: ANA, minor: PAY, sealed: true }], rec).deps, { attempt })).toBe("unknown");
    expect(await look(world([join, { n: 2, to: ANA, minor: PAY, height: FLOOR + 1, missing: true }], rec).deps, { attempt })).toBe("unknown");
    // A history that didn't answer, came back without a list, or lists something without an id.
    expect(await look(world([join], { ...rec, history: "down" }).deps, { attempt })).toBe("unknown");
    expect(await look(world([join], { ...rec, history: "odd" }).deps, { attempt })).toBe("unknown");
    expect(await look(world([join], { ...rec, history: [{ transactionId: tx(1) }, { functionId: "transfer_private" }] }).deps, { attempt })).toBe("unknown");
    // More transactions than one look reads.
    expect(await look({ ...world([{ n: 2, to: BEN, minor: 5n, height: FLOOR + 1 }, join], rec).deps, maxReads: 1 }, { attempt })).toBe("unknown");
    // No floor, and a transfer to them for the amount that can't be told from an older one.
    expect(await look(world([join, { n: 2, to: ANA, minor: PAY, height: FLOOR - 900 }], rec).deps, { attempt, since: undefined })).toBe("unknown");
    // A sealed transfer in a block older than the floor is someone else's old payment: it leaves no doubt.
    expect(await look(world([join, { n: 2, to: ANA, minor: PAY, height: FLOOR - 1, sealed: true }], rec).deps, { attempt })).toBe("none");
  });
});

describe("findSentPayment, without the record's tag", () => {
  it("finds a transfer to the payee for exactly the amount at or after the floor, the earliest, and skips what the books already hold", async () => {
    const w = world([
      { n: 1, to: ANA, minor: PAY, height: FLOOR - 1 }, // last period's: before the floor
      { n: 2, to: BEN, minor: PAY, height: FLOOR + 2 }, // someone else, same amount
      { n: 3, to: ANA, minor: PAY + 1n, height: FLOOR + 3 }, // them, another amount
      { n: 5, to: ANA, minor: PAY, height: FLOOR + 9, inline: true },
      { n: 4, to: ANA, minor: PAY, height: FLOOR + 4 },
    ]);
    expect(await look(w.deps)).toEqual({ found: tx(4) });
    expect(await look(w.deps, { claimed: new Set([tx(4)]) })).toEqual({ found: tx(5) });
    expect(await look(w.deps, { claimed: new Set([tx(4), tx(5)]) })).toBe("unknown"); // never none without the tag
    expect(await look(w.deps, { minor: PAY + 2n })).toBe("unknown");
    expect(await look(w.deps, { since: FLOOR + 10 })).toBe("unknown");
    expect(await look(w.deps, { since: FLOOR + 4 })).toEqual({ found: tx(4) }); // the floor's own block counts
  });

  it("while another open payment is to the same payee for the same amount, a transfer known only by payee and amount is found for neither", async () => {
    const attempt = await recordTag(PLAIN);
    const transfer: Sent = { n: 4, to: ANA, minor: PAY, height: FLOOR + 4, spends: chainTag(7) };
    const w = world([transfer], { records: records(chainTag(7)) });
    expect(await look(w.deps)).toEqual({ found: tx(4) });
    expect(await look(w.deps, { contested: true })).toBe("unknown");
    // The payment whose record it spent, or whose request it was, is still found: those say which payment it is.
    expect(await look(w.deps, { contested: true, attempt })).toEqual({ found: tx(4) });
    expect(await look(w.deps, { contested: true, ids: [tx(4)] })).toEqual({ found: tx(4) });
    // And it is never none for the other one: its record went into a join, but a transfer to them for the amount stands since its floor.
    const other = world([{ n: 1, fn: "join", spends: chainTag(7) }, { ...transfer, spends: chainTag(6) }], { records: records(chainTag(7)) });
    expect(await look(other.deps, { contested: true, attempt })).toBe("unknown");
    // With nothing since the floor to them for the amount, a contested look still says none when the record went elsewhere.
    const quiet = world([{ n: 1, fn: "join", spends: chainTag(7) }], { records: records(chainTag(7)) });
    expect(await look(quiet.deps, { contested: true, attempt })).toBe("none");
  });

  it("two open runs pay the same person the same amount: the one transfer that landed settles the run that sent it, never the other", async () => {
    // Run A's line was asked of Shield and never landed. Run B's, a week on, set aside another record; Shield called it
    // failed and it landed. The books, as the pay panel reads them (pay_outcome.ts), and each line's look.
    const recordB = PLAIN.replace("7group", "8group");
    const [tagA, tagB] = [await recordTag(PLAIN), await recordTag(recordB)];
    const cents = 17_00n;
    const check = (settlement: Settlement) => ({ workerId: "ana", net: cents, settlement }) as Paycheck;
    const runs = [
      { id: "run-a", mode: "rail" as const, paychecks: [check({ status: "pending", failure: "No answer from Shield in time", attempt: tagA, since: FLOOR })] },
      { id: "run-b", mode: "rail" as const, paychecks: [check({ status: "pending", failure: "Shield reported a problem (failed)", attempt: tagB, since: FLOOR + 100 })] },
    ];
    const links = new Map([["ana", ANA]]);
    const minor = centsToMinor(cents);
    const w = world([{ n: 2, to: ANA, minor, height: FLOOR + 120, spends: chainTag(8) }], {
      records: [
        { recordName: "Token", spent: false, recordPlaintext: PLAIN, tag: chainTag(7) },
        { recordName: "Token", spent: true, recordPlaintext: recordB, tag: chainTag(8) },
      ],
    });
    const lookFor = (runId: string, attempt: string, since: number) => {
      const rival = rivalPayments(runs, links, { runId, workerId: "ana" }, { to: ANA, minor, attempt });
      return findSentPayment({ to: ANA, minor, since, claimed: claimedTransfers(runs), contested: rival.contested, ...(rival.sameRecord ? {} : { attempt }), deps: w.deps });
    };
    // Run A reopened first: the transfer is at or after its floor, to the same person for the same amount, and is not taken for it.
    expect(await lookFor("run-a", tagA, FLOOR)).toBe("unknown");
    // Run B: it spent the record run B set aside.
    expect(await lookFor("run-b", tagB, FLOOR + 100)).toEqual({ found: tx(2) });
    // Once the books hold it as run B's, run A is no longer contested, and still isn't handed it.
    runs[1]!.paychecks[0] = check({ status: "settled", reference: tx(2), height: FLOOR + 120 });
    expect(rivalPayments(runs, links, { runId: "run-a", workerId: "ana" }, { to: ANA, minor, attempt: tagA })).toEqual({ contested: false, sameRecord: false });
    expect(await lookFor("run-a", tagA, FLOOR)).toBe("unknown");
  });

  it("believes nothing in a history entry but its id: the explorer says what each transaction was", async () => {
    // The entries (see `world`) call every transaction a failed join from 1970; the one on the explorer as a transfer to them is found.
    const w = world([{ n: 1, to: ANA, minor: PAY, height: FLOOR + 1 }]);
    expect(await look(w.deps)).toEqual({ found: tx(1) });
    // An entry that says "accepted transfer to them" for a transaction the explorer doesn't have, or that the network rejected, finds nothing.
    const said = [{ transactionId: tx(1), transactionStatus: "accepted", functionId: "transfer_private", recipient: ANA, amount: `${PAY}u128`, blockHeight: FLOOR + 1 }];
    expect(await look(world([{ n: 1, to: ANA, minor: PAY, height: FLOOR + 1, missing: true }], { history: said }).deps)).toBe("unknown");
    expect(await look(world([{ n: 1, to: ANA, minor: PAY, height: FLOOR + 1, rejected: true }], { history: said }).deps)).toBe("unknown");
    // Nor does one the explorer answers for without calling it accepted, or by handing back another transaction.
    for (const vague of ["no status", "pending", "another id"] as const) {
      expect(await look(world([{ n: 1, to: ANA, minor: PAY, height: FLOOR + 1, vague }], { history: said }).deps, { ids: [tx(1)] })).toBe("unknown");
    }
    // A transfer whose block can't be placed, or with no floor to place it against, isn't taken on Shield's word for when it was.
    expect(await look(world([{ n: 1, to: ANA, minor: PAY }], { history: said }).deps)).toBe("unknown");
    expect(await look(world([{ n: 1, to: ANA, minor: PAY, height: FLOOR + 1 }], { history: said }).deps, { since: undefined })).toBe("unknown");
  });

  it("takes the id Shield named for the request itself, submitted or confirmed, though the history doesn't list it and whatever its block", async () => {
    const w = world([{ n: 8, to: ANA, minor: PAY, height: FLOOR - 3 }], { history: [] });
    expect(await look(w.deps)).toBe("unknown");
    expect(await look(w.deps, { ids: [tx(9), tx(8).toUpperCase()] })).toEqual({ found: tx(8) });
    expect(await look(w.deps, { ids: [tx(8)], since: undefined })).toEqual({ found: tx(8) });
    // Its own id, but it paid someone else or the network rejected it: not found.
    expect(await look(world([{ n: 8, to: BEN, minor: PAY, height: FLOOR + 1 }], { history: [] }).deps, { ids: [tx(8)] })).toBe("unknown");
    expect(await look(world([{ n: 8, to: ANA, minor: PAY, rejected: true }], { history: [] }).deps, { ids: [tx(8)] })).toBe("unknown");
    expect(await look(w.deps, { ids: [tx(8)], claimed: new Set([tx(8)]) })).toBe("unknown");
  });

  it("an unreadable transfer gives unknown, never none, and a Shield that doesn't answer is asked again next time", async () => {
    const sealed = world([{ n: 2, to: ANA, minor: PAY, height: FLOOR + 1, sealed: true }]);
    expect(await look(sealed.deps)).toBe("unknown");
    const cache = new Map<string, SentRead>();
    const busy = world([{ n: 2, to: ANA, minor: PAY, height: FLOOR + 1 }], { keysDown: true });
    expect(await look({ ...busy.deps, cache })).toBe("unknown");
    expect(cache.size).toBe(0);
    const back = world([{ n: 2, to: ANA, minor: PAY, height: FLOOR + 1 }]);
    expect(await look({ ...back.deps, cache })).toEqual({ found: tx(2) });
  });

  it("reads each transaction once a session", async () => {
    const cache = new Map<string, SentRead>();
    const w = world([
      { n: 1, to: BEN, minor: PAY, height: FLOOR + 1 },
      { n: 2, to: ANA, minor: PAY, height: FLOOR + 2 },
      { n: 3, fn: "join" },
    ]);
    expect(await look({ ...w.deps, cache })).toEqual({ found: tx(2) });
    const first = w.asked.network.length;
    expect(await look({ ...w.deps, cache }, { to: BEN })).toEqual({ found: tx(1) });
    expect(first).toBeGreaterThan(0);
    expect(w.asked.network.slice(first).filter((p) => p.startsWith("transaction/"))).toEqual([]);
  });
});

describe("findSentPayment keeps to Shield's history and the explorer", () => {
  it("asks Shield for records, history and transition view keys only, and the explorer for transactions and their blocks only", async () => {
    const attempt = await recordTag(PLAIN);
    const w = world(
      [
        { n: 1, to: ANA, minor: PAY, height: FLOOR + 2 },
        { n: 2, fn: "join", spends: chainTag(7) },
        { n: 3, to: BEN, minor: 5n, sealed: true, height: FLOOR + 1 },
      ],
      { records: records(chainTag(7)) },
    );
    expect(await look(w.deps, { attempt, ids: [tx(4)] })).toEqual({ found: tx(1) });
    expect(new Set(w.asked.wallet)).toEqual(new Set([`records ${USDCX_PROGRAM}`, `history ${USDCX_PROGRAM}`, "view keys"]));
    for (const path of w.asked.network) expect(path).toMatch(/^(transaction\/confirmed\/at1\w+|find\/blockHash\/at1\w+|block\/ab1\w+)$/);
    // Nothing that left for the explorer names an account, an amount or a key.
    for (const path of w.asked.network) expect(path).not.toMatch(/aleo1|AViewKey|u128/);
  });

  it("registers no view key with a record scanner: the account's view key never reaches this module", () => {
    // The look's dependencies carry no view key (SentPaymentDeps), and its source reaches for none:
    // not the books' kept key, not the SDK, not the records package's scanner, not a scanning service.
    const source = readFileSync(new URL("./sent_payment.ts", import.meta.url), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const imports = [...code.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(imports.sort()).toEqual(["./balances", "./history_probe", "./review_feed", "@pnw/rail"]);
    // (Shield's transition view keys, one per transaction it sent, are the only keys it handles.)
    expect(code).not.toMatch(/view_key|(?<!transition)viewkey|openOwnRecord|openRecord|@provablehq\/sdk|@pnw\/records|scanner|register|fetch\(/i);
    // And the pay panel hands it Shield and the explorer, never the books' view key.
    const panel = readFileSync(new URL("./PayPanel.tsx", import.meta.url), "utf8");
    expect(panel).toMatch(/findSentPayment\(/);
    expect(panel).not.toMatch(/view_key|(?<!transition)viewkey|openOwnRecord|scanner/i);
  });
});
