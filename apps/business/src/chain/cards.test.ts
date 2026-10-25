import { describe, expect, it } from "vitest";
import { PROGRAMS } from "@pnw/config/programs";
import {
  CARDS_PROGRAM,
  CardsError,
  HIDE_CARD,
  ISSUE_BUSINESS_CARD,
  ISSUE_WORKER_CARD,
  SHOW_CARD,
  awaitCard,
  blockTime,
  explorerCardsRead,
  issueBusinessCardInputs,
  issueWorkerCardInputs,
  parseCard,
  queryCard,
  switchCardInputs,
} from "./cards";

const HASH = "4150315520783996034609855426744788863384829253862985467052843096256898893367";
const ENTRY = "{\n  issued_at: 20801930u32,\n  shown: true\n}";

const fakeFetch = (handler: (url: string) => { status: number; body?: unknown }): typeof fetch =>
  (async (input: string | URL | Request) => {
    const r = handler(String(input));
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body } as Response;
  }) as typeof fetch;

describe("the cards program's calls", () => {
  it("go to hewn_cards_v1, by the names the manifest gives", () => {
    expect(CARDS_PROGRAM).toBe("hewn_cards_v1.aleo");
    expect(CARDS_PROGRAM).toBe(PROGRAMS.cards.hewn_cards);
    expect(ISSUE_BUSINESS_CARD).toEqual({ program: CARDS_PROGRAM, function: "issue_business_card" });
    expect(ISSUE_WORKER_CARD).toEqual({ program: CARDS_PROGRAM, function: "issue_worker_card" });
    expect(SHOW_CARD).toEqual({ program: CARDS_PROGRAM, function: "show_card" });
    expect(HIDE_CARD).toEqual({ program: CARDS_PROGRAM, function: "hide_card" });
  });

  it("take the name hash as a field and the industry as a u8, in that order", () => {
    expect(issueBusinessCardInputs(HASH, 9)).toEqual([`${HASH}field`, "9u8"]);
    expect(issueBusinessCardInputs(`${HASH}field`, 40)).toEqual([`${HASH}field`, "40u8"]);
  });

  it("take the name hash and whether a worker's card starts shown", () => {
    expect(issueWorkerCardInputs(HASH, true)).toEqual([`${HASH}field`, "true"]);
    expect(issueWorkerCardInputs(HASH, false)).toEqual([`${HASH}field`, "false"]);
    expect(switchCardInputs(` ${HASH}field `)).toEqual([`${HASH}field`]);
  });

  it("refuse an industry the registry wouldn't hold, and a hash that isn't one", () => {
    for (const code of [0, 41, -1, 1.5, Number.NaN]) expect(() => issueBusinessCardInputs(HASH, code)).toThrow(CardsError);
    for (const bad of ["", "abc", "12field3", "0x12", "12.5"]) expect(() => switchCardInputs(bad)).toThrow(/registered name/);
  });
});

describe("reading a card", () => {
  it("parses the explorer's text for the entry", () => {
    expect(parseCard(ENTRY)).toEqual({ issuedAt: 20801930, shown: true });
    expect(parseCard("{issued_at:7u32,shown:false}")).toEqual({ issuedAt: 7, shown: false });
  });

  it("refuses text that isn't a card", () => {
    for (const bad of ["", "{ issued_at: 7u32 }", "{ shown: true }", "{ issued_at: 99999999999u32, shown: true }", "{ issued_at: 7u64, shown: maybe }"]) {
      expect(() => parseCard(bad)).toThrow(CardsError);
    }
  });

  it("is null for a name with no card, and the card otherwise", async () => {
    expect(await queryCard(HASH, async () => null)).toBeNull();
    expect(await queryCard(HASH, async () => ENTRY)).toEqual({ issuedAt: 20801930, shown: true });
  });

  it("asks the explorer for cards[<hash>field] and reads 404 and null as no card", async () => {
    const urls: string[] = [];
    const read = explorerCardsRead("https://x/v2/testnet", fakeFetch((url) => (urls.push(url), { status: 200, body: ENTRY })));
    expect(await read(HASH)).toBe(ENTRY);
    expect(urls).toEqual([`https://x/v2/testnet/program/hewn_cards_v1.aleo/mapping/cards/${HASH}field`]);
    expect(await explorerCardsRead("https://x", fakeFetch(() => ({ status: 404 })))(HASH)).toBeNull();
    expect(await explorerCardsRead("https://x", fakeFetch(() => ({ status: 200, body: null })))(HASH)).toBeNull();
    await expect(explorerCardsRead("https://x", fakeFetch(() => ({ status: 500 })))(HASH)).rejects.toThrow(/couldn't be read/);
  });
});

describe("waiting for a card after Shield accepted the transaction", () => {
  it("returns the entry once the explorer shows it, trying again through a miss and a failed read", async () => {
    const answers: (string | null | Error)[] = [null, new Error("down"), ENTRY];
    const waits: number[] = [];
    const read = async () => {
      const a = answers.shift() ?? null;
      if (a instanceof Error) throw a;
      return a;
    };
    const card = await awaitCard(HASH, { read, sleep: async (ms) => void waits.push(ms), waitMs: 7 });
    expect(card).toEqual({ issuedAt: 20801930, shown: true });
    expect(waits).toEqual([7, 7]);
  });

  it("waits for the state a switch asked for, and gives up after its attempts", async () => {
    const hidden = "{ issued_at: 20801930u32, shown: false }";
    let n = 0;
    const read = async () => (++n < 3 ? ENTRY : hidden);
    expect(await awaitCard(HASH, { read, sleep: async () => {}, until: (c) => !c.shown })).toEqual({ issuedAt: 20801930, shown: false });
    await expect(awaitCard(HASH, { read: async () => null, sleep: async () => {}, attempts: 3 })).rejects.toThrow(/isn't showing yet/);
  });
});

describe("a block's time", () => {
  it("comes from the block's header, in seconds, as ISO", async () => {
    const f = fakeFetch((url) => (url.endsWith("/block/20801930") ? { status: 200, body: { header: { metadata: { timestamp: 1792886898 } } } } : { status: 404 }));
    expect(await blockTime(20801930, "https://x", f)).toBe("2026-10-25T00:08:18.000Z");
    expect(await blockTime(20801930, "https://x", fakeFetch(() => ({ status: 200, body: { header: { metadata: { timestamp: "1792886898" } } } })))).toBe("2026-10-25T00:08:18.000Z");
  });

  it("is null when the explorer can't say", async () => {
    expect(await blockTime(1, "https://x", fakeFetch(() => ({ status: 404 })))).toBeNull();
    expect(await blockTime(1, "https://x", fakeFetch(() => ({ status: 200, body: {} })))).toBeNull();
    expect(await blockTime(-1, "https://x", fakeFetch(() => ({ status: 200, body: {} })))).toBeNull();
    expect(await blockTime(1, "https://x", (async () => { throw new Error("offline"); }) as typeof fetch)).toBeNull();
  });
});
