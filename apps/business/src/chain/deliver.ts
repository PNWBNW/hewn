// ---------------------------------------------------------------------------
// Delivering a paystub to the person it belongs to (docs/INTEGRATION_AUDIT.md
// §2.2 step 3, §4.4). Once a paycheck has settled on the rail, the full
// paystub document plus its settlement (the transfer id, the block height,
// the fee) is deflated when that's smaller (compress.ts), sealed with the
// agreement's parties key and sent to that person as a letter on chain
// (letters.ts; one Shield approval) under the next slot's lookup; their app
// finds it among their letters and keeps its copy in its own vault.
//
// The employer's vault records what was sent (the paycheck's `delivery`) so
// it can be sent again. Nothing here is proof of anything; the books are
// (the paystub hash is in the entry, the entry in the chain).
//
// Pure apart from the one `client.put`: the letter box (or a fake) and the
// clock are injected, and the vault is only changed by the caller applying
// the result.
// Nothing here logs a key, a lookup or a document.
// ---------------------------------------------------------------------------

import { KINDS, MailboxError, partiesKeyFromHex, seal } from "@pnw/mailbox";
import type { FeeMode } from "@pnw/wallet/fee-mode";
import { type PaycheckDelivery, type PaystubDocument, canonicalPaystub, markPaycheckDelivery, paystubDocument, paystubHash, yearToDate } from "@pnw/payroll";
import type { Company } from "../books/company";
import { threadFor } from "../books/mailbox";
import { bumpSeq, linkFor, nextSeq } from "../books/rail";
import { packPayload } from "./compress";
import { documentKey } from "./key_ring";

/**
 * What goes in the envelope, as JSON. `document` is the paystub in its
 * canonical form (keys in hash order, amounts as decimal strings, absent
 * fields null), so the receiver can hash it exactly as the books did and
 * check it against the anchored period root later.
 */
export type PaystubEnvelope = {
  version: 1;
  kind: "paystub";
  document: Record<keyof PaystubDocument, unknown>;
  settlement: {
    transactionId: string;
    height?: number;
    /** Microcredits, as a decimal string. */
    feeMicrocredits?: string;
  };
  businessName: string;
};

export type DeliverInput = {
  company: Company;
  runId: string;
  workerId: string;
  /** A letter box to the person (letters.ts); a fake with `put` does for tests. */
  client: { put(lookup: string, envelope: Uint8Array, options?: { keepUntil?: string; feeMode?: FeeMode }): Promise<unknown> };
  /** How the letter's fee is paid; the device's switch when left out. */
  feeMode?: FeeMode;
  /** ISO timestamp of the send; defaults to now. */
  now?: () => string;
};

export type DeliverResult = {
  /** The company with the delivery recorded and the slot advanced. */
  company: Company;
  delivery: PaycheckDelivery;
  /** The slot was already sent under (an earlier attempt reached the network but not the vault). */
  slotTaken: boolean;
};

export class DeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeliveryError";
  }
}

/** Shown when the person was linked before paystub delivery existed. */
export const REIMPORT_MESSAGE = "Re-import this team member in Settings to enable paystub delivery";

/** The envelope's contents for one settled paycheck, rebuilt from the vault and checked against the books. */
export function paystubEnvelope(company: Company, runId: string, workerId: string): PaystubEnvelope {
  const { books, payroll } = company;
  const run = payroll.runs.find((r) => r.id === runId);
  if (!run) throw new DeliveryError("Pay run not found");
  if (run.mode !== "rail") throw new DeliveryError("Only a run paid on the rail sends paystubs this way");
  const paycheck = run.paychecks.find((p) => p.workerId === workerId);
  if (!paycheck) throw new DeliveryError("That person isn't in this pay run");
  if (paycheck.settlement.status !== "settled") throw new DeliveryError("The paystub goes out once the pay has settled");
  const transactionId = paycheck.settlement.reference;
  if (!transactionId) throw new DeliveryError("This paycheck has no payment id to send");
  const worker = payroll.workers.find((w) => w.id === workerId);
  if (!worker) throw new DeliveryError("This person is no longer in the team list, so the paystub can't be rebuilt");

  // The same inputs posting used, so the hash must come out the same as the entry's.
  const doc = paystubDocument(run, paycheck, worker, books.settings, yearToDate(payroll, workerId, run.payDate, run.id));
  if (!paycheck.paystubHash) throw new DeliveryError("This run was posted before paystub documents existed");
  if (paystubHash(doc) !== paycheck.paystubHash) throw new DeliveryError("The paystub doesn't match the one the books committed to");

  const { height, feeMicrocredits } = paycheck.settlement;
  return {
    version: 1,
    kind: KINDS.paystub,
    document: JSON.parse(canonicalPaystub(doc)) as PaystubEnvelope["document"],
    settlement: {
      transactionId,
      ...(height !== undefined ? { height } : {}),
      ...(feeMicrocredits !== undefined ? { feeMicrocredits: feeMicrocredits.toString() } : {}),
    },
    businessName: books.settings.businessName,
  };
}

/** Applies a delivery to the vault's copy of the company: the outbox record and the next slot. */
export function recordDelivery(company: Company, runId: string, workerId: string, delivery: PaycheckDelivery): Company {
  if (!company.rail) throw new DeliveryError("Link Shield in Settings first");
  return {
    ...company,
    payroll: markPaycheckDelivery(company.payroll, runId, workerId, delivery),
    rail: bumpSeq(company.rail, workerId, KINDS.paystub, delivery.seq),
  };
}

/**
 * Seals one settled paycheck's paystub to the person and sends it under the
 * next slot. A slot already sent under counts as delivered: only this
 * business can have filled it, with this same document. Any other failure
 * throws and the company comes back untouched.
 */
export async function deliverPaystub({ company, runId, workerId, client, now, feeMode }: DeliverInput): Promise<DeliverResult> {
  if (!company.rail) throw new DeliveryError("Link Shield in Settings first");
  const link = linkFor(company.rail, workerId);
  if (!link) throw new DeliveryError("This person has no account on the rail yet: Settings → Import team");
  if (!link.partiesKey) throw new DeliveryError(REIMPORT_MESSAGE);
  const contents = paystubEnvelope(company, runId, workerId);
  const seq = nextSeq(link, KINDS.paystub);
  const bytes = await packPayload(new TextEncoder().encode(JSON.stringify(contents)));
  // After the handshake, under the pair's key, which a view key can't reach (chain/key_ring.ts).
  const key = partiesKeyFromHex(await documentKey(link.partiesKey, threadFor(company.mailbox, link.partiesKey)?.ring));
  let sealed;
  try {
    sealed = await seal(key, KINDS.paystub, seq, bytes);
  } finally {
    key.fill(0);
  }
  let slotTaken = false;
  try {
    await (feeMode ? client.put(sealed.lookup, sealed.envelope, { feeMode }) : client.put(sealed.lookup, sealed.envelope));
  } catch (e) {
    if (e instanceof MailboxError && e.code === "CONFLICT") slotTaken = true;
    else throw e;
  }
  const delivery: PaycheckDelivery = { seq, lookup: sealed.lookup, sentAt: (now ?? (() => new Date().toISOString()))() };
  return { company: recordDelivery(company, runId, workerId, delivery), delivery, slotTaken };
}
