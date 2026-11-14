// ---------------------------------------------------------------------------
// The idle lock: open books lock after 15 minutes with nothing happening.
//
// Something happening is page input (a tap, a key, a scroll) or a completed
// step of a long send: a long send waits on approvals in another app, so the
// page sees no input while it runs, and each step that lands says so with
// noteProgress(). The books lock 15 minutes after the last of either.
//
// The time is kept as the clock time of the last activity, not as a running
// timer alone: a timer doesn't run while a phone sleeps or a tab is frozen, so
// the time is checked again whenever the page wakes (visibilitychange,
// pageshow, focus), and a page that comes back after 15 idle minutes locks at
// once. Waking is not activity. "Stay logged in" is separate (BooksProvider).
// ---------------------------------------------------------------------------

export const IDLE_LOCK_MS = 15 * 60 * 1000;

/** The event a completed step of a long send raises on the window. */
export const PROGRESS_EVENT = "hewn:progress";

/** Page input that counts as activity. */
const INPUT_EVENTS = ["pointerdown", "keydown", "scroll"] as const;

/** Says a step of a long send just completed, so the idle lock counts it as activity. */
export function noteProgress(target: EventTarget | undefined = typeof window === "undefined" ? undefined : window): void {
  target?.dispatchEvent(new Event(PROGRESS_EVENT));
}

export type IdleTracker = {
  /** Notes activity now. */
  touch(): void;
  /** Locks, once, if the last activity was `ms` or more ago; says whether it has locked. */
  check(): boolean;
  /** How long until the lock is due, from now. */
  remaining(): number;
};

/** The clock time of the last activity, and the check against it. */
export function idleTracker({ now, lock, ms = IDLE_LOCK_MS }: { now: () => number; lock: () => void; ms?: number }): IdleTracker {
  let last = now();
  let locked = false;
  return {
    touch() {
      last = now();
    },
    check() {
      if (!locked && now() - last >= ms) {
        locked = true;
        lock();
      }
      return locked;
    },
    remaining() {
      return Math.max(0, last + ms - now());
    },
  };
}

/**
 * Runs the idle lock on a page: page input and PROGRESS_EVENT are activity; the time is checked on
 * a timer set for 15 minutes after the last activity, and whenever the page wakes. Returns a stop.
 */
export function watchIdle({
  lock,
  now = Date.now,
  ms = IDLE_LOCK_MS,
  win = window,
  doc = document,
}: {
  lock: () => void;
  now?: () => number;
  ms?: number;
  win?: EventTarget;
  doc?: EventTarget & { visibilityState: DocumentVisibilityState };
}): () => void {
  const idle = idleTracker({ now, lock, ms });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const check = () => {
    clearTimeout(timer);
    if (!idle.check()) timer = setTimeout(check, idle.remaining());
  };
  const touch = () => idle.touch(); // the timer, when it fires, sees the later time and waits again
  const wake = () => {
    if (doc.visibilityState === "visible") check();
  };
  const activity = [...INPUT_EVENTS, PROGRESS_EVENT];
  activity.forEach((e) => win.addEventListener(e, touch, { passive: true }));
  doc.addEventListener("visibilitychange", wake);
  win.addEventListener("pageshow", check);
  win.addEventListener("focus", check);
  timer = setTimeout(check, ms);
  return () => {
    clearTimeout(timer);
    activity.forEach((e) => win.removeEventListener(e, touch));
    doc.removeEventListener("visibilitychange", wake);
    win.removeEventListener("pageshow", check);
    win.removeEventListener("focus", check);
  };
}
