// ---------------------------------------------------------------------------
// Reporting a message (Joshua, 2026-10-20). Anyone who receives a message
// they think is wrong, or not really from the sender, can report it:
//
//   - The report goes to Hewn, sealed so only Hewn's account opens it
//     (chain/report.ts), and can also be copied or emailed to Hewn's support
//     address, as text, with the same id.
//   - A report about harassment tells the sender nothing. Any other kind sends
//     them a notice in the conversation (`report_notice`, books/thread.ts), so
//     a person whose account was taken over learns someone is using it.
//   - The reporter's copy of the thread marks the message as reported, so it
//     isn't reported twice by accident.
//
// What a report carries: the kind, the reporter's note, the message as they
// received it (its id, when it was sent, its words), and who it came from as
// this app names them. Nothing else from the conversation. Pure.
// ---------------------------------------------------------------------------

export const REPORT_CATEGORIES = ["harassment", "not_them", "scam", "spam", "threat", "other"] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export const REPORT_LABEL: Record<ReportCategory, string> = {
  harassment: "Harassment",
  not_them: "I don't think they sent this",
  scam: "A scam or a request for money",
  spam: "Spam",
  threat: "A threat to someone's safety",
  other: "Something else",
};

/** How the notice to the sender names a report: "as spam". */
export const REPORT_AS: Record<Exclude<ReportCategory, "harassment">, string> = {
  not_them: "not sent by you",
  scam: "a scam",
  spam: "spam",
  threat: "a threat",
  other: "a problem",
};

/** Whether the sender hears about a report: never for harassment. */
export const notifiesSender = (category: ReportCategory): category is Exclude<ReportCategory, "harassment"> => category !== "harassment";

export const MAX_REPORT_NOTE = 1_000;
/** A reported message's words: a message's own limit (books/thread.ts MAX_TEXT_CHARS). */
export const MAX_REPORTED_TEXT = 4_000;

/** Where in the app the message was received. */
export const REPORT_PLACES = ["conversation", "application", "coworker"] as const;
export type ReportPlace = (typeof REPORT_PLACES)[number];

export type Report = {
  version: 1;
  /** 16 random bytes, hex: the same in the letter and in the email. */
  id: string;
  category: ReportCategory;
  note: string;
  reportedAt: string;
  place: ReportPlace;
  /** Who sent the message, as the reporter's app names them, and their account when it knows it. */
  about: { name: string; account?: string };
  message: { id: string; sentAt: string; text: string };
};

export class ReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportError";
  }
}

const ID = /^[0-9a-f]{32}$/;
const ACCOUNT = /^aleo1[02-9ac-hj-np-z]{58}$/;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStamp = (v: unknown): v is string => typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v));
const chars = (s: string) => [...s].length;

export const isReportCategory = (v: unknown): v is ReportCategory => REPORT_CATEGORIES.includes(v as ReportCategory);

/** Checks a report (one about to be sent, or one Hewn opened) and returns a clean copy. */
export function validateReport(raw: unknown): Report {
  if (!isObject(raw)) throw new ReportError("A report must be an object");
  if (raw.version !== 1) throw new ReportError("Unknown report version");
  if (typeof raw.id !== "string" || !ID.test(raw.id)) throw new ReportError("A report needs an id");
  if (!isReportCategory(raw.category)) throw new ReportError("Pick what's wrong");
  if (typeof raw.note !== "string" || chars(raw.note) > MAX_REPORT_NOTE) throw new ReportError(`A note can be at most ${MAX_REPORT_NOTE.toLocaleString("en-US")} characters`);
  if (!isStamp(raw.reportedAt)) throw new ReportError("A report needs the time it was made");
  if (!REPORT_PLACES.includes(raw.place as ReportPlace)) throw new ReportError("A report needs where the message came");
  const about = raw.about;
  if (!isObject(about) || typeof about.name !== "string" || !about.name.trim() || chars(about.name) > 80) throw new ReportError("A report needs who sent the message");
  if (about.account !== undefined && (typeof about.account !== "string" || !ACCOUNT.test(about.account))) throw new ReportError("The sender's account isn't valid");
  const m = raw.message;
  if (!isObject(m) || typeof m.id !== "string" || !ID.test(m.id)) throw new ReportError("A report needs the message it is about");
  if (!isStamp(m.sentAt)) throw new ReportError("The reported message needs the time it was sent");
  if (typeof m.text !== "string" || chars(m.text) > MAX_REPORTED_TEXT) throw new ReportError("The reported message is too long");
  return {
    version: 1,
    id: raw.id,
    category: raw.category,
    note: raw.note.trim(),
    reportedAt: raw.reportedAt,
    place: raw.place as ReportPlace,
    about: { name: about.name.trim(), ...(about.account ? { account: about.account as string } : {}) },
    message: { id: m.id, sentAt: m.sentAt, text: m.text },
  };
}

const PLACE_LABEL: Record<ReportPlace, string> = { conversation: "A conversation", application: "An application", coworker: "A coworker chat" };

/** The report as plain text: what the reporter copies, or emails to Hewn's support address. */
export function reportText(r: Report): string {
  const lines = [
    `Report ${r.id}`,
    `What's wrong: ${REPORT_LABEL[r.category]}`,
    `Reported: ${r.reportedAt}`,
    `Where: ${PLACE_LABEL[r.place]}`,
    `From: ${r.about.name}${r.about.account ? ` (${r.about.account})` : ""}`,
    `Sent: ${r.message.sentAt}`,
    "",
    "The message:",
    r.message.text,
  ];
  if (r.note) lines.push("", "Note:", r.note);
  return lines.join("\n");
}

/** Mail apps cut long links short; past this the email carries the start and says to paste the rest. */
const MAILTO_BODY_CHARS = 1_800;

/** A mailto link with the report as its body (cut short when it's long: the copy has all of it). */
export function reportMailto(r: Report, to: string): string {
  const text = reportText(r);
  const body = text.length > MAILTO_BODY_CHARS ? `${text.slice(0, MAILTO_BODY_CHARS)}…\n\n(Cut short: paste the copied report here for the rest.)` : text;
  return `mailto:${to}?subject=${encodeURIComponent(`Report ${r.id}: ${REPORT_LABEL[r.category]}`)}&body=${encodeURIComponent(body)}`;
}
