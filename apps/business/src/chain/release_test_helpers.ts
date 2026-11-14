// Shared fakes for the tests of a rail release (release_run.test.ts, run_marker.test.ts): one
// business account on a pretend chain, as each of its devices' Shield shows it, with time that
// only passes when something sleeps. No key, no network, nothing logged.
//
// What is modelled, and no more:
//   - a record is spent once: the second transaction to spend it doesn't land;
//   - a transfer spends one record whole and leaves the rest as one new record (its change);
//   - a letter to the account itself leaves a Letter (or Page) and the sender's copy;
//   - Shield lists a record a moment after its transaction is accepted, a device at a time;
//   - Shield's history lists the account's stablecoin transactions by id, and the explorer holds
//     each transaction and the time of each block;
//   - a person approves one prompt at a time on a device.
import { type Books, applyTemplate, createBooks, emptyDimensions } from "@pnw/ledger";
import { PROGRAMS } from "@pnw/config/programs";
import { type Payroll, type Settlement, type W4, addWorker, emptyPayroll, ensureRailAccount, postPayRun } from "@pnw/payroll";
import { type RailNetwork, RailNetworkError, TRANSFER_FUNCTION } from "@pnw/rail";
import { emptySales } from "@pnw/sales";
import { type VaultSession, createVault, keySlotsOf, openKeySlots } from "@pnw/vault";
import type { Company } from "../books/company";
import type { Rail } from "../books/rail";
import { LETTERS_PROGRAM, LETTER_FIELDS, PAGE_FIELDS, SEND_FUNCTION, SEND_PAGE_FUNCTION } from "./letters";

const USDCX = PROGRAMS.external.usdcx;

// ---- Time ---------------------------------------------------------------------------------

// Real work that finishes on another thread (hashing, sealing, packing) is counted while it is
// under way, so the clock never jumps ahead of something that is about to ask for a shorter wait.
let underWay = 0;
let counting = false;
function countRealWork() {
  if (counting) return;
  counting = true;
  const counted = <A extends unknown[], R>(f: (...args: A) => Promise<R>) =>
    function (this: unknown, ...args: A): Promise<R> {
      underWay++;
      return f.apply(this, args).finally(() => void underWay--);
    };
  const subtle = globalThis.crypto.subtle as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  for (const name of ["digest", "encrypt", "decrypt", "importKey", "exportKey", "deriveKey", "deriveBits", "generateKey", "wrapKey", "unwrapKey", "sign", "verify"]) {
    const real = subtle[name];
    if (typeof real === "function") subtle[name] = counted(real.bind(subtle));
  }
  const response = Response.prototype as unknown as { arrayBuffer: () => Promise<ArrayBuffer> };
  response.arrayBuffer = counted(response.arrayBuffer);
}

/**
 * Time that passes only when something sleeps. `run` drives a promise to its end: whenever nothing
 * is left to do but wait, the clock jumps to the next sleeper.
 */
export class VirtualTime {
  now = Date.parse("2026-11-13T12:00:00.000Z");
  private timers: { at: number; seq: number; resolve: () => void }[] = [];
  private seq = 0;
  readonly clock = { now: () => this.now };
  readonly sleep = (ms: number) => new Promise<void>((resolve) => this.timers.push({ at: this.now + Math.max(0, ms), seq: this.seq++, resolve }));

  constructor() {
    countRealWork();
  }

  async run<T>(work: Promise<T>): Promise<T> {
    let done = false;
    let value: T | undefined;
    let error: unknown;
    let failed = false;
    work.then(
      (v) => ((done = true), (value = v)),
      (e) => ((done = true), (failed = true), (error = e)),
    );
    let idle = 0;
    while (!done) {
      // Let everything that can go on without waiting go on.
      for (let quiet = 0; quiet < 3 && !done; ) {
        await new Promise((r) => setImmediate(r));
        quiet = underWay > 0 ? 0 : quiet + 1;
      }
      if (done) break;
      if (this.timers.length === 0) {
        await new Promise((r) => setTimeout(r, 1));
        if (++idle > 3000) throw new Error("virtual time: nothing left to wait for");
        continue;
      }
      idle = 0;
      this.timers.sort((a, b) => a.at - b.at || a.seq - b.seq);
      const next = this.timers.shift()!;
      this.now = Math.max(this.now, next.at);
      next.resolve();
    }
    if (failed) throw error;
    return value as T;
  }
}

// ---- The account on the chain -------------------------------------------------------------

