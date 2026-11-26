// The check of each person's agreement before a pay run asks Shield to pay them (payee_check.ts): the
// business's own unspent FinalAgreement must name the account the books pay, and the agreement must be
// active on chain, for v4 and v5 alike; then the same check through a whole run, where a held person is
// never asked of Shield and everyone else is paid.
import { describe, expect, it } from "vitest";
import { type Books, applyTemplate, createBooks, emptyDimensions } from "@pnw/ledger";
import { type Payroll, type W4, addWorker, emptyPayroll, ensureRailAccount, markPaycheckSettlement, postPayRun } from "@pnw/payroll";
import { PROGRAMS } from "@pnw/config/programs";
import { type RailNetwork, RailNetworkError, centsToMinor } from "@pnw/rail";
import { byteWords, packedWords } from "@pnw/records/packed";
import { payableLinks, payableRailLinks, type RailLink } from "../books/rail";
import { AGREEMENT_V4, AGREEMENT_V5, halfToInput } from "./agreement_programs";
import { type HoldReason, checkPayees, holdMessage, payeesToCheck } from "./payee_check";
import { sequentialReleaser } from "./release";

const EMPLOYER = "aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n";
const OTHER = "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px";
const account = (n: number) => `aleo1${"qpzry9x8gf2tvdw0s3jn54khce6mua7l"[n % 32]!.repeat(58)}`;
const ID = (n: number) => Array.from({ length: 32 }, (_, i) => ((i * 7 + n * 31) & 0xff).toString(16).padStart(2, "0")).join("");
const HALF = (b: string) => "04" + b.repeat(64);
const USDCX = PROGRAMS.external.usdcx;

type RecordShape = { version: 4 | 5; id: string; worker: string; employer?: string; spent?: boolean; name?: "FinalAgreement" | "PendingAgreement" };

/** The business's copy of an agreement record, as the program writes it and Shield lists it. */
function agreement({ version, id, worker, employer = EMPLOYER, spent = false, name = "FinalAgreement" }: RecordShape) {
  const bytes = (h: string) => (version === 5 ? packedWords(h, 2) : byteWords(h));
  const lines = [
    `owner: ${EMPLOYER}.private`,
    `agreement_id: ${bytes(id)}.private`,
    `parties_key: ${bytes("11".repeat(32))}.private`,
    "employer_name_hash: 1111field.private",
    "worker_name_hash: 2222field.private",
    "industry_code: 9u8.private",
    "pay_frequency_code: 2u8.private",
    "start_epoch: 10u32.private",
    "end_epoch: 0u32.private",
    "review_epoch: 10u32.private",
    "agreement_rev: 1u16.private",
    "schema_v: 2u16.private",
    "policy_v: 1u16.private",
    `terms_doc_hash: ${bytes("22".repeat(32))}.private`,
    `terms_root: ${bytes("33".repeat(32))}.private`,
  ];
  if (version === 4) lines.push("offer_height: 4210000u32.private");
  lines.push(`offer_time_hash: ${bytes("44".repeat(32))}.private`);
  if (version === 5 && name === "FinalAgreement") lines.push(`accept_time_hash: ${bytes("55".repeat(32))}.private`);
  lines.push(`employer_address: ${employer}.private`, `worker_address: ${worker}.private`);
  if (version === 5) lines.push(`employer_half: ${halfToInput(HALF("ab"))}.private`);
  if (version === 5 && name === "FinalAgreement") lines.push(`worker_half: ${halfToInput(HALF("cd"))}.private`, "end_reason: 0u8.private");
  lines.push("_nonce: 72037856912846704071group.public", "_version: 1u8.public");
  return { recordName: name, spent, recordPlaintext: `{\n  ${lines.join(",\n  ")}\n}` };
}

const programOf = (version: 4 | 5) => (version === 5 ? AGREEMENT_V5 : AGREEMENT_V4);
const statusPath = (version: 4 | 5, id: string) =>
  `program/${programOf(version)}/mapping/agreement_status/${encodeURIComponent(version === 5 ? packedWords(id, 2) : byteWords(id))}`;

