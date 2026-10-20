// ---------------------------------------------------------------------------
// Changing hours by agreement (Joshua, 2026-10-20). Neither side changes the
// other's hours on its own:
//
//   - The person can "Ask for a revision" of a shift they haven't sent yet:
//     the times they'd like and a note. They may still send their week while
//     it waits; once a shift is on a sent week they can't ask any more.
//   - The business can "Question" a shift it received and hasn't paid: a note,
//     and the times it thinks are right if it has them. Nothing changes until
//     the person agrees.
//
// Both are an `hours_change` in the pair's conversation, answered once by the
// other side with `hours_change_answer` (accepted or declined, with a note).
// An accepted change with times is applied on both sides as the letters are
// read (work.ts and mailbox.ts `applyAgreedHours`): the person's punches move,
// the business's copy of the shift is replaced, each marked with what it was.
// While a change is open the business's pay run holds that shift back unless
// it chooses to pay it as sent (books/timecard_pay.ts).
//
// A shift is named by its whole stretch, clock-in to clock-out (a shift past
// midnight is one shift, two entries on a card). The times proposed travel
// with their split into days on the agreement's calendar, so the business
// keeps its card the way the person's side would build it. Pure.
// ---------------------------------------------------------------------------

import type { Side, Thread, ThreadItem } from "./thread";

export const MAX_CHANGE_NOTE = 500;
/** The longest shift a change may name or propose: a day and a half. */
const MAX_SHIFT_MINUTES = 36 * 60;
const MAX_SEGMENTS = 3;

export type Stretch = { in: string; out: string };
export type Segment = { date: string; in: string; out: string; minutes: number };
/** The times a change proposes, with their split into days on the agreement's calendar. */
export type ProposedShift = Stretch & { segments: Segment[] };

export type HoursChangeBody = { type: "hours_change"; agreementId: string; shift: Stretch; proposed?: ProposedShift; note: string };
export type HoursAnswerBody = { type: "hours_change_answer"; changeId: string; answer: "accepted" | "declined"; note: string };

export class HoursChangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HoursChangeError";
  }
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[0-9a-f]{32}$/;
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const ms = (iso: string) => Date.parse(iso);

function instant(raw: unknown, what: string): string {
  if (typeof raw !== "string" || !ISO.test(raw) || Number.isNaN(ms(raw))) throw new HoursChangeError(`${what} must be a time`);
  return new Date(ms(raw)).toISOString();
}

function stretch(raw: unknown, what: string): Stretch {
  if (!isObject(raw)) throw new HoursChangeError(`${what} needs a start and an end`);
  const s = { in: instant(raw.in, `${what}'s start`), out: instant(raw.out, `${what}'s end`) };
  const minutes = (ms(s.out) - ms(s.in)) / 60_000;
  if (minutes <= 0) throw new HoursChangeError(`${what} has to end after it starts`);
  if (minutes > MAX_SHIFT_MINUTES) throw new HoursChangeError(`${what} can be at most 36 hours`);
  return s;
}

function proposed(raw: unknown): ProposedShift {
  const s = stretch(raw, "The new shift");
  const segs = (raw as { segments?: unknown }).segments;
  if (!Array.isArray(segs) || segs.length === 0 || segs.length > MAX_SEGMENTS) throw new HoursChangeError("The new shift needs its days");
  const segments = segs.map((x): Segment => {
    if (!isObject(x) || typeof x.date !== "string" || !DATE.test(x.date)) throw new HoursChangeError("Each day of the new shift needs its date");
    const seg = stretch(x, "A day of the new shift");
    const minutes = Math.floor((ms(seg.out) - ms(seg.in)) / 60_000);
    if (x.minutes !== minutes) throw new HoursChangeError("A day of the new shift doesn't add up");
    return { date: x.date, ...seg, minutes };
  });
  // The days run end to end, from the start to the end, each on a later date.
  if (segments[0]!.in !== s.in || segments.at(-1)!.out !== s.out) throw new HoursChangeError("The new shift's days don't cover it");
  for (let i = 1; i < segments.length; i++) {
    if (segments[i]!.in !== segments[i - 1]!.out || segments[i]!.date <= segments[i - 1]!.date) throw new HoursChangeError("The new shift's days don't run end to end");
  }
  return { ...s, segments };
}

function note(raw: unknown, required: boolean, what: string): string {
  if (raw !== undefined && typeof raw !== "string") throw new HoursChangeError("A note must be text");
  const n = (raw ?? "").trim();
  if (required && !n) throw new HoursChangeError(what);
  if ([...n].length > MAX_CHANGE_NOTE) throw new HoursChangeError(`A note can be at most ${MAX_CHANGE_NOTE} characters`);
  return n;
}

