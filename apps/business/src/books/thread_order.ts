// The order of a conversation on this device (Joshua, 2026-11-11). Kept apart from books/thread.ts
// so the modules that thread.ts itself imports (hours, schedules) can use it.

import type { ThreadItem } from "./thread";

/**
 * When a message took its place in this device's copy of the conversation: one of mine when I
 * sent it, one of theirs when it arrived here. Both are this device's clock. The time the other
 * side wrote on a message (`sentAt`) is shown beside it and decides nothing: a sender can write
 * any past time, and a message placed by it could slide in ahead of what was already read and
 * answered. (A message kept before arrival times were, or one of theirs with none, falls back to
 * the time written on it.)
 */
export const placedAt = (i: ThreadItem): number => Date.parse(i.mine ? i.sentAt : (i.receivedAt ?? i.sentAt));

/**
 * The order of a conversation on this device: by `placedAt`, so each of their messages comes
 * after everything that was here when it arrived, and nothing I answered can be given a
 * different question afterwards. Messages that arrived together keep their slots' order.
 */
export const inOrder = (a: ThreadItem, b: ThreadItem): number => {
  const d = placedAt(a) - placedAt(b);
  if (d !== 0) return d;
  if (a.mine !== b.mine) return a.mine ? -1 : 1;
  if ((a.via ?? "") === (b.via ?? "") && a.seq !== b.seq) return a.seq - b.seq;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};