/** Shield's records, by program. */
function shieldRecords(byProgram: Partial<Record<string, unknown[]>>) {
  const asked: string[] = [];
  return {
    asked,
    requestRecords: async (program: string, all?: boolean) => {
      asked.push(`${program} ${all}`);
      return byProgram[program] ?? [];
    },
  };
}

/** The explorer: each status path answers its value; a function answers by throwing or returning what it likes. */
function explorer(statuses: Record<string, unknown | (() => unknown)>): RailNetwork & { paths: string[] } {
  const paths: string[] = [];
  return {
    paths,
    async fetchJson(path) {
      paths.push(path);
      if (!(path in statuses)) throw new RailNetworkError("not found", 404);
      const v = statuses[path];
      return typeof v === "function" ? (v as () => unknown)() : v;
    },
  };
}

const W = account(1);

/** One payee, checked against one record and one status. */
async function checkOne(version: 4 | 5, opts: { record?: Partial<RecordShape> | null; status?: unknown | (() => unknown); address?: string } = {}) {
  const id = ID(version);
  const records = opts.record === null ? [] : [agreement({ version, id, worker: W, ...opts.record })];
  const shield = shieldRecords({ [programOf(version)]: records });
  const network = explorer("status" in opts ? (opts.status === undefined ? {} : { [statusPath(version, opts.record?.id ?? id)]: opts.status }) : { [statusPath(version, id)]: "1u8" });
  const held = await checkPayees({ payees: new Map([["w1", { address: opts.address ?? W, agreementId: id }]]), account: EMPLOYER, ...shield, network });
  return { held: held.get("w1") ?? null, shield, network };
}

