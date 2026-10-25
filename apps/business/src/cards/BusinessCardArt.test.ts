import { describe, expect, it } from "vitest";
import { BRAND } from "@/brand";
import { businessCardMarkup, yearsLabel, yearsOn } from "./BusinessCardArt";

const card = { issuedAt: 20801930, shown: true, since: "2026-10-25T00:08:18.000Z" };

describe("a business's drawn card", () => {
  it("counts whole years from the issue, and none before the date is known", () => {
    expect(yearsOn(card, new Date("2026-10-26T00:00:00Z"))).toBe(0);
    expect(yearsOn(card, new Date("2027-10-26T00:00:00Z"))).toBe(1);
    expect(yearsOn(card, new Date("2031-11-01T00:00:00Z"))).toBe(5);
    expect(yearsOn({ issuedAt: 1, shown: true }, new Date("2031-11-01T00:00:00Z"))).toBe(0);
    expect(yearsLabel(0)).toBe("new");
    expect(yearsLabel(3)).toBe("3 yr");
  });

  it("draws the same card for the same moment, with the name, the title and the app's name on it", () => {
    const now = new Date(2026, 9, 25, 14, 0);
    const a = businessCardMarkup({ name: "dayco", displayName: "Dayco Builders", card, now });
    expect(businessCardMarkup({ name: "dayco", displayName: "Dayco Builders", card, now })).toBe(a);
    expect(a.startsWith("<svg ")).toBe(true);
    expect(a).toContain(`>dayco.${BRAND.nameSuffix}<`);
    expect(a).toContain(">Dayco Builders<");
    expect(a).toContain(`>${BRAND.name}<`);
    expect(a).toContain(">new<");
    expect(a).not.toContain("<script");
    expect(businessCardMarkup({ name: "dayco", displayName: "", card, now })).toContain(`>dayco.${BRAND.nameSuffix}<`);
  });
});
