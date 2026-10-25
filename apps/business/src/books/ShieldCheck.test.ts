import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Reconciliation } from "./reconcile";
import { ShieldCheckView } from "./ShieldCheck";

const html = (result: Reconciliation) => renderToStaticMarkup(createElement(ShieldCheckView, { result }));
const text = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&#x27;|&apos;/g, "'");

describe("the Shield check on the Dashboard", () => {
  it("shows nothing before the books follow Shield, or before the balance is read", () => {
    expect(html({ kind: "not_started" })).toBe("");
    expect(html({ kind: "unread", books: 2000n })).toBe("");
  });

  it("says quietly when the two agree, the difference is waiting in For review, or pay is settling", () => {
    expect(text(html({ kind: "matches", books: 2000n, shield: 2000n }))).toContain("Matches the books' Shield account (20.00)");
    const waiting = html({ kind: "waiting", books: 2000n, shield: 2325n, count: 2, minor: 3_250_000n });
    expect(text(waiting)).toContain("The difference is 2 transactions waiting in For review.");
    expect(waiting).toContain('href="/transactions?tab=review"');
    expect(text(html({ kind: "settling", books: 1500n, shield: 2000n, count: 1 }))).toContain("Pay is still settling (1 paycheck)");
    for (const quiet of [html({ kind: "matches", books: 1n, shield: 1n }), waiting]) expect(quiet).not.toContain('role="status"');
  });

  it("flags a difference nothing explains, with both figures and where to look", () => {
    const off = html({ kind: "off", books: 1700n, shield: 2000n, gap: 3_000_000n });
    expect(off).toContain('role="status"');
    expect(text(off)).toContain("The books don't match Shield");
    expect(text(off)).toContain("The books' Shield account shows 17.00; Shield holds 20.00.");
    expect(text(off)).toContain("Cash and other bank accounts aren't part of this.");
    expect(off).toContain('href="/transactions?tab=review"');
  });
});
