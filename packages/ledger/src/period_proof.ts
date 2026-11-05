// ---------------------------------------------------------------------------
// The period proof (docs/AUDIT_DESIGN.md §4, "a whole period"; docs/CLOSE_PERIOD.md): one file
// that lets an accountant or auditor recompute a closed range's anchored root from every entry
// in it, so nothing can be missing or changed.
//
// It carries each entry in full with its salt, each settlement with its two salts, the business
// tag, the previous root, and the history of the range's closes. It never carries the anchor
// secret: only the salts the root needs, which open nothing else. The accounts' names ride
// along for reading and are not part of any hash.
//
// `checkPeriodProof` is the offline half of the verifier: every entry's hash recomputes from its
// contents, every entry is dated in the range and in journal order, the counts and the chain
// head are right, and the leaves and root recompute to the root the file claims. The chain half
// (that the root is anchored, and when) is the app's, which reads the network.
//
// Pure: no storage, no network, no randomness.
// ---------------------------------------------------------------------------

import type { Account } from "./accounts";
import type { Entry, Line } from "./books";
import { fail } from "./errors";
import { GENESIS_HASH, hashEntry } from "./hash";
import {
  type PeriodRootInput,
  type SettlementLink,
  businessTag,
  entryLeafFromSalt,
  entrySalt,
  merkleRoot,
  periodRoot,
  rootFromParts,
  settlementLeafFromSalts,
  settlementSalt,
} from "./period_root";
import { assertDate } from "./periods";

export const PROOF_FORMAT = "hewn-period-proof";

const HEX64 = /^[0-9a-f]{64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ZERO = "0".repeat(64);

/** A line with its amounts as decimal strings (cents), since JSON has no bigint. */
export type ProofLine = Omit<Line, "debit" | "credit"> & { debit: string; credit: string };
export type ProofEntry = Omit<Entry, "lines"> & { lines: ProofLine[]; salt: string };
export type ProofSettlement = SettlementLink & { entrySalt: string; settleSalt: string };

/** One close of a range overlapping this one: the standing close, and any a reopen undid. */
export type ProofClose = { start: string; end: string; root: string; closedAt: string; anchorTx?: string; reopenedAt?: string };

export type PeriodProof = {
  format: typeof PROOF_FORMAT;
  version: 1;
  /** For reading only; not part of the root. */
  business: string;
  madeAt: string;
  start: string;
  end: string;
  root: string;
  prevRoot: string;
  businessTag: string;
  entries: ProofEntry[];
  settlements: ProofSettlement[];
  /** For reading only: the accounts the entries' lines name. */
  accounts: Pick<Account, "id" | "name" | "number" | "type">[];
  /** Every close of this range or one overlapping it, newest first. */
  closes: ProofClose[];
};

export type PeriodProofInput = PeriodRootInput & {
  business: string;
  madeAt: string;
  accounts: readonly Account[];
  closes: readonly ProofClose[];
};

const lineOut = (l: Line): ProofLine => ({ ...l, debit: l.debit.toString(), credit: l.credit.toString() });
const lineIn = (l: ProofLine): Line => ({ ...l, debit: BigInt(l.debit), credit: BigInt(l.credit) });

/** The proof of a range, from the books' own secret; refuses unless it recomputes to `expectRoot` when given. */
export function buildPeriodProof(input: PeriodProofInput, expectRoot?: string): PeriodProof {
  const r = periodRoot(input);
  if (expectRoot !== undefined && r.root !== expectRoot) {
    fail("BAD_PROOF", "The books no longer give the root that was closed; this range changed after closing");
  }
  const used = new Set(input.entries.flatMap((e) => e.lines.map((l) => l.accountId)));
  return {
    format: PROOF_FORMAT,
    version: 1,
    business: input.business,
    madeAt: input.madeAt,
    start: input.start,
    end: input.end,
    root: r.root,
    prevRoot: input.prevRoot ?? ZERO,
    businessTag: businessTag(input.anchorSecret),
    entries: input.entries.map((e) => ({ ...e, lines: e.lines.map(lineOut), salt: entrySalt(input.anchorSecret, e.hash) })),
    settlements: input.settlements.map((s) => ({
      ...s,
      entrySalt: entrySalt(input.anchorSecret, s.entryHash),
      settleSalt: settlementSalt(input.anchorSecret, s.entryHash, s.txId),
    })),
    accounts: input.accounts
      .filter((a) => used.has(a.id))
      .map((a) => ({ id: a.id, name: a.name, type: a.type, ...(a.number ? { number: a.number } : {}) })),
    closes: [...input.closes],
  };
}

export const periodProofToJson = (proof: PeriodProof): string => JSON.stringify(proof, null, 2);

const isStr = (v: unknown): v is string => typeof v === "string";
const isHex = (v: unknown): v is string => isStr(v) && HEX64.test(v);

/** Parses a proof file and checks its shape; throws on anything that isn't one. */
export function readPeriodProof(text: string): PeriodProof {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    fail("BAD_PROOF", "This file isn't a period proof: it isn't valid JSON");
  }
  const p = raw as Record<string, unknown> | null;
  if (!p || p.format !== PROOF_FORMAT) fail("BAD_PROOF", "This file isn't a period proof from this app");
  if (p.version !== 1) fail("BAD_PROOF", "This proof is from a newer version of the app");
  if (!isStr(p.start) || !DATE.test(p.start) || !isStr(p.end) || !DATE.test(p.end) || p.start > p.end) fail("BAD_PROOF", "The proof's range is damaged");
  for (const k of ["root", "prevRoot", "businessTag"] as const) if (!isHex(p[k])) fail("BAD_PROOF", `The proof's ${k} is damaged`);
  if (!Array.isArray(p.entries) || !Array.isArray(p.settlements) || !Array.isArray(p.closes) || !Array.isArray(p.accounts)) {
    fail("BAD_PROOF", "The proof is missing its entries, settlements or closes");
  }
  for (const e of p.entries as unknown[]) {
    const x = e as Record<string, unknown> | null;
    if (!x || !isHex(x.hash) || !isHex(x.prevHash) || !isHex(x.salt) || !Number.isInteger(x.seq) || !isStr(x.date) || !Array.isArray(x.lines)) {
      fail("BAD_PROOF", "An entry in the proof is damaged");
    }
    for (const l of x.lines as unknown[]) {
      const y = l as Record<string, unknown> | null;
      if (!y || !isStr(y.accountId) || !isStr(y.debit) || !/^\d+$/.test(y.debit) || !isStr(y.credit) || !/^\d+$/.test(y.credit)) {
        fail("BAD_PROOF", `A line of entry ${String(x.id)} is damaged`);
      }
    }
  }
  for (const s of p.settlements as unknown[]) {
    const x = s as Record<string, unknown> | null;
    if (!x || !isHex(x.entryHash) || !isStr(x.txId) || !isStr(x.recipient) || !isHex(x.entrySalt) || !isHex(x.settleSalt)) {
      fail("BAD_PROOF", "A settlement in the proof is damaged");
    }
  }
  for (const c of p.closes as unknown[]) {
    const x = c as Record<string, unknown> | null;
    if (!x || !isHex(x.root) || !isStr(x.start) || !isStr(x.end) || !isStr(x.closedAt)) fail("BAD_PROOF", "A close in the proof is damaged");
  }
  return raw as PeriodProof;
}

