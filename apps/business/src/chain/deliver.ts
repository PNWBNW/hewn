// ---------------------------------------------------------------------------
// Delivering a paystub to the person it belongs to, through the mailbox
// (docs/INTEGRATION_AUDIT.md §2.2 step 3, §4.4). Once a paycheck has settled
// on the rail, the full paystub document plus its settlement (the transfer
// id, the block height, the fee) is sealed with the agreement's parties key
// and put in the next slot of that person's mailbox; their app scans the
// slots and keeps its copy in its own vault.
//
// Mailbox, not archive: the employer's vault records what was sent (the
// paycheck's `delivery`) so it can be sent again, and the person's app
// drops the pin once it has the copy. Nothing here is proof of anything;
// the books are (the paystub hash is in the entry, the entry in the chain).
//
// Pure apart from the one `client.put`: the mailbox client and the clock are
// injected, and the vault is only changed by the caller applying the result.
// Nothing here logs a key, a lookup or a document.
// ---------------------------------------------------------------------------

import { KINDS, MailboxError, type MailboxClient, partiesKeyFromHex, seal } from "@pnw/mailbox";
import { type PaycheckDelivery, type PaystubDocument, canonicalPaystub, markPaycheckDelivery, paystubDocument, paystubHash, yearToDate } from "@pnw/payroll";
import type { Company } from "../books/company";
import { bumpSeq, linkFor, nextSeq } from "../books/rail";

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
  /** Only `put` is used; a fake with that one method does for tests. */
  client: Pick<MailboxClient, "put">;
  /** ISO timestamp of the send; defaults to now. */
  now?: () => string;
};

export type DeliverResult = {
  /** The company with the delivery recorded and the slot advanced. */
  company: Company;
  delivery: PaycheckDelivery;
  /** The slot already held an envelope (an earlier attempt reached the mailbox but not the vault). */
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
 * Seals one settled paycheck's paystub to the person and puts it in the next
 * slot of their mailbox. A slot that is already taken counts as delivered:
 * only this business can have filled it, with this same document. Any other
 * failure throws and the company comes back untouched.
 */
export async function deliverPaystub({ company, runId, workerId, client, now }: DeliverInput): Promise<DeliverResult> {
  if (!company.rail) throw new DeliveryError("Link Shield in Settings first");
  const link = linkFor(company.rail, workerId);
  if (!link) throw new DeliveryError("This person has no account on the rail yet: Settings → Import team");
  if (!link.partiesKey) throw new DeliveryError(REIMPORT_MESSAGE);
  const contents = paystubEnvelope(company, runId, workerId);
  const seq = nextSeq(link, KINDS.paystub);
  const bytes = new TextEncoder().encode(JSON.stringify(contents));
  const key = partiesKeyFromHex(link.partiesKey);
  let sealed;
  try {
    sealed = await seal(key, KINDS.paystub, seq, bytes);
  } finally {
    key.fill(0);
  }
  let slotTaken = false;
  try {
    await client.put(sealed.lookup, sealed.envelope);
  } catch (e) {
    if (e instanceof MailboxError && e.code === "CONFLICT") slotTaken = true;
    else throw e;
  }
  const delivery: PaycheckDelivery = { seq, lookup: sealed.lookup, sentAt: (now ?? (() => new Date().toISOString()))() };
  return { company: recordDelivery(company, runId, workerId, delivery), delivery, slotTaken };
}

/** True when the server has no mailbox (503): nothing to retry until the host is set up. */
export const isMailboxOff = (e: unknown): boolean => e instanceof MailboxError && e.code === "NOT_CONFIGURED";
