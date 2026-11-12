// The check before any signature (./editions.ts): every upgradable program is at an edition this
// version of the app was made for, or nothing is sent.

import { describe, expect, it } from "vitest";
import { EDITIONS, EXTERNAL_EDITIONS, PROGRAMS } from "@pnw/config/programs";
import { EditionError, checkEditions } from "./editions";

const A = "one_program.aleo";
const B = "another_program.aleo";
const PINNED = { [A]: [1], [B]: [0, 1] };

/** An explorer that answers each program's edition from `chain`, counting what it was asked. */
function explorer(chain: Record<string, number | "down" | "garbage" | "hang">) {
  const asked: string[] = [];
  const fetchImpl = (async (url: string, init?: unknown) => {
    const program = /\/program\/([^/]+)\/latest_edition$/.exec(String(url))?.[1] ?? "";
    asked.push(program);
    const answer = chain[program];
    if (answer === "down") throw new TypeError("network");
    if (answer === "hang") {
      // Never answers; gives up only when the request's own signal does.
      return new Promise((_, reject) => (init as RequestInit | undefined)?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    }
    if (answer === undefined) return { ok: false, status: 404, json: async () => null };
    return { ok: true, status: 200, json: async () => (answer === "garbage" ? "1" : answer) };
  }) as unknown as typeof fetch;
  return { fetchImpl, asked, chain };
}

describe("the editions check before signing", () => {
  it("passes when every pinned program is at an edition the app lists, and asks the network every time", async () => {
    const x = explorer({ [A]: 1, [B]: 1 });
    const options = { endpoint: "https://explorer.example/v2/testnet", fetchImpl: x.fetchImpl, editions: PINNED };
    await expect(checkEditions(options)).resolves.toBeUndefined();
    expect([...x.asked].sort()).toEqual([B, A]);
    // A second send a moment later (a worker's setup is two) asks again: no answer is reused.
    await checkEditions(options);
    expect(x.asked).toHaveLength(4);
  });

  it("refuses the second of two sends when a program is upgraded between them", async () => {
    const x = explorer({ [A]: 1, [B]: 0 });
    const options = { endpoint: "e", fetchImpl: x.fetchImpl, editions: PINNED };
    await expect(checkEditions(options)).resolves.toBeUndefined();
    x.chain[A] = 2;
    await expect(checkEditions(options)).rejects.toThrow(/one_program\.aleo \(now edition 2\)/);
  });

  it("gives up on an explorer that doesn't answer, and sends nothing", async () => {
    const x = explorer({ [A]: "hang", [B]: 0 });
    const refused = await checkEditions({ endpoint: "e", fetchImpl: x.fetchImpl, editions: PINNED, timeoutMs: 20 }).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(EditionError);
    expect((refused as Error).message).toMatch(/Couldn't check/);
  });

  it("refuses when any pinned program is at another edition, naming it, and asks again next time", async () => {
    const x = explorer({ [A]: 2, [B]: 0 });
    const options = { endpoint: "e", fetchImpl: x.fetchImpl, editions: PINNED };
    const refused = await checkEditions(options).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(EditionError);
    expect((refused as Error).message).toMatch(/one_program\.aleo \(now edition 2\)/);
    expect((refused as Error).message).toMatch(/Nothing was sent/);
    expect((refused as Error).message).not.toMatch(/another_program/);
    // A wrong answer is never kept: once the chain reads right again, the next try passes.
    x.chain[A] = 1;
    await expect(checkEditions(options)).resolves.toBeUndefined();
  });

  it("refuses when the network can't be asked, or answers something that isn't an edition", async () => {
    for (const bad of ["down", "garbage", undefined] as const) {
      const chain: Record<string, number | "down" | "garbage"> = { [B]: 0 };
      if (bad !== undefined) chain[A] = bad;
      const x = explorer(chain);
      const refused = await checkEditions({ endpoint: "e", fetchImpl: x.fetchImpl, editions: PINNED }).catch((e: unknown) => e);
      expect(refused).toBeInstanceOf(EditionError);
      expect((refused as Error).message).toMatch(/Couldn't check/);
    }
  });

  it("pins something: the app's own list is not empty, and it includes the stablecoin", () => {
    expect(Object.keys(EDITIONS).length).toBeGreaterThan(0);
    expect(EXTERNAL_EDITIONS[PROGRAMS.external.usdcx]).toBeDefined();
    expect(EDITIONS[PROGRAMS.external.usdcx]).toEqual(EXTERNAL_EDITIONS[PROGRAMS.external.usdcx]);
  });
});
