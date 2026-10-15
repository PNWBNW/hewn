// ---------------------------------------------------------------------------
// A read-only check of what Shield can tell us about the account's past:
// its records, its transaction history, and whether a past transfer can be
// opened (decrypted) far enough to read what it was. It answers one question
// before the "For review" list is built: can the books fill themselves from
// the wallet?
//
// The report is shapes and counts only: field names, function names, how
// many inputs could be read. No address, amount, record or transaction id
// is put in it, so it can be copied into a chat safely. Nothing is posted,
// stored or logged.
//
// Pure apart from the injected wallet, explorer and decrypt.
// ---------------------------------------------------------------------------

import { CREDITS_PROGRAM, USDCX_PROGRAM } from "./balances";

export const PROBE_PROGRAMS = [USDCX_PROGRAM, CREDITS_PROGRAM] as const;
/** How many past transfers are opened. */
export const PROBE_SAMPLES = 4;

export type ProbeWallet = {
  requestRecords(program: string, includePlaintext?: boolean): Promise<unknown[]>;
  requestTransactionHistory(program: string): Promise<{ transactions?: unknown }>;
  transitionViewKeys(transactionId: string): Promise<string[]>;
};

/** What decrypting one transition with one view key could read. */
export type Opened = { inputs: number; inputsRead: number; outputs: number; outputsRead: number; amountFound: boolean };

export type ProbeDeps = {
  wallet: ProbeWallet;
  /** The explorer's `transaction/<id>`; null when it doesn't know the id. */
  fetchTransaction(id: string): Promise<unknown>;
  /** Decrypts a transition (the explorer's JSON for it) with a transition view key. */
  open(transition: unknown, tvk: string): Promise<Opened>;
};

type Outcome<T> = { ok: true; value: T } | { ok: false; error: string };

export type RecordsCheck = { count: number; spent: number; fields: string[]; withTransactionId: number };
/** One history entry as the report shows it: when, which function, whether it went through. No id. */
export type HistoryLine = { date: string; fn: string; status: string };
export type HistoryCheck = { count: number; fields: string[]; newest: HistoryLine[] };
export type SampleCheck = {
  /** Where the id came from: the history list, or a record (a payment received, say). */
  from: "history" | "record";
  viewKeys: Outcome<number>;
  explorer: Outcome<{ transitions: string[] }>;
  /** One line per transition: what decrypting it read. */
  opened: { transition: string; result: Outcome<Opened> }[];
};

export type ProbeReport = {
  records: Record<string, Outcome<RecordsCheck>>;
  history: Record<string, Outcome<HistoryCheck>>;
  /** USDCx transactions behind the records that the history list doesn't have. */
  recordsNotInHistory: number | null;
  samples: SampleCheck[];
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

const message = (e: unknown): string => (e instanceof Error ? e.message : typeof e === "string" ? e : "failed").slice(0, 160);

async function attempt<T>(f: () => Promise<T>): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await f() };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

const fieldsOf = (items: readonly unknown[]): string[] => [...new Set(items.filter(isObj).flatMap((o) => Object.keys(o)))].sort();

const TX_KEYS = ["transactionId", "transaction_id", "txId", "id"] as const;

/** The transaction id a history entry or a record carries, if any. */
export function transactionIdOf(v: unknown, keys: readonly string[] = TX_KEYS): string | null {
  if (typeof v === "string") return v.startsWith("at1") ? v : null;
  if (!isObj(v)) return null;
  for (const k of keys) {
    const x = v[k];
    if (typeof x === "string" && x.startsWith("at1")) return x;
  }
  return null;
}

/** The transitions inside whatever the explorer returned for a transaction. */
export function transitionsOf(doc: unknown): Obj[] {
  const tx = isObj(doc) && isObj(doc.transaction) ? doc.transaction : doc;
  if (!isObj(tx)) return [];
  const execution = isObj(tx.execution) ? tx.execution : null;
  const list = execution && Array.isArray(execution.transitions) ? execution.transitions.filter(isObj) : [];
  const fee = isObj(tx.fee) && isObj(tx.fee.transition) ? [tx.fee.transition] : [];
  return [...list, ...fee];
}

