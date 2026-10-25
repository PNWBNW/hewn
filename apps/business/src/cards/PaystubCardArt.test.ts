import { describe, expect, it } from "vitest";
import { BRAND } from "@/brand";
import { paystubCardMarkup } from "./PaystubCardArt";

const p = {
  name: "ana_w",
  registered: true,
  paystubHash: "5c01d3e9".padEnd(64, "a"),
  businessName: "Dayco <Builders> & Co",
  payDate: "2026-10-30",
  periodStart: "2026-10-12",
  periodEnd: "2026-10-25",
  place: { n: 22, of: 26 },
};

describe("a paystub's drawn card", () => {
  it("is the same for the same paystub and says its place, who paid and the dates, never an amount", () => {
    const a = paystubCardMarkup(p);
    expect(paystubCardMarkup(p)).toBe(a);
    expect(a.startsWith("<svg ")).toBe(true);
    expect(a).toContain(`>ana_w.${BRAND.nameSuffix}<`);
    expect(a).toContain(">PAYSTUB<");
    expect(a).toContain(">22 of 26 · 2026<");
    expect(a).toContain(">Dayco &lt;Builders&gt; &amp; Co<");
    expect(a).toContain(">2026-10-12 to 2026-10-25 · paid 2026-10-30<");
    expect(a).toContain(">art v1 · 5c01d3e9<");
    expect(a).toContain(`>${BRAND.name}<`);
    expect(a).not.toContain("$");
    expect(a).not.toContain("<script");
    expect(a).not.toContain("✓");
  });

  it("shows the check line only when given, and the bare name when it isn't registered", () => {
    expect(paystubCardMarkup({ ...p, check: "Sealed by Dayco Builders · paid on the rail" })).toContain(">✓ Sealed by Dayco Builders · paid on the rail<");
    expect(paystubCardMarkup({ ...p, name: "Ana W", registered: false })).toContain(">Ana W<");
  });

  it("lights a different star and shapes different rings for another paystub of the same person", () => {
    expect(paystubCardMarkup({ ...p, paystubHash: "7e".repeat(32), place: { n: 23, of: 26 } })).not.toBe(paystubCardMarkup(p));
  });
});