export const EMPLOYER = "aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n";
export const account = (n: number) => `aleo1${"qpzry9x8gf2tvdw0s3jn54khce6mua7l"[n % 32]!.repeat(58)}`;

const BASE_HEIGHT = 4_000_000;
const BLOCK_MS = 5_000;

type Token = { plaintext: string; amount: bigint; chainTag: string; spent: boolean; from: string | null; height: number; at: number };
type LetterRecord = { recordName: "Letter" | "Page" | "SentLetter"; recordPlaintext: string; blockHeight: number; transactionId: string; at: number };
export type ChainTx = { id: string; height: number; at: number; fn: string; to?: string; minor?: bigint; spends: string[] };
type Call = { program: string; function: string; inputs: string[] };

/** What Shield does with one request. */
export type Behaviour =
  /** Approved, accepted a block or two later. */
  | "ok"
  /** The person turns it down: Shield throws, nothing moves. */
  | "declined"
  /** The prompt is left until it expires: nothing moves. */
  | "expired"
  /** The device stops here: the request never comes back and nothing moves. */
  | "lost"
  /** It reaches the chain, and Shield's call throws all the same. */
  | "landed, then threw"
  /** Shield takes it and then says it failed; it reaches the chain `landsAfterMs` after the approval. */
  | { saysFailed: true; landsAfterMs: number };

export class Chain {
  readonly tokens: Token[] = [];
  readonly letters: LetterRecord[] = [];
  /** Every accepted transaction, in the order it was accepted. */
  readonly txs: ChainTx[] = [];
  /** Every path asked of the explorer. */
  readonly asked: string[] = [];
  /** Whether Shield's record list carries the chain's own tag for a record, and the transaction that made it. */
  showTags = true;
  showOrigins = true;
  private minted = 0;
  private count = 0;
  private readonly t0: number;

  constructor(
    readonly vt: VirtualTime,
    deposits: bigint[],
    readonly address = EMPLOYER,
  ) {
    this.t0 = vt.now;
    for (const amount of deposits) this.mint(amount, null, -60_000);
  }

  height(at = this.vt.now): number {
    return BASE_HEIGHT + Math.max(0, Math.floor((at - this.t0) / BLOCK_MS));
  }

  private mint(amount: bigint, from: string | null, at = this.vt.now) {
    const n = ++this.minted;
    this.tokens.push({ plaintext: `{\n  owner: ${this.address}.private,\n  amount: ${amount}u128.private,\n  _nonce: ${n}group.public\n}`, amount, chainTag: `${7_000_000 + n}field`, spent: false, from, height: this.height(at), at });
  }

  private accept(tx: Omit<ChainTx, "id" | "height" | "at">): ChainTx {
    const id = `at1${String(++this.count).padStart(4, "0")}`.padEnd(61, "q");
    const accepted = { ...tx, id, height: this.height(), at: this.vt.now };
    this.txs.push(accepted);
    return accepted;
  }

  /** Money arriving in the account: a new record. */
  deposit(amount: bigint) {
    this.mint(amount, this.accept({ fn: "transfer_private", spends: [] }).id);
  }

  /** Shield combining the account's records on its own: every unspent one goes into a single new record. */
  combine() {
    const open = this.tokens.filter((t) => !t.spent);
    if (open.length < 2) return;
    for (const t of open) t.spent = true;
    this.mint(open.reduce((sum, t) => sum + t.amount, 0n), this.accept({ fn: "join", spends: open.map((t) => t.chainTag) }).id);
  }

  /** A payment made in Shield itself, outside this app. */
  payByHand(to: string, minor: bigint) {
    const source = this.tokens.find((t) => !t.spent && t.amount >= minor)!;
    source.spent = true;
    const tx = this.accept({ fn: TRANSFER_FUNCTION, to, minor, spends: [source.chainTag] });
    if (source.amount > minor) this.mint(source.amount - minor, tx.id);
  }

