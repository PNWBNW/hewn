// ---------------------------------------------------------------------------
// Who an account can invite to an event (books/shared_events.ts), and the
// conversation it shares with each: a business, the people on its team; a
// person, at one job, their employer and the coworkers listed in that job's
// directory (books/directory.ts) who have an account to write to. Nobody else:
// partner businesses come with business-to-business agreements. Pure.
// ---------------------------------------------------------------------------

import type { Worker } from "@pnw/payroll";
import { coworkersFrom } from "./directory";
import { type Mailbox, threadFor } from "./mailbox";
import type { Rail } from "./rail";
import { type Contact, type GuestAnswer, type Guest, type Invite, answerIn } from "./shared_events";
import type { Thread } from "./thread";
import { type Work, type WorkAgreement, workThread } from "./work";

/** A business's team: everyone linked who still works there. */
export function teamGuests(rail: Rail | null | undefined, workers: readonly Pick<Worker, "id" | "name" | "active">[]): Guest[] {
  const active = new Map(workers.filter((w) => w.active).map((w) => [w.id, w.name]));
  return (rail?.links ?? []).flatMap((l) =>
    l.status === "linked" && l.partiesKey && active.has(l.workerId) ? [{ name: active.get(l.workerId)!.slice(0, 60), address: l.address, contact: { via: "pair" as const, partiesKey: l.partiesKey } }] : [],
  );
}

/** A person's guests at one job: the employer (as `employerName`), and each listed coworker with an account, when this person is in the directory there. */
export function jobGuests(work: Work, agreement: WorkAgreement, employerName: string): Guest[] {
  const out: Guest[] = [{ name: employerName.slice(0, 60), address: agreement.employerAddress, contact: { via: "pair", partiesKey: agreement.partiesKey } }];
  const me = work.identities?.[agreement.partiesKey];
  if (!me) return out;
  for (const c of coworkersFrom(workThread(work, agreement.partiesKey))) {
    if (c.publicKey === me.publicKey || !c.address) continue;
    out.push({ name: c.name, address: c.address, contact: { via: "coworker", businessKey: agreement.partiesKey, publicKey: c.publicKey } });
  }
  return out;
}

/** The conversation behind a contact, in these books: a business's thread with a person, a person's with an employer, or with a coworker. */
export function threadOfContact(c: Contact, books: { mailbox?: Mailbox | null; work?: Work | null }): Thread | undefined {
  if (c.via === "coworker") return books.work?.coworkers?.[c.publicKey];
  return books.work ? workThread(books.work, c.partiesKey) : threadFor(books.mailbox, c.partiesKey);
}

/**
 * The account an invitation's organizer posts from (the only one its posts are believed from), and
 * what kind of account it should be: a person's employer is a business, a business's team member
 * and a coworker are people. Undefined when these books don't know it.
 */
export function organizerAccount(c: Contact, books: { work?: Work | null; rail?: Rail | null }): { account: string; expect: "person" | "business" } | undefined {
  if (c.via === "coworker") {
    const address = books.work ? coworkersFrom(workThread(books.work, c.businessKey)).find((e) => e.publicKey === c.publicKey)?.address : undefined;
    return address ? { account: address, expect: "person" } : undefined;
  }
  if (books.work) {
    const employer = books.work.agreements.find((a) => a.partiesKey === c.partiesKey)?.employerAddress;
    return employer ? { account: employer, expect: "business" } : undefined;
  }
  const link = books.rail?.links.find((l) => l.partiesKey === c.partiesKey);
  return link ? { account: link.address, expect: "person" } : undefined;
}

/** This account's latest answer to an invitation, from its own conversation with the organizer. */
export const myAnswerIn =
  (books: { mailbox?: Mailbox | null; work?: Work | null }) =>
  (i: Invite): GuestAnswer | undefined =>
    answerIn(threadOfContact(i.from, books), i.eventId, true);