/** How many history entries the report lists, newest first. */
export const PROBE_HISTORY_LINES = 10;

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** A block timestamp (seconds or milliseconds since 1970, or an ISO string) as YYYY-MM-DD, or "?". */
export function dateOf(v: unknown): string {
  const ms = millis(v);
  return ms === null ? "?" : new Date(ms).toISOString().slice(0, 10);
}

/** A timestamp (seconds or milliseconds since 1970, or an ISO string) in milliseconds, or null. */
function millis(v: unknown): number | null {
  const n = num(v);
  const ms = n === null ? (typeof v === "string" ? Date.parse(v) : NaN) : n < 1e12 ? n * 1000 : n;
  return Number.isFinite(ms) ? ms : null;
}

/** Newest first: by block height, then by timestamp; entries with neither keep their order, last. */
export function newestFirst<T>(items: readonly T[]): T[] {
  const NONE = -Infinity;
  const keyed = items.map((x, i) => {
    const o: Obj = isObj(x) ? x : {};
    return { x, i, height: num(o.blockNumber) ?? num(o.blockHeight) ?? NONE, time: millis(o.blockTimestamp) ?? NONE };
  });
  keyed.sort((a, b) => (a.height !== b.height ? b.height - a.height : a.time !== b.time ? b.time - a.time : a.i - b.i));
  return keyed.map((k) => k.x);
}

function historyLine(e: unknown): HistoryLine {
  const o: Obj = isObj(e) ? e : {};
  const str = (v: unknown) => (typeof v === "string" && v ? v : "?");
  return { date: dateOf(o.blockTimestamp), fn: str(o.functionId), status: str(o.transactionStatus) };
}

const label = (t: Obj): string => `${typeof t.program === "string" ? t.program : "?"}/${typeof t.function === "string" ? t.function : "?"}`;

/** Opens one transition with each view key until one works. */
async function openTransition(t: Obj, tvks: readonly string[], open: ProbeDeps["open"]): Promise<Outcome<Opened>> {
  if (tvks.length === 0) return { ok: false, error: "no view keys" };
  let last = "failed";
  for (const tvk of tvks) {
    try {
      return { ok: true, value: await open(t, tvk) };
    } catch (e) {
      last = message(e);
    }
  }
  return { ok: false, error: last };
}

async function sample(id: string, from: SampleCheck["from"], deps: ProbeDeps): Promise<SampleCheck> {
  const keys = await attempt(() => deps.wallet.transitionViewKeys(id));
  const doc = await attempt(() => deps.fetchTransaction(id));
  const transitions = doc.ok ? transitionsOf(doc.value) : [];
  const explorer: SampleCheck["explorer"] = !doc.ok
    ? doc
    : doc.value === null
      ? { ok: false, error: "not on the explorer" }
      : { ok: true, value: { transitions: transitions.map(label) } };
  const tvks = keys.ok ? keys.value.filter((k): k is string => typeof k === "string") : [];
  const opened = [];
  for (const t of transitions) opened.push({ transition: label(t), result: await openTransition(t, tvks, deps.open) });
  return { from, viewKeys: keys.ok ? { ok: true, value: tvks.length } : keys, explorer, opened };
}