describe("checking a person's agreement", () => {
  for (const version of [4, 5] as const) {
    describe(`on employer_agreement_v${version}`, () => {
      it("passes when the business's own unspent record names the account in the books and the agreement is active", async () => {
        const { held, shield, network } = await checkOne(version);
        expect(held).toBe(null);
        // Records once per agreement program, spent ones included in the ask; the status from the record's own program, by its id.
        expect(shield.asked).toEqual([`${AGREEMENT_V5} true`, `${AGREEMENT_V4} true`]);
        expect(network.paths).toEqual([statusPath(version, ID(version))]);
      });

      it("holds a person whose record names a different account than the books", async () => {
        expect((await checkOne(version, { address: account(2) })).held).toBe("mismatch");
        expect((await checkOne(version, { record: { worker: account(2) } })).held).toBe("mismatch");
      });

      it("holds a person whose record isn't this business's own copy", async () => {
        expect((await checkOne(version, { record: { employer: OTHER } })).held).toBe("mismatch");
      });

      it("holds a person with no record for the agreement, a spent one, or only an offer", async () => {
        const none = await checkOne(version, { record: null });
        expect(none.held).toBe("mismatch");
        expect(none.network.paths).toEqual([]); // nothing to read a status for
        expect((await checkOne(version, { record: { spent: true } })).held).toBe("mismatch");
        expect((await checkOne(version, { record: { id: ID(9) } })).held).toBe("mismatch");
        expect((await checkOne(version, { record: { name: "PendingAgreement" } })).held).toBe("mismatch");
      });

      it("holds a person whose agreement isn't active: pending, paused, ended, or another status", async () => {
        for (const status of ["0u8", "2u8", "3u8", "4u8"]) expect((await checkOne(version, { status })).held).toBe("inactive");
      });

      it("holds a person whose agreement has no status on chain", async () => {
        expect((await checkOne(version, { status: undefined })).held).toBe("inactive"); // the explorer's 404
        expect((await checkOne(version, { status: null })).held).toBe("inactive");
      });

      it("holds a person whose status couldn't be read, or reads as something other than a u8", async () => {
        const failed = () => {
          throw new RailNetworkError("The network answered 500", 500);
        };
        const unreachable = () => {
          throw new TypeError("fetch failed");
        };
        expect((await checkOne(version, { status: failed })).held).toBe("unchecked");
        expect((await checkOne(version, { status: unreachable })).held).toBe("unchecked");
        expect((await checkOne(version, { status: "1u32" })).held).toBe("unchecked");
        expect((await checkOne(version, { status: { value: 1 } })).held).toBe("unchecked");
      });
    });
  }

  it("holds everyone when Shield's agreement records can't be read, and reads no status", async () => {
    const network = explorer({ [statusPath(5, ID(5))]: "1u8" });
    const payees = new Map([
      ["w1", { address: W, agreementId: ID(5) }],
      ["w2", { address: account(2), agreementId: ID(6) }],
    ]);
    const throws = async () => {
      throw new Error("Shield is locked");
    };
    const notAList = async () => "nope" as unknown as unknown[];
    for (const requestRecords of [throws, notAList]) {
      const held = await checkPayees({ payees, account: EMPLOYER, requestRecords, network });
      expect([...held]).toEqual([
        ["w1", "unchecked"],
        ["w2", "unchecked"],
      ]);
    }
    expect(network.paths).toEqual([]);
  });

  it("holds a person when two unspent copies of the agreement disagree about their account", async () => {
    const id = ID(5);
    const shield = shieldRecords({ [AGREEMENT_V5]: [agreement({ version: 5, id, worker: W }), agreement({ version: 5, id, worker: account(2) })] });
    const held = await checkPayees({ payees: new Map([["w1", { address: W, agreementId: id }]]), account: EMPLOYER, ...shield, network: explorer({ [statusPath(5, id)]: "1u8" }) });
    expect(held.get("w1")).toBe("mismatch");
  });

  it("checks each person on their own: v4 and v5 side by side, one held, the others paid", async () => {
    const shield = shieldRecords({
      [AGREEMENT_V5]: [agreement({ version: 5, id: ID(1), worker: account(1) }), agreement({ version: 5, id: ID(2), worker: account(2) })],
      [AGREEMENT_V4]: [agreement({ version: 4, id: ID(3), worker: account(3) }), agreement({ version: 4, id: ID(4), worker: account(4) })],
    });
    const network = explorer({ [statusPath(5, ID(1))]: "1u8", [statusPath(5, ID(2))]: "3u8", [statusPath(4, ID(3))]: "1u8", [statusPath(4, ID(4))]: "1u8" });
    const payees = new Map([1, 2, 3, 4].map((n) => [`w${n}`, { address: n === 4 ? account(9) : account(n), agreementId: `0x${ID(n).toUpperCase()}` }]));
    const held = await checkPayees({ payees, account: EMPLOYER, ...shield, network });
    expect([...held].sort()).toEqual([
      ["w2", "inactive"],
      ["w4", "mismatch"],
    ]);
  });

  it("says why on the person's line, naming them", () => {
    const said = (r: HoldReason) => holdMessage("Ana", r);
    expect(said("mismatch")).toBe("Ana's agreement doesn't match the address in the books");
    expect(said("inactive")).toBe("Ana's agreement is no longer active");
    expect(said("unchecked")).toMatch(/^Ana's agreement couldn't be checked/);
  });
});

// ---- Through a whole run ---------------------------------------------------------------------

const W4_SINGLE: W4 = { filingStatus: "single", dependentCredit: 0n, otherIncome: 0n, extraDeductions: 0n, extraWithholding: 0n };
const clock = { now: () => "2026-11-26T12:00:00.000Z" };
const AT = (n: number) => `at1tx${n}`.padEnd(61, "x");

/** A posted rail run for three people, each linked under a v5 agreement. */
function setup() {
  let books: Books = applyTemplate(createBooks({ businessName: "Day Construction", fiscalYearStartMonth: 1 }), "service");
  const rail = ensureRailAccount(books);
  books = rail.books;
  let payroll: Payroll = emptyPayroll();
  const workers = [1, 2, 3].map((n) => {
    const added = addWorker(payroll, { name: `Worker ${n}`, payType: "hourly", rate: 3000n, frequency: "weekly", w4: W4_SINGLE });
    payroll = added.payroll;
    return added.worker;
  });
  const posted = postPayRun(
    books,
    payroll,
    { payDate: "2026-11-26", periodStart: "2026-11-20", periodEnd: "2026-11-26", bankAccountId: rail.accountId, mode: "rail", lines: workers.map((w) => ({ workerId: w.id, hours: 20 })) },
    clock,
  );
  const links: RailLink[] = workers.map((w, i) => ({ workerId: w.id, address: account(i + 1), nameHash: `${i + 1}`, agreementId: ID(i + 1), status: "linked", program: AGREEMENT_V5 }));
  return { payroll: posted.payroll, runId: posted.run.id, workers, rail: { version: 1 as const, network: "testnet" as const, address: EMPLOYER, linkedAt: clock.now(), links } };
}

