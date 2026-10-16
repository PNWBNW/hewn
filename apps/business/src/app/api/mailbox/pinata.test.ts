// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PinStoreError, pinataStore } from "./pinata";

const NAME = "8a45f32884aa20563afb9535932161b51369dfddce1d952bc1e8f5341b14416e";
const CID = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";

type Call = { url: string; init: RequestInit };

function fakeFetch(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    return respond({ url, init });
  }) as typeof globalThis.fetch;
  return { calls, fetch };
}

const headersOf = (init: RequestInit) => new Headers(init.headers);

describe("pinata store", () => {
  it("pins with the name as the only metadata, and the key only in the header", async () => {
    const { calls, fetch } = fakeFetch(() => Response.json({ IpfsHash: CID }));
    await pinataStore({ jwt: "jwt-secret", fetch }).pin(NAME, new Uint8Array([1, 2, 3]));
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url).toBe("https://api.pinata.cloud/pinning/pinFileToIPFS");
    expect(init.method).toBe("POST");
    expect(headersOf(init).get("authorization")).toBe("Bearer jwt-secret");
    const form = init.body as FormData;
    expect([...form.keys()].sort()).toEqual(["file", "pinataMetadata", "pinataOptions"]);
    expect(JSON.parse(form.get("pinataMetadata") as string)).toEqual({ name: NAME });
    expect(JSON.parse(form.get("pinataOptions") as string)).toEqual({ cidVersion: 1 });
    const file = form.get("file") as File;
    expect(file.name).toBe(NAME);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(url).not.toContain("jwt-secret");
  });

  it("keeps a keep-until day in the pin's keyvalues", async () => {
    const { calls, fetch } = fakeFetch(() => Response.json({ IpfsHash: CID }));
    await pinataStore({ jwt: "j", fetch }).pin(NAME, new Uint8Array([1]), "2026-11-15");
    const form = calls[0]!.init.body as FormData;
    expect(JSON.parse(form.get("pinataMetadata") as string)).toEqual({ name: NAME, keyvalues: { keepUntil: "2026-11-15" } });
  });

  it("lists only mailbox pins whose keep-until day is before the day asked, whatever the filter returns", async () => {
    const { calls, fetch } = fakeFetch(() =>
      Response.json({
        rows: [
          { ipfs_pin_hash: "gone-1", metadata: { name: NAME, keyvalues: { keepUntil: "2026-10-15" } } },
          { ipfs_pin_hash: "today", metadata: { name: NAME, keyvalues: { keepUntil: "2026-10-16" } } },
          { ipfs_pin_hash: "no-day", metadata: { name: NAME, keyvalues: null } },
          { ipfs_pin_hash: "not-mailbox", metadata: { name: "w4-terms.json", keyvalues: { keepUntil: "2026-01-01" } } },
          { ipfs_pin_hash: "odd-day", metadata: { name: NAME, keyvalues: { keepUntil: "soon" } } },
          { ipfs_pin_hash: "gone-2", metadata: { name: NAME.replace("8a", "9b"), keyvalues: { keepUntil: "2026-09-01" } } },
        ],
      }),
    );
    const store = pinataStore({ jwt: "j", fetch });
    expect(await store.expired("2026-10-16", 500)).toEqual(["gone-1", "gone-2"]);
    expect(await store.expired("2026-10-16", 1)).toEqual(["gone-1"]);
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get("status")).toBe("pinned");
    expect(url.searchParams.get("pageLimit")).toBe("500");
    expect(JSON.parse(url.searchParams.get("metadata[keyvalues]")!)).toEqual({ keepUntil: { value: "2026-10-16", op: "lt" } });
  });

  it("finds a pin by exact name, ignoring near matches", async () => {
    const { calls, fetch } = fakeFetch(() =>
      Response.json({
        rows: [
          { ipfs_pin_hash: "other", metadata: { name: NAME + "0" } },
          { ipfs_pin_hash: CID, metadata: { name: NAME } },
        ],
      }),
    );
    const store = pinataStore({ jwt: "j", fetch });
    expect(await store.find(NAME)).toBe(CID);
    expect(calls[0]!.url).toBe(
      `https://api.pinata.cloud/data/pinList?status=pinned&pageLimit=10&metadata[name]=${NAME}`,
    );
    expect(headersOf(calls[0]!.init).get("authorization")).toBe("Bearer j");
  });

  it("finds nothing when there are no rows", async () => {
    const { fetch } = fakeFetch(() => Response.json({ rows: [] }));
    expect(await pinataStore({ jwt: "j", fetch }).find(NAME)).toBeNull();
  });

  it("reads from the gateway without the key, null on 404", async () => {
    const { calls, fetch } = fakeFetch(({ url }) =>
      url.endsWith(CID) ? new Response(new Uint8Array([7, 7])) : new Response(null, { status: 404 }),
    );
    const store = pinataStore({ jwt: "j", gateway: "https://books.mypinata.cloud/", fetch });
    expect(await store.fetch(CID)).toEqual(new Uint8Array([7, 7]));
    expect(calls[0]!.url).toBe(`https://books.mypinata.cloud/ipfs/${CID}`);
    expect(headersOf(calls[0]!.init).get("authorization")).toBeNull();
    expect(await store.fetch("missing")).toBeNull();
    expect(calls[1]!.url).toBe("https://books.mypinata.cloud/ipfs/missing");
  });

  it("defaults to the public gateway", async () => {
    const { calls, fetch } = fakeFetch(() => new Response(new Uint8Array(0)));
    await pinataStore({ jwt: "j", fetch }).fetch(CID);
    expect(calls[0]!.url).toBe(`https://gateway.pinata.cloud/ipfs/${CID}`);
  });

  it("unpins, and treats 404 or 400 as already gone", async () => {
    for (const status of [200, 404, 400]) {
      const { calls, fetch } = fakeFetch(() => new Response(null, { status }));
      await pinataStore({ jwt: "j", fetch }).unpin(CID);
      expect(calls[0]!.url).toBe(`https://api.pinata.cloud/pinning/unpin/${CID}`);
      expect(calls[0]!.init.method).toBe("DELETE");
    }
  });

  it("raises a PinStoreError on any other failure", async () => {
    const { fetch } = fakeFetch(() => new Response(null, { status: 500 }));
    const store = pinataStore({ jwt: "j", fetch });
    await expect(store.find(NAME)).rejects.toBeInstanceOf(PinStoreError);
    await expect(store.pin(NAME, new Uint8Array(1))).rejects.toBeInstanceOf(PinStoreError);
    await expect(store.fetch(CID)).rejects.toBeInstanceOf(PinStoreError);
    await expect(store.unpin(CID)).rejects.toBeInstanceOf(PinStoreError);
    await expect(store.expired("2026-10-16", 10)).rejects.toBeInstanceOf(PinStoreError);
  });
});
