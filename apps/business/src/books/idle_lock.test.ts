// The idle lock (idle_lock.ts): page input and each completed step of a long send count as
// activity, and the time since the last one is checked on a timer and whenever the page wakes.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDLE_LOCK_MS, PROGRESS_EVENT, afterStep, idleTracker, noteProgress, watchIdle } from "./idle_lock";

const SRC = join(__dirname, "..");
const read = (file: string) => readFileSync(join(SRC, file), "utf8");
const MINUTE = 60_000;

/** A window and a document that only carry events, as the browser's do. */
function page() {
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" as DocumentVisibilityState });
  return { win, doc };
}

/** The open books as BooksProvider keeps them: writes run one at a time, and each fails once the books are locked. */
function books() {
  let open = true;
  let queue: Promise<unknown> = Promise.resolve();
  const saved: string[] = [];
  const lock = vi.fn(() => {
    open = false;
  });
  const write = (what: string) => {
    const run = queue.then(async () => {
      if (!open) throw new Error("Books are locked");
      await Promise.resolve(); // the save
      saved.push(what);
      return what;
    });
    queue = run.catch(() => {});
    return run;
  };
  return { lock, write, saved };
}

describe("the idle tracker", () => {
  it("locks once, when the time since the last activity reaches 15 minutes", () => {
    let t = 0;
    const lock = vi.fn();
    const idle = idleTracker({ now: () => t, lock });
    t = 14 * MINUTE;
    expect(idle.check()).toBe(false);
    expect(idle.remaining()).toBe(MINUTE);
    t = 15 * MINUTE;
    expect(idle.check()).toBe(true);
    expect(idle.check()).toBe(true);
    expect(lock).toHaveBeenCalledTimes(1);
  });

  it("counts from the last touch", () => {
    let t = 0;
    const lock = vi.fn();
    const idle = idleTracker({ now: () => t, lock });
    t = 10 * MINUTE;
    idle.touch();
    t = 24 * MINUTE;
    expect(idle.check()).toBe(false);
    t = 25 * MINUTE;
    expect(idle.check()).toBe(true);
    expect(lock).toHaveBeenCalledTimes(1);
  });

  it("locks on activity that comes after the 15 minutes have passed, rather than starting them again", () => {
    let t = 0;
    const lock = vi.fn();
    const idle = idleTracker({ now: () => t, lock });
    t = 20 * MINUTE;
    idle.touch();
    expect(lock).toHaveBeenCalledTimes(1);
    t = 21 * MINUTE;
    idle.touch();
    expect(idle.check()).toBe(true);
    expect(lock).toHaveBeenCalledTimes(1);
  });

  it("never waits more than 15 minutes after the clock is set back", () => {
    let t = 0;
    const lock = vi.fn();
    const idle = idleTracker({ now: () => t, lock });
    t = -30 * 24 * 60 * MINUTE; // 30 days back
    expect(idle.check()).toBe(false);
    expect(idle.remaining()).toBe(IDLE_LOCK_MS);
    t += 15 * MINUTE;
    expect(idle.check()).toBe(true);
    expect(lock).toHaveBeenCalledTimes(1);
  });
});