  /** The chain taking one request. Null when it doesn't land (its record was already spent). */
  land(call: Call): ChainTx | null {
    if (call.program === USDCX && call.function === TRANSFER_FUNCTION) {
      const source = this.tokens.find((t) => t.plaintext === call.inputs[2]);
      const minor = BigInt(call.inputs[1]!.replace("u128", ""));
      if (!source || source.spent || source.amount < minor) return null;
      source.spent = true;
      const tx = this.accept({ fn: TRANSFER_FUNCTION, to: call.inputs[0]!, minor, spends: [source.chainTag] });
      if (source.amount > minor) this.mint(source.amount - minor, tx.id);
      return tx;
    }
    if (call.program === LETTERS_PROGRAM && (call.function === SEND_FUNCTION || call.function === SEND_PAGE_FUNCTION)) {
      const page = call.function === SEND_PAGE_FUNCTION;
      const tx = this.accept({ fn: call.function, spends: [] });
      const halves = [...call.inputs[1]!.matchAll(/(\d+)u128/g)].map((m) => m[1]!);
      const fields = [...call.inputs[2]!.matchAll(/(\d+)field/g)].map((m) => m[1]!);
      if (fields.length !== (page ? PAGE_FIELDS : LETTER_FIELDS)) throw new Error("the fake chain was sent a parcel of the wrong size");
      const record = (owner: string, list: string) =>
        `{\n  owner: ${owner}.private,\n  lookup: [\n    ${halves[0]}u128.private,\n    ${halves[1]}u128.private\n  ],\n  ${list}: [\n${fields.map((f) => `    ${f}field.private`).join(",\n")}\n  ],\n  _nonce: ${7 + this.letters.length}group.public,\n  _version: 1u8.public\n}`;
      const base = { blockHeight: tx.height, transactionId: tx.id, at: this.vt.now };
      // Only letters to the account itself are kept: nobody else's records are listed here.
      if (call.inputs[0] === this.address) this.letters.push({ recordName: page ? "Page" : "Letter", recordPlaintext: record(this.address, page ? "page" : "parcel"), ...base });
      if (!page) this.letters.push({ recordName: "SentLetter", recordPlaintext: record(this.address, "parcel"), ...base });
      return tx;
    }
    throw new Error(`the fake chain doesn't know ${call.program}/${call.function}`);
  }

  /** Every payment that reached `to`, as the chain holds them. */
  paid(to: string): ChainTx[] {
    return this.txs.filter((t) => t.fn === TRANSFER_FUNCTION && t.to === to);
  }

  /** The explorer. */
  readonly network: RailNetwork = {
    fetchJson: async (path) => {
      this.asked.push(path);
      if (path === "block/height/latest") return this.height();
      if (/freeze_list_count/.test(path)) return "0u32";
      const block = /^block\/(?:ab1block)?(\d+)$/.exec(path);
      if (block) {
        const height = Number(block[1]);
        if (height > this.height()) throw new RailNetworkError("not found", 404);
        return { header: { metadata: { height, timestamp: Math.floor((this.t0 + (height - BASE_HEIGHT) * BLOCK_MS) / 1000) } } };
      }
      const hash = /^find\/blockHash\/(at1\w+)$/.exec(path);
      if (hash) {
        const tx = this.txs.find((t) => t.id === hash[1]);
        if (!tx) throw new RailNetworkError("not found", 404);
        return `ab1block${tx.height}`;
      }
      const one = /^transaction\/(confirmed\/)?(at1\w+)$/.exec(path);
      const tx = one ? this.txs.find((t) => t.id === one[2]) : undefined;
      if (!tx) throw new RailNetworkError("not found", 404);
      const transition = {
        program: tx.fn.startsWith("send") ? LETTERS_PROGRAM : USDCX,
        function: tx.fn,
        inputs: [{ type: "private", value: "ciphertext1a" }, { type: "private", value: "ciphertext1b" }, ...tx.spends.map((tag) => ({ type: "record", id: "1field", tag })), { type: "private", value: "ciphertext1c" }],
        outputs: [],
      };
      const fee = { transition: { program: "credits.aleo", function: "fee_public", inputs: [{ type: "public", value: "51580u64" }, { type: "public", value: "0u64" }] } };
      const transaction = { type: "execute", id: tx.id, execution: { transitions: [transition] }, fee };
      return one![1] ? { type: "execute", status: "accepted", index: 0, transaction, finalize: [], block_height: tx.height } : { ...transaction, block_height: tx.height };
    },
  };

  /** Opens a transfer this account sent, the way the SDK does with Shield's transition view key. */
  readonly decrypt = async (transition: unknown, tvk: string): Promise<unknown> => {
    const tx = this.txs.find((t) => `tvk:${t.id}` === tvk);
    if (!tx || tx.to === undefined) throw new Error("that key opens nothing");
    return { ...(transition as object), inputs: [{ type: "private", value: `${tx.to}.private` }, { type: "private", value: `${tx.minor}u128.private` }, { type: "record" }, { type: "private", value: "{ siblings: [ 0field ] }" }] };
  };

  /** One device's Shield, signed in to this account. */
  shield(options: { lagMs?: number; approveMs?: number; landMs?: number } = {}): Shield {
    return new Shield(this, options);
  }
}

