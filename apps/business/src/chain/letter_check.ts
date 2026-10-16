// ---------------------------------------------------------------------------
// Settings → "Send a test letter": the first real letter through
// hewn_letters_v1, to this account itself, measuring what docs/LETTERS.md
// could only estimate. One Shield approval; then the report says:
//
//   - how long from the tap to the network accepting it (it includes the
//     time spent approving in Shield)
//   - the fee, and whether it was paid privately (fee_private shows no
//     account; fee_public names it)
//   - whether Shield then finds the letter and the sender's copy, and
//     whether the letter opens with its key and says what was sent
//   - what the network sees: the public transaction, broken down (which
//     call, which inputs and outputs and in what form, the fee transition,
//     the size), read from the explorer, the same view anyone has
//
// The letter carries a message (a default line, or whatever the person
// types) sealed with a key made for it and then forgotten. Up to
// LETTER_TEXT_BYTES it goes as a letter; longer, up to PAGE_TEXT_BYTES, as a
// page (`send_page`), so both calls can be measured. The report holds timings,
// amounts and yes/no answers, and the transaction id (public anyway), never
// an account or a key.
// ---------------------------------------------------------------------------

import { ENVELOPE_OVERHEAD, open, partiesKeyFromHex, seal } from "@pnw/mailbox";
import { parseFeeKind, parseFeeMicrocredits } from "@pnw/rail";
import { LETTERS_PROGRAM, LETTER_BYTES, PAGE_BYTES, type LetterWallet, letterCall, parseLetterRecord } from "./letters";
import { executeAndWait } from "./work/execute";

export const TEST_LINE = "A test letter, sealed for no one but this account.";
const TEST_KIND = "test_letter";

/** The most text (UTF-8 bytes) that goes as one letter, and as one page. */
export const LETTER_TEXT_BYTES = LETTER_BYTES - ENVELOPE_OVERHEAD;
export const PAGE_TEXT_BYTES = PAGE_BYTES - ENVELOPE_OVERHEAD;

/** How a message would travel: as a letter, as a page, or not at all (empty or too long). */
export function messageFit(message: string): { bytes: number; as: "letter" | "page" | "empty" | "too_long" } {
  const bytes = new TextEncoder().encode(message).length;
  if (!message.trim()) return { bytes, as: "empty" };
  if (bytes <= LETTER_TEXT_BYTES) return { bytes, as: "letter" };
  if (bytes <= PAGE_TEXT_BYTES) return { bytes, as: "page" };
  return { bytes, as: "too_long" };
}

export type LetterCheckDeps = {
  wallet: LetterWallet;
  /** This account (the letter goes to itself). */
  address: string;
  /** The explorer's transaction JSON, or null while it doesn't know it yet. */
  fetchTransaction(id: string): Promise<unknown>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** How long to wait for the explorer and for Shield to show the letter. Default 3 minutes each. */
  waitMs?: number;
  pollMs?: number;
  randomHex?: (bytes: number) => string;
  /** What the letter says; the default line when left out. */
  message?: string;
};

export type LetterCheckResult = {
  transactionId: string;
  /** Which call carried it. */
  sentAs: "letter" | "page";
  /** What it said, as read back from Shield (when it opened). */
  readBack?: string;
  /** From the tap to accepted, approving included. */
  sentMs: number;
  feeMicrocredits?: bigint;
  feeKind?: "public" | "private";
  /** How long until Shield listed the letter, after it was accepted; undefined if it never did. */
  foundMs?: number;
  letterFound: boolean;
  copyFound: boolean;
  /** Whether Shield gave the record a sender. */
  senderShown: boolean;
  opened: boolean;
  /** What the public transaction shows, line by line (describeBroadcast). */
  broadcast?: string[];
};

const hex = (bytes: number) => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");

