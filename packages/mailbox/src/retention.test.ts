import { describe, expect, it } from "vitest";
import { MailboxError } from "./envelope";
import { MAX_KEEP_DAYS, checkKeepUntil, isPastKeep, keepUntilAfter, utcDay } from "./retention";

const TODAY = new Date("2026-10-16T23:30:00.000Z");

describe("keep-until days", () => {
  it("are UTC calendar days, counted from a time", () => {
    expect(utcDay(TODAY)).toBe("2026-10-16");
    expect(keepUntilAfter(TODAY, 0)).toBe("2026-10-16");
    expect(keepUntilAfter(TODAY, 30)).toBe("2026-11-15");
    expect(() => keepUntilAfter(TODAY, MAX_KEEP_DAYS + 1)).toThrow(MailboxError);
    expect(() => keepUntilAfter(TODAY, -1)).toThrow(MailboxError);
  });

  it("must be a real day, from today to at most 60 days on", () => {
    expect(checkKeepUntil("2026-10-16", TODAY)).toBe("2026-10-16");
    expect(checkKeepUntil(keepUntilAfter(TODAY, MAX_KEEP_DAYS), TODAY)).toBe("2026-12-15");
    for (const bad of ["2026-10-15", "2026-12-16", "2026-02-30", "16/10/2026", "2026-10-16T00:00:00Z", 20261016, undefined]) {
      expect(() => checkKeepUntil(bad, TODAY), String(bad)).toThrow(MailboxError);
    }
  });

  it("let a pin go only once its whole day has passed", () => {
    expect(isPastKeep("2026-10-16", TODAY)).toBe(false);
    expect(isPastKeep("2026-10-15", TODAY)).toBe(true);
    expect(isPastKeep("2026-10-17", TODAY)).toBe(false);
  });
});
