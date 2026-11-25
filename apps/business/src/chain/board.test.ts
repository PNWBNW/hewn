import { describe, expect, it } from "vitest";
import type { PostingFacts } from "../books/jobs";
import { type BoardEntry, type BoardReads, filterBoard, loadBoard } from "./board";
import { BLOCKS_PER_DAY, packBody } from "./jobs";

const facts: PostingFacts = { payType: "hourly", payMinCents: 2000, payMaxCents: 2500, employmentType: "full_time", hoursPerWeekTenths: 375, place: "remote" };
const entry = (id: string, extra: Partial<BoardEntry> = {}): BoardEntry => ({
  id,
  employerNameHash: "777",
  postedHeight: 10,
  open: true,
  featuredUntil: 0,
  facts,
  body: { title: "Line cook", location: "Tacoma, WA", description: "Evenings and weekends." },
  businessName: "dayco",
  featured: false,
  ...extra,
});

describe("loading the board", () => {
  it("reads the newest postings, orders them, and names each business once", async () => {
    const fields = await packBody({ title: "Line cook", location: "Tacoma", description: "Nights." });
    const bodyText = `{ words: [${fields.map((f) => `${f}field`).join(", ")}] }`;
    const posting = (hash: string, height: number, until: number) =>
      `{ employer_name_hash: ${hash}field, posted_height: ${height}u32, open: true, featured_until: ${until}u32, pay_type: 1u8, pay_min: 2000u64, pay_max: 2500u64, employment_type: 1u8, hours_per_week: 375u16, place: 2u8 }`;
    const named: string[] = [];
    const reads: BoardReads = {
      height: async () => 1000,
      name: async (h) => {
        named.push(h);
        return h === "777" ? "dayco" : null;
      },
      read: async (mapping, key) => {
        if (mapping === "posting_count") return "3u32";
        if (mapping === "posting_at") return ({ "0u32": "1field", "1u32": "2field", "2u32": "3field" })[key] ?? null;
        if (mapping === "postings") return ({ "1field": posting("777", 10, 0), "2field": posting("888", 20, 1000 + BLOCKS_PER_DAY), "3field": posting("777", 30, 0) })[key] ?? null;
        return bodyText;
      },
    };
    const { entries, height, total } = await loadBoard(reads);
    expect(height).toBe(1000);
    expect(total).toBe(3);
    expect(entries.map((e) => [e.id, e.businessName, e.featured, e.body?.title])).toEqual([
      ["2", "", true, "Line cook"],
      ["3", "dayco", false, "Line cook"],
      ["1", "dayco", false, "Line cook"],
    ]);
    expect(named.sort()).toEqual(["777", "888"]);
  });
});

describe("filtering the board", () => {
  const list = [entry("1"), entry("2", { facts: { ...facts, employmentType: "part_time", place: "on_site" }, body: { title: "Dishwasher", location: "Seattle", description: "Weekends." }, businessName: "acme" }), entry("3", { body: null })];
  it("matches every word, in any case, across the words and the business name", () => {
    expect(filterBoard(list, { text: "COOK tacoma" }).map((e) => e.id)).toEqual(["1"]);
    expect(filterBoard(list, { text: "acme" }).map((e) => e.id)).toEqual(["2"]);
    expect(filterBoard(list, { text: "weekends" }).map((e) => e.id)).toEqual(["1", "2"]);
    expect(filterBoard(list, { text: "  " }).map((e) => e.id)).toEqual(["1", "2", "3"]);
  });
  it("narrows on the facts", () => {
    expect(filterBoard(list, { employmentType: "part_time" }).map((e) => e.id)).toEqual(["2"]);
    expect(filterBoard(list, { place: "remote" }).map((e) => e.id)).toEqual(["1", "3"]);
    expect(filterBoard(list, { payType: "yearly" })).toEqual([]);
    expect(filterBoard(list, { employmentType: "", place: "", payType: "" })).toHaveLength(3);
  });
});