export function validateHoursChange(raw: Record<string, unknown>): HoursChangeBody {
  if (typeof raw.agreementId !== "string" || !/^[0-9a-f]{16,64}$/.test(raw.agreementId)) throw new HoursChangeError("A change names its agreement");
  const body: HoursChangeBody = { type: "hours_change", agreementId: raw.agreementId, shift: stretch(raw.shift, "The shift"), note: note(raw.note, true, "Say what's wrong with the hours") };
  if (raw.proposed !== undefined) body.proposed = proposed(raw.proposed);
  return body;
}

export function validateHoursAnswer(raw: Record<string, unknown>): HoursAnswerBody {
  if (typeof raw.changeId !== "string" || !ID.test(raw.changeId)) throw new HoursChangeError("An answer names the change it answers");
  if (raw.answer !== "accepted" && raw.answer !== "declined") throw new HoursChangeError("An answer accepts or declines");
  return { type: "hours_change_answer", changeId: raw.changeId, answer: raw.answer, note: note(raw.note, raw.answer === "declined", "Say why the hours stay as they are") };
}

// ---- Reading the conversation ---------------------------------------------------------------

export type HoursAnswer = { answer: "accepted" | "declined"; note: string; at: string; mine: boolean };
/** One change and how it stands. `from` is who asked. */
export type HoursChange = { id: string; from: Side; sentAt: string; mine: boolean; body: HoursChangeBody; answer?: HoursAnswer };

type ChangeItem = ThreadItem & { body: HoursChangeBody };
type AnswerItem = ThreadItem & { body: HoursAnswerBody };
const byTime = (a: ThreadItem, b: ThreadItem) => (a.sentAt < b.sentAt ? -1 : a.sentAt > b.sentAt ? 1 : a.seq - b.seq);

/** Every change in the conversation, oldest first, each with its answer: the first one from the other side. */
export function hoursChanges(thread: Thread | undefined): HoursChange[] {
  const items = [...(thread?.items ?? [])].sort(byTime);
  const answers = items.filter((i): i is AnswerItem => i.body.type === "hours_change_answer");
  return items
    .filter((i): i is ChangeItem => i.body.type === "hours_change")
    .map((c) => {
      const a = answers.find((x) => x.body.changeId === c.id && x.from !== c.from);
      return {
        id: c.id,
        from: c.from,
        sentAt: c.sentAt,
        mine: c.mine,
        body: c.body,
        ...(a ? { answer: { answer: a.body.answer, note: a.body.note, at: a.sentAt, mine: a.mine } } : {}),
      };
    });
}

const overlap = (a: Stretch, b: Stretch) => ms(a.in) < ms(b.out) && ms(b.in) < ms(a.out);

/** The latest change about a shift that overlaps `s`, for one agreement. */
export const changeFor = (changes: readonly HoursChange[], agreementId: string, s: Stretch): HoursChange | undefined =>
  changes.filter((c) => c.body.agreementId === agreementId && overlap(c.body.shift, s)).at(-1);

/** The shifts with a change still waiting for its answer: what a pay run holds back. */
export const openShifts = (changes: readonly HoursChange[], agreementId?: string): Stretch[] =>
  changes.filter((c) => !c.answer && (agreementId === undefined || c.body.agreementId === agreementId)).map((c) => c.body.shift);

/** Whether a stretch on a card falls in one of these shifts. */
export const within = (e: Stretch, shifts: readonly Stretch[]): boolean => shifts.some((s) => ms(s.in) <= ms(e.in) && ms(e.out) <= ms(s.out));

/** The changes both sides agreed to that move times, in the order they were asked. */
export const agreedChanges = (changes: readonly HoursChange[]): (HoursChange & { body: HoursChangeBody & { proposed: ProposedShift } })[] =>
  changes.filter((c): c is HoursChange & { body: HoursChangeBody & { proposed: ProposedShift } } => c.answer?.answer === "accepted" && !!c.body.proposed);

/**
 * Cards' entries joined into whole shifts: entries that run end to end (a shift past midnight) are
 * one shift. Entries in time order.
 */
export function wholeShifts<E extends Stretch>(entries: readonly E[]): { in: string; out: string; entries: E[] }[] {
  const out: { in: string; out: string; entries: E[] }[] = [];
  for (const e of [...entries].sort((a, b) => ms(a.in) - ms(b.in))) {
    const last = out.at(-1);
    if (last && ms(last.out) === ms(e.in)) {
      last.out = e.out;
      last.entries.push(e);
    } else out.push({ in: e.in, out: e.out, entries: [e] });
  }
  return out;
}
