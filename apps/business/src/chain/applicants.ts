// ---------------------------------------------------------------------------
// The business's side of applying (docs/JOB_BOARD.md): every letter under a
// posting's application lookup is an application; each opens with the
// posting's hiring key, and the ones not seen before become applicants.
// Pure apart from the injected name lookup; the panel does the I/O.
// ---------------------------------------------------------------------------

import type { Applicant, HiringKey } from "../books/jobs";
import type { ApplicationStatus, ThreadBody } from "../books/thread";
import { type OpenedApplication, unpackApplication } from "./applications";
import { nameMatchesHash } from "@pnw/records/registry/name_registry";
import { BRAND } from "../brand";
import { shortAddress } from "../books/rail";
import type { LetterRecord } from "./letters";

export type FoundApplication = OpenedApplication & { record: LetterRecord };

/**
 * Opens every letter under a posting's lookup with its hiring key. Letters
 * this app can't open (not an application, another posting, tampered) are
 * counted, not thrown; keys already known are left out.
 */
export async function openApplications(records: readonly LetterRecord[], hiring: HiringKey, postingId: string, known: ReadonlySet<string>): Promise<{ found: FoundApplication[]; unreadable: number }> {
  const found: FoundApplication[] = [];
  const seen = new Set<string>();
  let unreadable = 0;
  for (const record of records) {
    try {
      const opened = await unpackApplication(hiring, postingId, record.envelope);
      if (known.has(opened.partiesKey) || seen.has(opened.partiesKey)) continue;
      seen.add(opened.partiesKey);
      found.push({ ...opened, record });
    } catch {
      unreadable++;
    }
  }
  return { found, unreadable };
}

/**
 * Whether an application may be kept: the registered name it claims belongs to an account
 * (`owner`, from the registry), and that account is the one that sent the letter. Anyone can seal
 * an application (the posting's hiring key is public), so the name is believed only from its owner
 * (the security review, 2026-10-22).
 */
export function applicationFrom(found: FoundApplication, owner: string | null): "ok" | "unnamed" | "not theirs" {
  const b = found.message.body;
  // The name shown must be the one the hash was made from, not just any text beside it.
  if (b.type === "application" && !nameMatchesHash(b.name, b.nameHash)) return "not theirs";
  if (!owner) return "unnamed";
  return found.record.sender === owner ? "ok" : "not theirs";
}

/** How an applicant is shown: their registered name when it checks out against its hash (ones kept before names were checked may not), else their account. */
export const applicantLabel = (a: Pick<Applicant, "name" | "nameHash" | "address">): string =>
  nameMatchesHash(a.name, a.nameHash) ? `${a.name}.${BRAND.nameSuffix}` : `${shortAddress(a.address)} (name not verified)`;

/** The applicant a found application makes, once their account is known from the registry. */
export function applicantOf(found: FoundApplication, address: string): Applicant {
  const b = found.message.body;
  return { partiesKey: found.partiesKey, name: b.name, nameHash: b.nameHash, address, appliedAt: found.message.sentAt };
}

/** The message that tells an applicant where they stand. */
export const statusBody = (postingId: string, status: ApplicationStatus): ThreadBody => ({ type: "application_status", postingId, status });

/** "Tue, Oct 21 at 2:00 PM" and where, as the interview message the business sends. */
export function interviewText(when: string, where: string, note: string): string {
  const at = new Date(when);
  const whenText = Number.isNaN(at.getTime())
    ? when
    : `${at.toLocaleString("en-US", { weekday: "short" })}, ${at.toLocaleString("en-US", { month: "short" })} ${at.getDate()} at ${at.toLocaleString("en-US", { hour: "numeric", minute: "2-digit" })}`;
  const lines = [`Interview: ${whenText}`];
  if (where.trim()) lines.push(where.trim());
  if (note.trim()) lines.push("", note.trim());
  return lines.join("\n");
}