/** The account as one device's Shield shows it and signs for it. */
export class Shield {
  readonly address: string;
  /** Every request it was asked to sign, in order. */
  readonly calls: Call[] = [];
  /** Every other thing it was asked, by name. */
  readonly asked: string[] = [];
  /** How many prompts the person approved on this device. */
  approvals = 0;
  /** What it does with the nth request (0-based). */
  behaviour: (call: Call, n: number) => Behaviour = () => "ok";
  /** How long after a block this device lists what the block held. */
  lagMs: number;
  /** Whether its history lists the account's transfers (every device's, as far as is known). */
  listsHistory = true;
  private readonly approveMs: number;
  private readonly landMs: number;
  private readonly status = new Map<string, { status: string; transactionId?: string; error?: string }>();
  private person: Promise<void> = Promise.resolve();
  private static made = 0;
  private readonly name = `d${++Shield.made}`;

  constructor(
    private readonly chain: Chain,
    options: { lagMs?: number; approveMs?: number; landMs?: number },
  ) {
    this.address = chain.address;
    this.lagMs = options.lagMs ?? 1_000;
    this.approveMs = options.approveMs ?? 8_000;
    this.landMs = options.landMs ?? 14_000;
  }

  private get vt() {
    return this.chain.vt;
  }

  async requestRecords(program: string, _includePlaintext?: boolean): Promise<unknown[]> {
    this.asked.push(`records ${program}`);
    const listed = (at: number) => at + this.lagMs <= this.vt.now;
    if (program === USDCX) {
      return this.chain.tokens
        .filter((t) => listed(t.at))
        .map((t) => ({
          recordName: "Token",
          spent: t.spent,
          recordPlaintext: t.plaintext,
          blockHeight: t.height,
          ...(this.chain.showTags ? { tag: t.chainTag } : {}),
          ...(this.chain.showOrigins && t.from ? { transactionId: t.from } : {}),
        }));
    }
    if (program !== LETTERS_PROGRAM) return [];
    return this.chain.letters.filter((l) => listed(l.at)).map(({ at: _at, ...l }) => ({ ...l, spent: false, sender: this.address }));
  }

  async requestTransactionHistory(program: string): Promise<{ transactions?: unknown }> {
    this.asked.push(`history ${program}`);
    if (program !== USDCX || !this.listsHistory) return { transactions: [] };
    // Only the id is right: nothing else in a history entry is to be believed.
    return { transactions: this.chain.txs.filter((t) => !t.fn.startsWith("send")).map((t) => ({ transactionId: t.id, transactionStatus: "failed", functionId: "join", blockHeight: 1 })) };
  }

  async transitionViewKeys(id: string): Promise<string[]> {
    this.asked.push("view keys");
    return this.chain.txs.some((t) => t.id === id && t.to !== undefined) ? [`tvk:${id}`] : [];
  }

  async executeTransaction(opts: Call & { privateFee: false }): Promise<{ transactionId: string }> {
    const call = { program: opts.program, function: opts.function, inputs: opts.inputs };
    const n = this.calls.length;
    this.calls.push(call);
    const does = this.behaviour(call, n);
    if (does === "lost") return new Promise(() => {});
    // One person, one prompt at a time.
    const turn = this.person.then(() => this.vt.sleep(does === "expired" ? 300_000 : this.approveMs));
    this.person = turn;
    await turn;
    if (does === "declined") throw new Error("User rejected the request");
    if (does === "expired") throw new Error("Approval expired. Request a fresh action.");
    this.approvals++;
    const id = `shield_${this.name}_${n}`;
    const land = () => {
      const tx = this.chain.land(call);
      return tx ? { status: "accepted", transactionId: tx.id } : { status: "rejected", error: "The network rejected it: an input was already spent" };
    };
    if (does === "landed, then threw") {
      await this.vt.sleep(this.landMs);
      land();
      throw new Error("Failed to send transaction: it already exists in the ledger");
    }
    if (typeof does === "object") {
      this.status.set(id, { status: "failed" });
      void this.vt.sleep(does.landsAfterMs).then(land);
      return { transactionId: id };
    }
    this.status.set(id, { status: "pending" });
    void this.vt.sleep(this.landMs).then(() => this.status.set(id, land()));
    return { transactionId: id };
  }

  async transactionStatus(id: string): Promise<{ status: string; transactionId?: string; error?: string }> {
    const status = this.status.get(id);
    if (!status) throw new Error("not found");
    return status;
  }