/** Shield: the account's USDCx and agreement records; every request it takes is kept, and each transfer leaves its change. */
function fakeShield(deposit: bigint, agreements: unknown[]) {
  const calls: { program: string; function: string; inputs: string[] }[] = [];
  let minted = 0;
  const token = (amount: bigint) => ({ plaintext: `{\n  owner: ${EMPLOYER}.private,\n  amount: ${amount}u128.private,\n  _nonce: ${++minted}group.public\n}`, amount, spent: false });
  const tokens = [token(deposit)];
  return {
    calls,
    address: EMPLOYER,
    async requestRecords(program: string) {
      if (program === USDCX) return tokens.map((r) => ({ recordName: "Token", spent: r.spent, recordPlaintext: r.plaintext }));
      return program === AGREEMENT_V5 ? agreements : [];
    },
    async executeTransaction(opts: { program: string; function: string; inputs: string[]; privateFee: false }) {
      calls.push({ program: opts.program, function: opts.function, inputs: opts.inputs });
      const source = tokens.find((r) => r.plaintext === opts.inputs[2] && !r.spent)!;
      const amount = BigInt(opts.inputs[1]!.replace("u128", ""));
      source.spent = true;
      if (source.amount > amount) tokens.push(token(source.amount - amount));
      return { transactionId: `shield_${calls.length}` };
    },
    async transactionStatus(id: string) {
      return { status: "accepted", transactionId: AT(Number(id.replace("shield_", ""))) };
    },
  };
}

/** The explorer: the chain's height, an empty freeze list, and each agreement's status. */
function chain(statuses: Record<string, string>): RailNetwork {
  return {
    async fetchJson(path) {
      if (path === "block/height/latest") return 4_000_000;
      if (/freeze_list_last_index\/true$/.test(path)) return "0u32";
      if (/freeze_list_index\/0u32$/.test(path)) return "aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc";
      if (/freeze_list_root\/1u8$/.test(path)) return "0field";
      if (path in statuses) return statuses[path];
      throw new RailNetworkError("not found", 404);
    },
  };
}
const tree = {
  generateLeaves: (a: string[]) => a.map((_x, i) => `${i + 1}field`).concat("0field"),
  buildTree: (l: string[]) => l.map((_x, i) => BigInt(i)),
  getLeafIndices: () => [0, 1] as [number, number],
  getSiblingPath: (_t: bigint[], leaf_index: number, depth: number) => ({ siblings: Array<bigint>(depth).fill(0n), leaf_index }),
  formatMerkleProof: () => "[PROOF]",
};
const instant = { clock: { now: () => 0 }, sleep: async () => {}, limits: { pollMinMs: 1, confirmCapMs: 0 } };

/** One press of the pay panel: check each person, then release the run with whoever didn't pass held. */
async function press(start: ReturnType<typeof setup>, payroll: Payroll, wallet: ReturnType<typeof fakeShield>, network: RailNetwork) {
  const run = payroll.runs.find((r) => r.id === start.runId)!;
  const links = payableLinks(start.rail);
  const holds = await checkPayees({ payees: payeesToCheck(run, payableRailLinks(start.rail)), account: EMPLOYER, requestRecords: (p) => wallet.requestRecords(p), network });
  const held = new Set(holds.keys());
  const prompts = sequentialReleaser.prompts(run, links, held);
  const result = await sequentialReleaser.release({ wallet, network, run, links, held, tree, ...instant });
  return { holds, prompts, result };
}