export type ProofCheck = { id: "entries" | "range" | "order" | "root"; ok: boolean; label: string; detail?: string };

/**
 * The offline checks of a period proof. `root` is the recomputed root when every check passes,
 * else null; the chain check (is it anchored, when) is the caller's.
 */
export function checkPeriodProof(proof: PeriodProof): { root: string | null; checks: ProofCheck[]; entries: number; payments: number } {
  const checks: ProofCheck[] = [];
  const start = assertDate(proof.start);
  const end = assertDate(proof.end);

  const altered = proof.entries.filter((e) => {
    const { salt: _salt, hash, lines, ...rest } = e;
    try {
      return hashEntry({ ...rest, lines: lines.map(lineIn) }) !== hash;
    } catch {
      return true;
    }
  });
  checks.push({
    id: "entries",
    ok: altered.length === 0,
    label: "Every entry is exactly as it was posted",
    ...(altered.length ? { detail: `${altered.length === 1 ? "1 entry doesn't hash to its recorded hash" : `${altered.length} entries don't hash to their recorded hashes`} (first: ${altered[0]!.id})` } : {}),
  });

  const outside = proof.entries.filter((e) => e.date < start || e.date > end);
  checks.push({
    id: "range",
    ok: outside.length === 0,
    label: "Every entry is dated in the range",
    ...(outside.length ? { detail: `${outside.length} dated outside the range (first: ${outside[0]!.id}, ${outside[0]!.date})` } : {}),
  });

  const ordered = proof.entries.every((e, i) => i === 0 || e.seq > proof.entries[i - 1]!.seq);
  checks.push({ id: "order", ok: ordered, label: "The entries are in journal order, each once", ...(ordered ? {} : { detail: "An entry is out of order or repeated" }) });

  let recomputed: string | null = null;
  let rootDetail: string | undefined;
  try {
    const entriesRoot = merkleRoot(proof.entries.map((e) => entryLeafFromSalt(e.salt, e.hash)));
    const settlementsRoot = merkleRoot(proof.settlements.map((s) => settlementLeafFromSalts(s.entrySalt, s.settleSalt, s)));
    recomputed = rootFromParts({
      businessTag: proof.businessTag,
      periodId: `${start}..${end}`,
      n: proof.entries.length,
      m: proof.settlements.length,
      prevRoot: proof.prevRoot,
      chainHead: proof.entries.at(-1)?.hash ?? GENESIS_HASH,
      entriesRoot,
      settlementsRoot,
    });
    if (recomputed !== proof.root) rootDetail = "The entries and payments give a different root: something was added, removed or changed";
  } catch (e) {
    rootDetail = e instanceof Error ? e.message : "The root couldn't be recomputed";
  }
  const offlineOk = checks.every((c) => c.ok) && rootDetail === undefined;
  checks.push({ id: "root", ok: rootDetail === undefined, label: "Everything recomputes to the period's root", ...(rootDetail ? { detail: rootDetail } : {}) });
  return { root: offlineOk ? recomputed : null, checks, entries: proof.entries.length, payments: proof.settlements.length };
}