export async function runLetterCheck(deps: LetterCheckDeps): Promise<LetterCheckResult> {
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const waitMs = deps.waitMs ?? 180_000;
  const pollMs = deps.pollMs ?? 5_000;
  const key = (deps.randomHex ?? hex)(32);
  const message = deps.message ?? TEST_LINE;
  const fit = messageFit(message);
  if (fit.as === "empty") throw new Error("Write something for the letter to say");
  if (fit.as === "too_long") throw new Error(`That is too long for one letter or page (at most ${PAGE_TEXT_BYTES.toLocaleString("en-US")} bytes)`);

  const sealed = await seal(partiesKeyFromHex(key), TEST_KIND, 0, new TextEncoder().encode(message));
  const started = now();
  const { transactionId } = await executeAndWait(deps.wallet, letterCall(deps.address, sealed.lookup, sealed.envelope), { sleep, now });
  const accepted = now();
  const result: LetterCheckResult = { transactionId, sentAs: fit.as, sentMs: accepted - started, letterFound: false, copyFound: false, senderShown: false, opened: false };

  // The fee, from the transaction as the network has it.
  if (transactionId.startsWith("at1")) {
    for (const until = now() + waitMs; now() < until; await sleep(pollMs)) {
      try {
        const doc = await deps.fetchTransaction(transactionId);
        if (doc) {
          const fee = parseFeeMicrocredits(doc);
          const kind = parseFeeKind(doc);
          if (fee !== undefined) result.feeMicrocredits = fee;
          if (kind) result.feeKind = kind;
          result.broadcast = describeBroadcast(doc);
          break;
        }
      } catch {
        // the explorer may not have it yet
      }
    }
  }

  // The letter and the sender's copy, as Shield lists them.
  for (const until = now() + waitMs; now() < until; await sleep(pollMs)) {
    let raw: unknown[] = [];
    try {
      raw = await deps.wallet.requestRecords(LETTERS_PROGRAM, true);
    } catch {
      continue;
    }
    for (const r of Array.isArray(raw) ? raw : []) {
      const letter = parseLetterRecord(r);
      if (!letter || letter.lookup !== sealed.lookup) continue;
      if (letter.kind === "sent") result.copyFound = true; // a page has no sender's copy
      else {
        result.letterFound = true;
        const sender = (r as Record<string, unknown>).sender;
        result.senderShown = typeof sender === "string" && sender.startsWith("aleo1");
        try {
          const text = new TextDecoder().decode(await open(partiesKeyFromHex(key), TEST_KIND, 0, letter.envelope));
          result.readBack = text;
          result.opened = text === message;
        } catch {
          result.opened = false;
        }
      }
    }
    if (result.letterFound && (result.copyFound || fit.as === "page")) {
      result.foundMs = now() - accepted;
      break;
    }
  }
  return result;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Counts of a transition's inputs or outputs by kind: "3 private", "2 record". */
function byKind(list: unknown): { counts: Map<string, number>; items: Obj[] } {
  const items = Array.isArray(list) ? list.filter(isObj) : [];
  const counts = new Map<string, number>();
  for (const i of items) counts.set(String(i.type), (counts.get(String(i.type)) ?? 0) + 1);
  return { counts, items };
}

const KIND_WORDS: Record<string, string> = {
  private: "private (encrypted, unreadable)",
  public: "public (readable by anyone)",
  record: "record (encrypted to its owner)",
  external_record: "record of another program",
  future: "future (public work done on chain)",
  constant: "constant (public)",
};
const kinds = (counts: Map<string, number>) => [...counts].map(([k, n]) => `${n} ${KIND_WORDS[k] ?? k}`).join(", ") || "none";

/**
 * The public transaction, the way anyone fetching it from the explorer sees
 * it: each call, its inputs and outputs by kind, any value left readable, the
 * fee transition, and the size. No account is printed: where the fee names
 * the payer, it says so instead.
 */
export function describeBroadcast(doc: unknown): string[] {
  const tx = isObj(doc) && isObj(doc.transaction) ? doc.transaction : isObj(doc) ? doc : null;
  if (!tx) return ["The explorer's copy couldn't be read"];
  const lines: string[] = [];
  const transitions = isObj(tx.execution) && Array.isArray(tx.execution.transitions) ? tx.execution.transitions.filter(isObj) : [];
  for (const t of transitions) {
    lines.push(`Call: ${String(t.program)}/${String(t.function)}`);
    const ins = byKind(t.inputs);
    const outs = byKind(t.outputs);
    lines.push(`  Inputs: ${kinds(ins.counts)}`);
    lines.push(`  Outputs: ${kinds(outs.counts)}`);
    const records = outs.items.filter((o) => o.type === "record" && typeof o.value === "string");
    if (records.length > 0) {
      const sizes = records.map((r) => (r.value as string).length);
      lines.push(`  Record ciphertext: ${sizes.join(" + ")} characters`);
      const senders = outs.items.filter((o) => typeof o.sender_ciphertext === "string" || typeof o.sender === "string").length;
      lines.push(`  Sender ciphertext (only the owner can open it): ${senders > 0 ? `on ${plural(senders, "record")}` : "none shown"}`);
    }
    const readable = [...ins.items, ...outs.items].filter((i) => i.type === "public" || i.type === "constant");
    lines.push(`  Readable values in this call: ${readable.length === 0 ? "none" : readable.map((i) => String(i.value).replace(/aleo1[0-9a-z]{58}/g, "an account")).join(", ")}`);
  }
  const fee = isObj(tx.fee) && isObj(tx.fee.transition) ? tx.fee.transition : null;
  if (fee) {
    const ins = byKind(fee.inputs);
    lines.push(`Fee: ${String(fee.program)}/${String(fee.function)}`);
    lines.push(`  Inputs: ${kinds(ins.counts)}`);
    lines.push(
      fee.function === "fee_public"
        ? "  Who paid: shown (fee_public names the paying account)"
        : fee.function === "fee_private"
          ? "  Who paid: not shown (fee_private spends a record; only its serial number is public)"
          : "  Who paid: unknown",
    );
  } else {
    lines.push("Fee: none shown");
  }
  lines.push(`Size as the explorer returns it: ${(JSON.stringify(doc).length / 1024).toFixed(1)} KB of JSON`);
  return lines;
}

const credits = (micro: bigint) => `${micro / 1_000_000n}.${(micro % 1_000_000n).toString().padStart(6, "0")}`;
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** The result as a short report, safe to paste into a chat. */
export function letterCheckReport(r: LetterCheckResult, date: string): string {
  return [
    `Test letter, ${date}`,
    `Transaction: ${r.transactionId}`,
    `Message: ${r.readBack !== undefined ? `${new TextEncoder().encode(r.readBack).length.toLocaleString("en-US")} bytes (the words stay on this screen, not in this report)` : "not read back"}`,
    `Sent as: ${r.sentAs === "page" ? "a page (send_page, the long-document call; the sender keeps no copy on chain)" : "a letter (send)"}`,
    `Tap to accepted (approving included): ${seconds(r.sentMs)}`,
    `Fee: ${r.feeMicrocredits === undefined ? "not read" : `${credits(r.feeMicrocredits)} ALEO (${r.feeMicrocredits.toLocaleString("en-US")} microcredits)`}`,
    `Fee paid: ${r.feeKind === "private" ? "privately (no account shown)" : r.feeKind === "public" ? "publicly (shows this account)" : "not read"}`,
    `Shield found the letter: ${r.letterFound ? "yes" : "no"}`,
    ...(r.sentAs === "letter" ? [`Shield found the sender's copy: ${r.copyFound ? "yes" : "no"}`] : []),
    `Time until Shield listed it: ${r.foundMs === undefined ? "didn't within the wait" : seconds(r.foundMs)}`,
    `Shield shows a sender on it: ${r.senderShown ? "yes" : "no"}`,
    `It opened and read back: ${r.opened ? "yes, word for word" : r.readBack !== undefined ? "it opened, but the words differ" : "no"}`,
    ``,
    `What the network sees (the public transaction):`,
    ...(r.broadcast ?? ["Not read: the explorer didn't return the transaction in time"]),
    `Look it up: https://testnet.explorer.provable.com/transaction/${r.transactionId}`,
  ].join("\n");
}
