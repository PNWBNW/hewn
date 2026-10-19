import { describe, expect, it } from "vitest";
import type { PostingBody, PostingFacts } from "../books/jobs";
import {
  BLOCKS_PER_DAY,
  BODY_BYTES,
  BODY_FIELDS,
  type JobsRead,
  MAX_FEATURE_BLOCKS,
  boardOrder,
  bodyInput,
  closeCall,
  daysAllowed,
  featureCall,
  featuredDaysLeft,
  featuredUntilAfter,
  newPostingId,
  packBody,
  parseBodyFields,
  parsePosting,
  postCall,
  readRecent,
  unpackBody,
  updateCall,
} from "./jobs";

const facts: PostingFacts = { payType: "hourly", payMinCents: 2000, payMaxCents: 2500, employmentType: "full_time", hoursPerWeekTenths: 375, place: "remote" };
const body: PostingBody = { title: "Line cook", location: "Tacoma, WA", description: "Evenings and weekends. Bring your knives.\n\nStart Monday." };
const key = { id: "12345", employerNameHash: "777field", suffixCode: 7 };

describe("posting ids", () => {
  it("are field elements under 2^248 and never zero", () => {
    const id = BigInt(newPostingId());
    expect(id).toBeGreaterThan(0n);
    expect(id).toBeLessThan(1n << 248n);
    let calls = 0;
    const zeroThenOnes = (b: Uint8Array) => {
      calls++;
      b.fill(calls === 1 ? 0 : 1);
      return b;
    };
    expect(newPostingId(zeroThenOnes)).not.toBe("0");
    expect(calls).toBe(2);
  });
});

