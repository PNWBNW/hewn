import { describe, expect, it } from "vitest";
import { BRAND } from "@/brand";
import { workerCardText } from "./WorkerCardArt";

const card = { issuedAt: 20801930, shown: false, since: "2026-10-25T00:08:18.000Z" };

describe("a worker's card's words", () => {
  it("say new until a year has passed, then the years", () => {
    const fresh = workerCardText("ana_w", card, new Date("2026-11-01T00:00:00Z"));
    expect(fresh.years).toBe(0);
    expect(fresh.text.kind).toBe("NEW");
    expect(fresh.text.title).toBe(`ana_w.${BRAND.nameSuffix} · new on ${BRAND.name}`);
    const later = workerCardText("ana_w", card, new Date("2029-11-01T00:00:00Z"));
    expect(later.years).toBe(3);
    expect(later.text.kind).toBe("YEAR 3");
    expect(later.text.title).toContain("3 years on");
    expect(workerCardText("ana_w", card, new Date("2027-11-01T00:00:00Z")).text.title).toContain("1 year on");
    expect(later.text.footer).toBe(`${BRAND.name} · private view`);
    expect(later.text.name).toBe(`ana_w.${BRAND.nameSuffix}`);
  });
});