export async function runProbe(deps: ProbeDeps): Promise<ProbeReport> {
  const records: ProbeReport["records"] = {};
  const history: ProbeReport["history"] = {};
  const recordIds = new Map<string, string[]>();
  const historyIds = new Map<string, string[]>();

  for (const program of PROBE_PROGRAMS) {
    const raw = await attempt(() => deps.wallet.requestRecords(program, true));
    if (raw.ok) {
      const list = Array.isArray(raw.value) ? raw.value : [];
      const ids = newestFirst(list).map((r) => transactionIdOf(r, ["transactionId", "transaction_id", "txId"])).filter((x): x is string => x !== null);
      recordIds.set(program, ids);
      records[program] = {
        ok: true,
        value: { count: list.length, spent: list.filter((r) => isObj(r) && r.spent === true).length, fields: fieldsOf(list), withTransactionId: ids.length },
      };
    } else records[program] = raw;

    const h = await attempt(() => deps.wallet.requestTransactionHistory(program));
    if (h.ok) {
      const list = newestFirst(Array.isArray(h.value?.transactions) ? h.value.transactions : []);
      historyIds.set(program, list.map((e) => transactionIdOf(e)).filter((x): x is string => x !== null));
      history[program] = { ok: true, value: { count: list.length, fields: fieldsOf(list), newest: list.slice(0, PROBE_HISTORY_LINES).map(historyLine) } };
    } else history[program] = h;
  }

  const fromHistory = historyIds.get(USDCX_PROGRAM) ?? [];
  const fromRecords = recordIds.get(USDCX_PROGRAM) ?? []; // newest first, like the history
  const inHistory = new Set(fromHistory);
  const notInHistory = [...new Set(fromRecords)].filter((id) => !inHistory.has(id));

  // The newest transfers this account made, and the newest it only received, if there is one.
  const received = notInHistory.length > 0 ? [{ id: notInHistory[0]!, from: "record" as const }] : [];
  const made = [...new Set(fromHistory)];
  const picks = [...made.slice(0, PROBE_SAMPLES - received.length).map((id) => ({ id, from: "history" as const })), ...received];

  const samples: SampleCheck[] = [];
  for (const p of picks) samples.push(await sample(p.id, p.from, deps));

  return { records, history, recordsNotInHistory: records[USDCX_PROGRAM]?.ok && history[USDCX_PROGRAM]?.ok ? notInHistory.length : null, samples };
}

const line = <T>(o: Outcome<T> | undefined, ok: (v: T) => string): string => (!o ? "not run" : o.ok ? ok(o.value) : `failed: ${o.error}`);

/** The report as plain text: shapes and counts only, safe to paste into a chat. */
export function reportText(r: ProbeReport, today: string): string {
  const out = [`Shield history check, ${today}`, ""];
  for (const p of PROBE_PROGRAMS) {
    out.push(`${p}`);
    out.push(`  records: ${line(r.records[p], (v) => `${v.count} (${v.spent} spent, ${v.withTransactionId} with a transaction id)`)}`);
    const rec = r.records[p];
    if (rec?.ok) out.push(`  record fields: ${rec.value.fields.join(", ") || "none"}`);
    out.push(`  history: ${line(r.history[p], (v) => `${v.count} transactions`)}`);
    const h = r.history[p];
    if (h?.ok) {
      out.push(`  history fields: ${h.value.fields.join(", ") || "none"}`);
      for (const e of h.value.newest) out.push(`    ${e.date} ${e.fn} (${e.status})`);
    }
    out.push("");
  }
  out.push(`Received but not in history: ${r.recordsNotInHistory ?? "unknown"}`);
  out.push("");
  if (r.samples.length === 0) out.push("No transfers to open.");
  r.samples.forEach((s, i) => {
    out.push(`Transfer ${i + 1} (from ${s.from === "history" ? "history" : "a received record"})`);
    out.push(`  view keys: ${line(s.viewKeys, (n) => String(n))}`);
    out.push(`  explorer: ${line(s.explorer, (v) => v.transitions.join(", ") || "no transitions")}`);
    for (const o of s.opened) {
      out.push(
        `  ${o.transition}: ${line(o.result, (v) => `inputs ${v.inputsRead}/${v.inputs} read, outputs ${v.outputsRead}/${v.outputs} read${v.amountFound ? ", amount readable" : ""}`)}`,
      );
    }
  });
  return out.join("\n");
}

const CIPHER = /^(ciphertext1|record1)/;
const AMOUNT = /\b\d+u128\b/;

/**
 * What a decrypted transition (its JSON) lets us read: an input or output counts as read when it
 * carries a value that is not still ciphertext. Records stay sealed to their owner and don't count.
 */
export function summariseOpened(json: unknown): Opened {
  const t = isObj(json) ? json : {};
  const count = (list: unknown) => {
    const items = Array.isArray(list) ? list.filter(isObj) : [];
    const read = items.filter((x) => {
      const v = x.value;
      return v !== undefined && v !== null && !(typeof v === "string" && CIPHER.test(v));
    });
    const amount = read.some((x) => AMOUNT.test(typeof x.value === "string" ? x.value : JSON.stringify(x.value)));
    return { total: items.length, read: read.length, amount };
  };
  const i = count(t.inputs);
  const o = count(t.outputs);
  return { inputs: i.total, inputsRead: i.read, outputs: o.total, outputsRead: o.read, amountFound: i.amount || o.amount };
}