  /** The stablecoin requests among `calls`. */
  get payments(): Call[] {
    return this.calls.filter((c) => c.program === USDCX);
  }

  /** The letters among `calls`. */
  get lettersSent(): Call[] {
    return this.calls.filter((c) => c.program === LETTERS_PROGRAM);
  }
}

/** The Merkle tree seam of the freeze-list proof. */
export const tree = {
  generateLeaves: (a: string[]) => a.map((_x, i) => `${i + 1}field`).concat("0field"),
  buildTree: (l: string[]) => l.map((_x, i) => BigInt(i)),
  getLeafIndices: () => [0, 1] as [number, number],
  getSiblingPath: (_t: bigint[], leaf_index: number, depth: number) => ({ siblings: Array<bigint>(depth).fill(0n), leaf_index }),
  formatMerkleProof: () => "[PROOF]",
};

// ---- The books on a device ------------------------------------------------------------------

const W4_SINGLE: W4 = { filingStatus: "single", dependentCredit: 0n, otherIncome: 0n, extraDeductions: 0n, extraWithholding: 0n };
export const USERNAME = "alder";
const SECRET = "hewn:v1\nalder\ncorrect horse battery staple";
const KEY = (n: number) => n.toString(16).padStart(2, "0").repeat(32);

/** Books with a posted rail run for `n` hourly people, each paid a different amount to an account of their own. */
export function postedRun(n: number, period: { payDate: string; periodStart: string; periodEnd: string } = { payDate: "2026-11-13", periodStart: "2026-11-07", periodEnd: "2026-11-13" }) {
  let books: Books = applyTemplate(createBooks({ businessName: "Day Construction", fiscalYearStartMonth: 1 }), "service");
  const rail = ensureRailAccount(books);
  books = rail.books;
  let payroll: Payroll = emptyPayroll();
  const workers = Array.from({ length: n }, (_x, i) => {
    const added = addWorker(payroll, { name: `Worker ${i + 1}`, payType: "hourly", rate: 3000n, frequency: "weekly", w4: W4_SINGLE });
    payroll = added.payroll;
    return added.worker.id;
  });
  const posted = postPayRun(books, payroll, { ...period, bankAccountId: rail.accountId, mode: "rail", lines: workers.map((workerId, i) => ({ workerId, hours: 20 + i })) }, { now: () => "2026-11-13T12:00:00.000Z" });
  const links = workers.map((workerId, i) => ({ workerId, address: account(i + 1), nameHash: `${i + 1}`, agreementId: KEY(i + 1).slice(0, 8), status: "linked" as const, partiesKey: KEY(i + 1) }));
  const company: Company = {
    books: posted.books,
    payroll: posted.payroll,
    sales: emptySales(),
    dimensions: emptyDimensions(),
    rail: { version: 1, network: "testnet", address: EMPLOYER, linkedAt: "2026-11-13T12:00:00.000Z", links } satisfies Rail,
  };
  return { company, runId: posted.run.id, workers, links: new Map(links.map((l) => [l.workerId, l.address])) };
}

/** The books as one device holds them: every change is applied in turn, as the provider does. */
export class Device {
  company: Company;
  /** Every settlement written to each paycheck of the first run, in order: what the vault was told. */
  readonly writes: { workerId: string; settlement: Settlement }[] = [];

  constructor(
    company: Company,
    readonly session: VaultSession,
  ) {
    this.company = structuredClone(company);
  }

  readonly updateCompany = async (op: (company: Company) => Company): Promise<Company> => {
    const before = this.company;
    this.company = op(before);
    const was = new Map(before.payroll.runs.flatMap((r) => r.paychecks.map((p) => [`${r.id}/${p.workerId}`, p.settlement] as const)));
    for (const r of this.company.payroll.runs) for (const p of r.paychecks) if (was.get(`${r.id}/${p.workerId}`) !== p.settlement) this.writes.push({ workerId: p.workerId, settlement: p.settlement });
    return this.company;
  };

  /** Where each paycheck of the first run stands. */
  get settlements(): Settlement[] {
    return this.company.payroll.runs[0]!.paychecks.map((p) => p.settlement);
  }

  /** A second device restored from these books as they stand now: the same key, its own copy. */
  async restored(company: Company = this.company): Promise<Device> {
    return new Device(company, await openKeySlots(keySlotsOf(this.session.record), SECRET));
  }
}

/** The first device of an account: new books under a new key. */
export async function firstDevice(company: Company): Promise<Device> {
  return new Device(company, await createVault(SECRET, "{}", { id: "acct-release", iterations: 1000 }));
}
