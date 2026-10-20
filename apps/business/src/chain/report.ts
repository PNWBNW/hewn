// ---------------------------------------------------------------------------
// Reports to Hewn as letters (books/report.ts has what a report is). A report
// goes to Hewn's account (BRAND.reportsAccount) as one ordinary letter
// through hewn_letters_v2, so nothing new is deployed:
//
//   lookup   SHA-256("PNW::REPORT::v1" ‖ report id): new for every report,
//            so one account can send any number of them
//   parcel   "HEWN-REPORT-1", then the report as JSON (deflated when that
//            is smaller)
//
// A report has one lock, not two: the record itself, sealed to Hewn's
// account, so only its view key opens it. There is no key between the
// reporter and Hewn to seal an envelope under, and the reporter is choosing
// to show Hewn this message. The record's sender (which only Hewn can read)
// says who reported.
//
// Hewn reads them with `openReports`: every letter its account holds whose
// parcel starts with the marker and whose lookup matches the report inside.
// Nothing here logs a report, an account or a lookup.
// ---------------------------------------------------------------------------

import { type Report, ReportError, validateReport } from "../books/report";
import { packPayload, unpackPayload } from "./compress";
import { LETTER_PROGRAMS, type LetterRecord, PAGE_BYTES, parseLetterRecord } from "./letters";

export const REPORT_SALT = "PNW::REPORT::v1";
const MARKER = new TextEncoder().encode("HEWN-REPORT-1");

const utf8 = (s: string) => new TextEncoder().encode(s);
const hex = (b: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");

/** Where one report travels: its own lookup, from its id. */
export async function reportLookup(id: string): Promise<string> {
  if (!/^[0-9a-f]{32}$/.test(id)) throw new ReportError("A report needs an id");
  return hex(await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array([...utf8(REPORT_SALT), ...utf8(id)])));
}

/** The letter's parcel: the marker, then the report. */
export async function packReport(report: Report): Promise<Uint8Array<ArrayBuffer>> {
  const body = await packPayload(utf8(JSON.stringify(validateReport(report))));
  const out = new Uint8Array(MARKER.length + body.length);
  out.set(MARKER, 0);
  out.set(body, MARKER.length);
  if (out.length > PAGE_BYTES) throw new ReportError("This report is too long to send; shorten the note, or copy it and email it instead");
  return out;
}

const startsWithMarker = (bytes: Uint8Array) => bytes.length > MARKER.length && MARKER.every((b, i) => bytes[i] === b);

/** A report back out of a letter, or null when the letter isn't one (or doesn't hold together). */
export async function unpackReport(lookup: string, parcel: Uint8Array): Promise<Report | null> {
  if (!startsWithMarker(parcel)) return null;
  try {
    const report = validateReport(JSON.parse(new TextDecoder().decode(await unpackPayload(parcel.subarray(MARKER.length)))));
    return (await reportLookup(report.id)) === lookup ? report : null;
  } catch {
    return null;
  }
}

export type ReceivedReport = { report: Report; reporter?: string; blockHeight?: number; transactionId?: string };

/** Every report among an account's letters, newest first. `requestRecords` is Shield's. */
export async function openReports(requestRecords: (program: string, plaintext?: boolean) => Promise<unknown[]>): Promise<ReceivedReport[]> {
  const raw = (await Promise.all(LETTER_PROGRAMS.map((p) => requestRecords(p, true)))).flatMap((r) => (Array.isArray(r) ? r : []));
  const out: ReceivedReport[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const letter: LetterRecord | null = parseLetterRecord(r);
    if (!letter || letter.kind === "sent") continue;
    const report = await unpackReport(letter.lookup, letter.envelope);
    if (!report || seen.has(report.id)) continue;
    seen.add(report.id);
    out.push({
      report,
      ...(letter.sender ? { reporter: letter.sender } : {}),
      ...(letter.blockHeight !== undefined ? { blockHeight: letter.blockHeight } : {}),
      ...(letter.transactionId ? { transactionId: letter.transactionId } : {}),
    });
  }
  return out.sort((a, b) => (a.report.reportedAt < b.report.reportedAt ? 1 : a.report.reportedAt > b.report.reportedAt ? -1 : 0));
}