describe("the body", () => {
  it("packs into 40 fields and comes back word for word", async () => {
    const fields = await packBody(body);
    expect(fields).toHaveLength(BODY_FIELDS);
    expect(await unpackBody(fields)).toEqual(body);
    expect(bodyInput(fields)).toMatch(/^\{ words: \[\d+field(, \d+field){39}\] \}$/);
  });
  it("deflates, so a long description still fits", async () => {
    const long = { ...body, description: "Cook, clean, repeat. ".repeat(180) }; // 3,780 chars
    expect(new TextEncoder().encode(long.description).length).toBeGreaterThan(BODY_BYTES);
    expect(await unpackBody(await packBody(long))).toEqual({ ...long, description: long.description.trim() });
  });
  it("refuses what won't fit even deflated", async () => {
    let s = "";
    for (let i = 0; i < 1800; i++) s += String.fromCharCode(0x4e00 + ((i * 7919) % 20000));
    await expect(packBody({ ...body, description: s })).rejects.toThrow(/too long to fit on the board/);
  });
  it("refuses a body it couldn't have made", async () => {
    await expect(unpackBody([1n])).rejects.toThrow(/wrong shape/);
    await expect(unpackBody(new Array(BODY_FIELDS).fill(0n))).rejects.toThrow(/couldn't be read/);
    expect(() => parseBodyFields("{ nope: 1u8 }")).toThrow(/couldn't be read/);
  });
});

describe("the calls", () => {
  it("post and update take the key, the facts and the body in the program's order", async () => {
    const fields = await packBody(body);
    const call = postCall(key, facts, fields);
    expect(call.program).toBe("hewn_jobs_v1.aleo");
    expect(call.function).toBe("post");
    expect(call.inputs.slice(0, 9)).toEqual(["12345field", "777field", "7u8", "1u8", "2000u64", "2500u64", "1u8", "375u16", "2u8"]);
    expect(call.inputs[9]).toBe(bodyInput(fields));
    expect(updateCall(key, facts, fields).function).toBe("update");
  });
  it("feature takes the days, close just the key", () => {
    expect(featureCall(key, 3).inputs).toEqual(["12345field", "777field", "7u8", "3u8"]);
    expect(closeCall(key).inputs).toEqual(["12345field", "777field", "7u8"]);
    expect(() => featureCall(key, 0)).toThrow(/1 to 30 days/);
    expect(() => featureCall(key, 31)).toThrow(/1 to 30 days/);
  });
  it("refuses a bad key before Shield is asked", () => {
    expect(() => closeCall({ ...key, suffixCode: 0 })).toThrow(/industry isn't known/);
    expect(() => closeCall({ ...key, suffixCode: 41 })).toThrow(/industry isn't known/);
    expect(() => closeCall({ ...key, id: "0" })).toThrow(/posting id isn't valid/);
    expect(() => closeCall({ ...key, id: "abc" })).toThrow(/posting id isn't valid/);
    expect(() => closeCall({ ...key, employerNameHash: "" })).toThrow(/business name isn't valid/);
    expect(() => postCall(key, { ...facts, payMinCents: 9000 }, [])).toThrow(/below the bottom/);
  });
});

describe("featuring", () => {
  it("allows up to 30 days ahead, counting what's left", () => {
    expect(daysAllowed(0, 1000)).toBe(30);
    expect(daysAllowed(1000 + 10 * BLOCKS_PER_DAY, 1000)).toBe(20);
    expect(daysAllowed(1000 + MAX_FEATURE_BLOCKS, 1000)).toBe(0);
    expect(daysAllowed(1000 + 10 * BLOCKS_PER_DAY + 1, 1000)).toBe(19);
    expect(featuredUntilAfter(0, 1000, 3)).toBe(1000 + 3 * BLOCKS_PER_DAY);
    expect(featuredUntilAfter(5000, 1000, 3)).toBe(5000 + 3 * BLOCKS_PER_DAY);
    expect(featuredDaysLeft(1000 + BLOCKS_PER_DAY + 1, 1000)).toBe(2);
    expect(featuredDaysLeft(500, 1000)).toBe(0);
  });
  it("orders the board: featured and current first, latest window first, then newest", () => {
    const list = [
      { id: "a", postedHeight: 10, featuredUntil: 0 },
      { id: "b", postedHeight: 20, featuredUntil: 900 }, // window passed
      { id: "c", postedHeight: 5, featuredUntil: 2000 },
      { id: "d", postedHeight: 30, featuredUntil: 1500 },
    ];
    expect(boardOrder(list, 1000).map((p) => p.id)).toEqual(["c", "d", "b", "a"]);
  });
});

describe("reading the board", () => {
  const POSTING = (open: boolean, height: number) =>
    `{\n  employer_name_hash: 777field,\n  posted_height: ${height}u32,\n  open: ${open},\n  featured_until: 0u32,\n  pay_type: 1u8,\n  pay_min: 2000u64,\n  pay_max: 2500u64,\n  employment_type: 1u8,\n  hours_per_week: 375u16,\n  place: 2u8\n}`;
  it("parses a posting as the explorer prints it", () => {
    const p = parsePosting("5field", POSTING(true, 42));
    expect(p).toEqual({ id: "5", employerNameHash: "777", postedHeight: 42, open: true, featuredUntil: 0, facts });
    expect(() => parsePosting("5", "{ open: true }")).toThrow(/couldn't be read/);
    expect(() => parsePosting("5", POSTING(true, 1).replace("pay_type: 1u8", "pay_type: 9u8"))).toThrow(/pay type/);
  });
  it("walks the newest postings by index, with their words, skipping closed ones", async () => {
    const fields = await packBody(body);
    const bodyText = `{\n  words: [\n    ${fields.map((f) => `${f}field`).join(",\n    ")}\n  ]\n}`;
    const asked: string[] = [];
    const read: JobsRead = async (mapping, k) => {
      asked.push(`${mapping}/${k}`);
      if (mapping === "posting_count") return "3u32";
      if (mapping === "posting_at") return ({ "0u32": "100field", "1u32": "200field", "2u32": "300field" })[k] ?? null;
      if (mapping === "postings") return k === "200field" ? POSTING(false, 20) : POSTING(true, k === "300field" ? 30 : 10);
      if (mapping === "posting_body") return k === "100field" ? "{ words: [1field] }" : bodyText;
      return null;
    };
    const { postings, total } = await readRecent(read, 2);
    expect(total).toBe(3);
    expect(postings.map((p) => [p.id, p.postedHeight, p.body?.title ?? null])).toEqual([["300", 30, "Line cook"]]);
    expect(asked).not.toContain("posting_at/0u32");
    const all = await readRecent(read, 10, false);
    expect(all.postings.map((p) => [p.id, p.open, p.body])).toEqual([
      ["300", true, body],
      ["200", false, body],
      ["100", true, null],
    ]);
    expect((await readRecent(async () => null, 5)).postings).toEqual([]);
  });
});
