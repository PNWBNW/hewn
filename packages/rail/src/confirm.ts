// ---------------------------------------------------------------------------
// Reading a confirmed transaction back from the explorer.
//
// The books post the fee the employer actually paid, not the wallet's
// estimate. A transaction's `fee.transition` is `credits.aleo/fee_public`
// (or `fee_private`), whose public inputs are the base fee and the priority
// fee in microcredits; their sum is what left the account. The explorer's
// response shape has shifted between versions, so the parser is tolerant:
// the transaction may sit at the top level or under `transaction`, and the
// block height may be absent, in which case it is looked up separately.
// ---------------------------------------------------------------------------

import { isNotFound } from "./network";
import type { RailNetwork } from "./types";

export type ConfirmedTransaction = {
  transactionId: string;
  feeMicrocredits?: bigint;
  height?: number;
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/** The transaction object inside whatever the explorer returned. */
function transactionOf(doc: unknown): Obj | null {
  if (!isObj(doc)) return null;
  if (isObj(doc.transaction)) return doc.transaction;
  if (isObj(doc.fee) || isObj(doc.execution) || typeof doc.id === "string") return doc;
  return null;
}

const U64 = /^(\d+)u64$/;

/** Sum of the fee transition's u64 inputs (base + priority), in microcredits; undefined when there is none. */
export function parseFeeMicrocredits(doc: unknown): bigint | undefined {
  const tx = transactionOf(doc);
  const fee = tx && isObj(tx.fee) ? tx.fee : null;
  const transition = fee && isObj(fee.transition) ? fee.transition : null;
  if (!transition) return undefined;
  if (transition.program !== undefined && transition.program !== "credits.aleo") return undefined;
  const inputs = Array.isArray(transition.inputs) ? transition.inputs : [];
  let total = 0n;
  let found = false;
  for (const input of inputs) {
    if (!isObj(input)) continue;
    const value = typeof input.value === "string" ? input.value.trim() : "";
    const m = U64.exec(value);
    if (!m?.[1]) continue;
    total += BigInt(m[1]);
    found = true;
  }
  return found ? total : undefined;
}

const asHeight = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : undefined;
};

/** The block height if the response carries one, under any of the names seen so far. */
export function parseHeight(doc: unknown): number | undefined {
  if (!isObj(doc)) return undefined;
  for (const key of ["block_height", "blockHeight", "height"]) {
    const h = asHeight(doc[key]);
    if (h !== undefined) return h;
  }
  if (isObj(doc.block)) {
    const h = asHeight(doc.block.height) ?? (isObj(doc.block.header) && isObj(doc.block.header.metadata) ? asHeight(doc.block.header.metadata.height) : undefined);
    if (h !== undefined) return h;
  }
  if (isObj(doc.header) && isObj(doc.header.metadata)) return asHeight(doc.header.metadata.height);
  return undefined;
}

/** Whether the explorer says the transaction was rejected (an `aborted`/`rejected` confirmed-transaction type or status). */
export function parseRejected(doc: unknown): string | null {
  if (!isObj(doc)) return null;
  const status = typeof doc.status === "string" ? doc.status.toLowerCase() : "";
  const type = typeof doc.type === "string" ? doc.type.toLowerCase() : "";
  if (status === "rejected" || status === "aborted" || type === "rejected" || type === "aborted") {
    return typeof doc.error === "string" ? doc.error : "The network rejected the payment";
  }
  return null;
}

/**
 * Fetches `GET /transaction/<id>` and reads the fee and height out of it.
 * Resolves null while the explorer hasn't indexed the transaction yet.
 * Throws when the explorer reports it rejected.
 */
export async function confirmTransaction(network: RailNetwork, transactionId: string): Promise<ConfirmedTransaction | null> {
  let doc: unknown;
  try {
    doc = await network.fetchJson(`transaction/${transactionId}`);
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
  const rejected = parseRejected(doc);
  if (rejected) throw new Error(rejected);
  if (!transactionOf(doc)) return null;
  const feeMicrocredits = parseFeeMicrocredits(doc);
  let height = parseHeight(doc);
  if (height === undefined) height = await lookupHeight(network, transactionId);
  return { transactionId, ...(feeMicrocredits !== undefined ? { feeMicrocredits } : {}), ...(height !== undefined ? { height } : {}) };
}

/** `find/blockHash/<id>` then `block/<hash>`: the height, when the transaction itself doesn't say. Best effort. */
async function lookupHeight(network: RailNetwork, transactionId: string): Promise<number | undefined> {
  try {
    const hash = await network.fetchJson(`find/blockHash/${transactionId}`);
    if (typeof hash !== "string" || !hash) return undefined;
    return parseHeight(await network.fetchJson(`block/${hash.replace(/"/g, "")}`));
  } catch {
    return undefined;
  }
}