describe("the idle lock on a page", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => vi.useRealTimers());

  it("stays open for 40 minutes while steps complete every 10 minutes, and locks 15 minutes after the last", () => {
    const { win, doc } = page();
    const lock = vi.fn();
    const stop = watchIdle({ lock, win, doc });
    for (let m = 10; m <= 40; m += 10) {
      vi.advanceTimersByTime(10 * MINUTE);
      noteProgress(win);
    }
    expect(lock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(14 * MINUTE);
    expect(lock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(MINUTE);
    expect(lock).toHaveBeenCalledTimes(1);
    stop();
  });

  it("locks at 15 minutes during the same run when only page input counts", () => {
    const { win, doc } = page();
    const lock = vi.fn();
    const stop = watchIdle({ lock, win, doc });
    vi.advanceTimersByTime(10 * MINUTE);
    expect(lock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5 * MINUTE);
    expect(lock).toHaveBeenCalledTimes(1);
    stop();
  });

  it("counts page input as activity", () => {
    const { win, doc } = page();
    const lock = vi.fn();
    const stop = watchIdle({ lock, win, doc });
    for (const e of ["pointerdown", "keydown", "scroll"]) {
      vi.advanceTimersByTime(10 * MINUTE);
      win.dispatchEvent(new Event(e));
    }
    vi.advanceTimersByTime(14 * MINUTE);
    expect(lock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(MINUTE);
    expect(lock).toHaveBeenCalledTimes(1);
    stop();
  });

  it("a page frozen for 20 minutes locks the moment it wakes, though no timer fired", () => {
    for (const wake of ["visibilitychange", "pageshow", "focus"] as const) {
      vi.setSystemTime(0);
      const { win, doc } = page();
      const lock = vi.fn();
      const stop = watchIdle({ lock, win, doc });
      vi.setSystemTime(20 * MINUTE); // the clock moved; the frozen page ran no timer
      expect(lock, wake).not.toHaveBeenCalled();
      (wake === "visibilitychange" ? doc : win).dispatchEvent(new Event(wake));
      expect(lock, wake).toHaveBeenCalledTimes(1);
      stop();
    }
  });

  it("a page frozen for 20 minutes locks on a tap or a completed step that arrives before the wake", () => {
    for (const late of ["pointerdown", PROGRESS_EVENT] as const) {
      vi.setSystemTime(0);
      const { win, doc } = page();
      const lock = vi.fn();
      const stop = watchIdle({ lock, win, doc });
      vi.setSystemTime(20 * MINUTE); // the clock moved; the frozen page ran no timer
      win.dispatchEvent(new Event(late));
      expect(lock, late).toHaveBeenCalledTimes(1);
      doc.dispatchEvent(new Event("visibilitychange"));
      win.dispatchEvent(new Event("focus"));
      vi.advanceTimersByTime(IDLE_LOCK_MS * 2);
      expect(lock, late).toHaveBeenCalledTimes(1);
      stop();
    }
  });

  it("locks no more than 15 minutes late when the clock is set back an hour while the books are open", () => {
    const { win, doc } = page();
    const lock = vi.fn();
    const stop = watchIdle({ lock, win, doc });
    vi.advanceTimersByTime(5 * MINUTE);
    vi.setSystemTime(5 * MINUTE - 60 * MINUTE); // the device clock goes back an hour; timers keep their pace
    vi.advanceTimersByTime(24 * MINUTE);
    expect(lock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(MINUTE); // 30 minutes after opening, with nothing happening
    expect(lock).toHaveBeenCalledTimes(1);
    stop();
  });

  it("a step 5 minutes before waking keeps the books open", () => {
    const { win, doc } = page();
    const lock = vi.fn();
    const stop = watchIdle({ lock, win, doc });
    vi.setSystemTime(14 * MINUTE);
    noteProgress(win); // a step completed while the person was approving in another app
    vi.setSystemTime(19 * MINUTE);
    win.dispatchEvent(new Event("pageshow"));
    expect(lock).not.toHaveBeenCalled();
    vi.setSystemTime(29 * MINUTE);
    win.dispatchEvent(new Event("focus"));
    expect(lock).toHaveBeenCalledTimes(1);
    stop();
  });

  it("does not count waking up as activity", () => {
    const { win, doc } = page();
    const lock = vi.fn();
    const stop = watchIdle({ lock, win, doc });
    vi.advanceTimersByTime(10 * MINUTE);
    win.dispatchEvent(new Event("focus"));
    doc.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(5 * MINUTE);
    expect(lock).toHaveBeenCalledTimes(1);
    stop();
  });

  it("stops listening when stopped", () => {
    const { win, doc } = page();
    const lock = vi.fn();
    const stop = watchIdle({ lock, win, doc });
    stop();
    vi.setSystemTime(IDLE_LOCK_MS * 2);
    for (const e of ["pageshow", "focus", "pointerdown", "keydown", "scroll", PROGRESS_EVENT]) win.dispatchEvent(new Event(e));
    doc.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(IDLE_LOCK_MS * 2);
    expect(lock).not.toHaveBeenCalled();
  });

  it("a step that lands after the 15 minutes keeps its write to the books, and then they lock", async () => {
    const { win, doc } = page();
    const b = books();
    const stop = watchIdle({ lock: b.lock, win, doc });
    vi.setSystemTime(16 * MINUTE); // one approval in Shield took 16 minutes; the page ran no timer
    await expect(afterStep(b.write("sent: the payment's id"), win)).resolves.toBe("sent: the payment's id");
    expect(b.saved).toEqual(["sent: the payment's id"]);
    expect(b.lock).toHaveBeenCalledTimes(1);
    await expect(b.write("settled")).rejects.toThrow("Books are locked"); // the rest waits for the next time the run is opened
    stop();
  });

  it("noted before its write, the same late step locks the books first and loses its result", async () => {
    const { win, doc } = page();
    const b = books();
    const stop = watchIdle({ lock: b.lock, win, doc });
    vi.setSystemTime(16 * MINUTE);
    noteProgress(win);
    await expect(b.write("sent: the payment's id")).rejects.toThrow("Books are locked");
    expect(b.saved).toEqual([]);
    stop();
  });

  it("a step whose write lands within the 15 minutes keeps the books open, and one whose write fails still counts", async () => {
    const { win, doc } = page();
    const b = books();
    const stop = watchIdle({ lock: b.lock, win, doc });
    vi.setSystemTime(10 * MINUTE);
    await afterStep(b.write("sent"), win);
    vi.setSystemTime(20 * MINUTE);
    await expect(afterStep(Promise.reject(new Error("another tab wrote first")), win)).rejects.toThrow("another tab wrote first");
    vi.setSystemTime(34 * MINUTE);
    win.dispatchEvent(new Event("focus"));
    expect(b.lock).not.toHaveBeenCalled();
    vi.setSystemTime(35 * MINUTE);
    win.dispatchEvent(new Event("focus"));
    expect(b.lock).toHaveBeenCalledTimes(1);
    stop();
  });

  it("noteProgress sends the progress event, and does nothing without a window", () => {
    const win = new EventTarget();
    const heard = vi.fn();
    win.addEventListener(PROGRESS_EVENT, heard);
    noteProgress(win);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(() => noteProgress()).not.toThrow();
  });
});

describe("where the idle lock is wired", () => {
  it("the provider runs the idle lock, listening for progress and for the page waking", () => {
    const provider = read("books/BooksProvider.tsx");
    expect(provider).toContain("watchIdle({ lock })");
    expect(provider).not.toMatch(/setTimeout\(lock, IDLE_LOCK_MS\)/);
    const idle = read("books/idle_lock.ts");
    for (const e of ["PROGRESS_EVENT", '"pointerdown"', '"keydown"', '"scroll"', '"visibilitychange"', '"pageshow"', '"focus"']) expect(idle, e).toContain(e);
  });

  it("a write still saving when the books lock doesn't bring them back into memory", () => {
    const provider = read("books/BooksProvider.tsx");
    // After the save, the books are taken up again only if the session that saved them is still the open one.
    expect(provider).toMatch(
      /const iv = await saveOver\(store, s, companyToJson\(next\), savedIv\.current\);\s*(\/\/[^\n]*\s*)*if \(session\.current !== s\) throw new Error\("Books are locked"\);\s*savedIv\.current = iv;\s*companyRef\.current = next;\s*setCompany\(next\);/,
    );
    expect(provider).not.toContain("savedIv.current = await saveOver(store, s, companyToJson(next)");
  });

  it("the pay panel and the backup to the account note each completed step, after the step's own write", () => {
    const pay = read("chain/PayPanel.tsx");
    expect(pay).toContain('import { afterStep, noteProgress } from "@/books/idle_lock";');
    // "planned" and "split_done" count at once; the four that write a paycheck's outcome count once the write settles.
    expect(pay).toMatch(/case "planned":\s*noteProgress\(\);/);
    expect(pay).toMatch(/case "split_done":\s*noteProgress\(\);/);
    expect(pay).toContain("const writeStep = (workerId: string, target: Settlement) => afterStep(write(workerId, target));");
    for (const kind of ["sent", "settled", "failed", "unconfirmed"]) {
      expect(pay, kind).toMatch(new RegExp(`case "${kind}":\\s*setStage\\([^;]*;\\s*(//[^\\n]*\\s*)*(void |settled\\.push\\(\\s*)writeStep\\(e\\.workerId`));
    }
    expect(pay.match(/writeStep\(e\.workerId/g)).toHaveLength(4);
    // Nothing else notes progress: not the waits for an approval ("splitting", "approving"), not "broadcast".
    expect(pay.match(/noteProgress\(\)/g)).toHaveLength(3);
    // A paystub counts once it has gone out and its delivery is written.
    expect(pay).toMatch(/await sendPaystub\(runId, workerId\);\s*noteProgress\(\);/);
    const backup = read("chain/ChainBackup.tsx");
    expect(backup).toContain('import { afterStep, noteProgress } from "@/books/idle_lock";');
    // Every page but the last at once; the last once the backup is recorded.
    expect(backup).toMatch(/await box\.put\(page\.lookup, page\.envelope, \{ feeMode \}\);\s*sent\+\+;\s*(\/\/[^\n]*\s*)*if \(sent < p\.pages\.length\) noteProgress\(\);\s*\}/);
    expect(backup).toContain("await afterStep(updateCompany((c) => ({ ...markBackedUp(c), chainBackup: p.next })));");
  });
});