describe("the pay run, with each agreement checked first", () => {
  it("never asks Shield to pay a held person, and pays everyone else in order", async () => {
    const start = setup();
    const [a, b, c] = start.workers.map((w) => w.id) as [string, string, string];
    // b's agreement names another account than the books; c's has ended.
    const agreements = [agreement({ version: 5, id: ID(1), worker: account(1) }), agreement({ version: 5, id: ID(2), worker: account(7) }), agreement({ version: 5, id: ID(3), worker: account(3) })];
    const network = chain({ [statusPath(5, ID(1))]: "1u8", [statusPath(5, ID(2))]: "1u8", [statusPath(5, ID(3))]: "3u8" });
    const wallet = fakeShield(centsToMinor(5_000_00n), agreements);
    const { holds, prompts, result } = await press(start, start.payroll, wallet, network);

    expect([...holds]).toEqual([
      [b, "mismatch"],
      [c, "inactive"],
    ]);
    expect(prompts.map((p) => [p.kind, p.workerId])).toEqual([
      ["payment", a],
      ["paystub", a],
    ]);
    expect(wallet.calls.map((x) => x.inputs[0])).toEqual([account(1)]);
    expect(wallet.calls.some((x) => x.inputs[0] === account(2) || x.inputs[0] === account(3) || x.inputs[0] === account(7))).toBe(false);
    expect(result.settled.map((s) => s.workerId)).toEqual([a]);
    expect(result.failed).toEqual([]);
    expect(result.stalled).toBeUndefined();
  });

  it("holds the same on Continue and Retry, and pays a person once their agreement checks out", async () => {
    const start = setup();
    const [a, b] = start.workers.map((w) => w.id) as [string, string];
    const statuses = { [statusPath(5, ID(1))]: "1u8", [statusPath(5, ID(2))]: "2u8", [statusPath(5, ID(3))]: "1u8" };
    const agreements = [1, 2, 3].map((n) => agreement({ version: 5, id: ID(n), worker: account(n) }));
    const wallet = fakeShield(centsToMinor(5_000_00n), agreements);
    // b's last try failed: a Retry checks the agreement again before asking Shield.
    let payroll = markPaycheckSettlement(start.payroll, start.runId, b, { status: "failed", failure: "Declined in Shield" });
    payroll = markPaycheckSettlement(payroll, start.runId, a, { status: "settled", reference: AT(90) });
    const first = await press(start, payroll, wallet, chain(statuses));
    expect([...first.holds]).toEqual([[b, "inactive"]]);
    expect(wallet.calls.map((x) => x.inputs[0])).toEqual([account(3)]);

    // Resumed on chain: the next press pays b.
    const paidC = markPaycheckSettlement(payroll, start.runId, start.workers[2]!.id, { status: "settled", reference: first.result.settled[0]!.transactionId });
    const second = await press(start, paidC, wallet, chain({ ...statuses, [statusPath(5, ID(2))]: "1u8" }));
    expect(second.holds.size).toBe(0);
    expect(wallet.calls.map((x) => x.inputs[0])).toEqual([account(3), account(2)]);
  });

  it("asks Shield for nobody when the agreements can't be read, and leaves a payment Shield already took to be followed", async () => {
    const start = setup();
    const [a, b, c] = start.workers.map((w) => w.id) as [string, string, string];
    const wallet = fakeShield(centsToMinor(5_000_00n), []);
    const locked = { ...wallet, requestRecords: async (program: string): Promise<unknown[]> => (program === USDCX ? wallet.requestRecords(program) : Promise.reject(new Error("Shield is locked"))) };
    const payroll = markPaycheckSettlement(start.payroll, start.runId, a, { status: "pending", reference: "shield_0" });
    const run = payroll.runs.find((r) => r.id === start.runId)!;
    // a's payment is already out: it isn't checked (nothing will be asked for it), and is followed to its end.
    expect([...payeesToCheck(run, payableRailLinks(start.rail)).keys()]).toEqual([b, c]);
    const holds = await checkPayees({ payees: payeesToCheck(run, payableRailLinks(start.rail)), account: EMPLOYER, requestRecords: locked.requestRecords, network: chain({}) });
    const result = await sequentialReleaser.release({ wallet: locked, network: chain({}), run, links: payableLinks(start.rail), held: new Set(holds.keys()), tree, ...instant });
    expect([...holds.values()]).toEqual(["unchecked", "unchecked"]);
    expect(wallet.calls).toEqual([]);
    expect(result.settled.map((s) => s.workerId)).toEqual([a]);
  });
});
