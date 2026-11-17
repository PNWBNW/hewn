// The desktop pairing path, against the adapter's own relay transport (vendored from
// ProvableHQ/shield-relay into @provablehq/aleo-wallet-adapter-shield 1.5.0) with the relay socket
// stood in for and the Shield app simulated by the protocol's own rules: a key handshake MACed with
// the pairing secret, then sealed, signed messages. Nothing here touches the network, and no
// account key is involved: the only keys are the throwaway relay keys the protocol mints per pairing.

import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import jsQR from "jsqr";
import { BRAND } from "@pnw/brand";
import { PAIRING_WAIT_MS, SELECTED_WALLET_KEY, SHIELD_SESSION_KEY, desktopPairingLink, forgetUnfinishedPairing } from "./desktop_pairing";
import { encodeQr } from "./qr";
import { SHIELD_RELAY_ORIGIN, WALLET_PROGRAMS } from "./wallet-provider";

const require = createRequire(import.meta.url);
const ADAPTER_MAIN = require.resolve("@provablehq/aleo-wallet-adapter-shield");
const ADAPTER_DIST = dirname(ADAPTER_MAIN);
// The adapter's own dependencies, resolved from where it is installed (pnpm keeps them beside it).
const fromAdapter = createRequire(ADAPTER_MAIN);
const ecies = fromAdapter("eciesjs") as {
  PrivateKey: new () => { secret: Uint8Array; publicKey: { toHex(compressed?: boolean): string } };
  encrypt(receiverPublicKeyHex: string, data: Uint8Array): Uint8Array;
  decrypt(receiverSecret: Uint8Array, data: Uint8Array): Uint8Array;
};
const { secp256k1 } = fromAdapter("@noble/curves/secp256k1") as {
  secp256k1: { sign(digest: Uint8Array, secret: Uint8Array): { toCompactHex(): string } };
};
const { sha256 } = fromAdapter("@noble/hashes/sha256") as { sha256(data: Uint8Array): Uint8Array };

const ORIGIN = BRAND.appUrl;

type Envelope = { from: "dapp" | "wallet"; payload: { type: string; data?: string; publicKey?: string; mac?: string; version?: number } };
type Transport = {
  connect(grant?: unknown): Promise<{ url: string; resumed: boolean; connected?: Promise<unknown> }>;
  waitForWallet(): Promise<void>;
  request<T>(method: string, params?: unknown): Promise<T>;
  disconnect(): void;
  on(event: string, listener: (data?: unknown) => void): void;
  readonly connected: boolean;
};

/** The adapter's relay transport, with the socket replaced by a list of what it publishes, and its storage by `memory`. */
async function relayTransport(memory = new Map<string, string>()): Promise<{ transport: Transport; published: Envelope[]; deliver(payload: Envelope["payload"]): void }> {
  // The transport chunk isn't in the package's exports; the version is pinned exactly, and the
  // file name is checked below so a bump that renames it fails here, not quietly.
  const chunk = readFileSync(join(ADAPTER_DIST, "index.mjs"), "utf8").match(/import\("\.\/(transport-[A-Z0-9]+\.mjs)"\)/);
  expect(chunk, "the adapter still lazy-loads its relay transport chunk").not.toBeNull();
  const { RemoteShieldTransport } = (await import(pathToFileURL(join(ADAPTER_DIST, chunk![1])).href)) as { RemoteShieldTransport: new (o: object) => Transport };
  const published: Envelope[] = [];
  const transport = new RemoteShieldTransport({
    relayUrl: SHIELD_RELAY_ORIGIN,
    deeplinkBase: "shield://connect",
    origin: ORIGIN,
    storage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, v), removeItem: (k: string) => void memory.delete(k) },
  });
  const internals = transport as unknown as { joinRelay(): Promise<void>; subscription?: unknown; centrifuge?: unknown; handlePayload(p: unknown): void };
  internals.joinRelay = async () => {
    internals.subscription = {
      publish: async (envelope: Envelope) => void published.push(envelope),
      presence: async () => ({ clients: {} }),
      unsubscribe: () => undefined,
    };
    internals.centrifuge = { disconnect: () => undefined };
  };
  // The connect a test leaves unanswered is rejected when it disconnects; that is expected here.
  const connect = transport.connect.bind(transport);
  transport.connect = async (grant?: unknown) => {
    const result = await connect(grant);
    result.connected?.catch(() => undefined);
    return result;
  };
  return { transport, published, deliver: (payload) => internals.handlePayload(payload) };
}

/** What the Shield app does with a pairing link: a fresh relay key, and the handshake MACed with the secret. */
function walletJoins(link: string, key = new ecies.PrivateKey()) {
  const params = new URL(link).searchParams;
  const publicKey = key.publicKey.toHex(true);
  const transcript = JSON.stringify([
    "shield-relay-key-handshake-v1",
    Number(params.get("v")),
    params.get("channelId"),
    params.get("origin"),
    params.get("pubkey")!.toLowerCase(),
    publicKey.toLowerCase(),
  ]);
  const mac = createHmac("sha256", Buffer.from(params.get("secret")!, "hex")).update(transcript).digest("hex");
  return { key, dappKey: params.get("pubkey")!, handshake: { type: "key_handshake", version: 1, publicKey, mac } };
}

function open(key: InstanceType<typeof ecies.PrivateKey>, data: string): { seq: number; msg: { kind: string; id: string; method: string; params: unknown; origin: string } } {
  const signed = JSON.parse(new TextDecoder().decode(ecies.decrypt(key.secret, Buffer.from(data, "base64")))) as { sealed: string };
  return JSON.parse(signed.sealed);
}

function seal(key: InstanceType<typeof ecies.PrivateKey>, to: string, seq: number, msg: object): string {
  const sealed = JSON.stringify({ seq, msg });
  const sig = secp256k1.sign(sha256(new TextEncoder().encode(sealed)), key.secret).toCompactHex();
  return Buffer.from(ecies.encrypt(to, new TextEncoder().encode(JSON.stringify({ sealed, sig })))).toString("base64");
}

const GRANT = ["testnet", "OnChainHistory", WALLET_PROGRAMS, { dapp: { name: BRAND.name, sameDevice: false } }];

afterEach(() => vi.restoreAllMocks());

describe("desktopPairingLink", () => {
  it("shows the adapter's real link without the bundled request, and every pairing field intact", async () => {
    const { transport } = await relayTransport();
    const { url } = await transport.connect(GRANT);
    expect(url.length).toBeGreaterThan(1000); // the bundled connect with every program
    const link = desktopPairingLink(url, false, ORIGIN)!;
    expect(link).not.toBeNull();
    expect(link.length).toBeLessThan(400);
    const before = new URL(url).searchParams;
    const after = new URL(link).searchParams;
    expect([...after.keys()]).toEqual(["channelId", "pubkey", "relay", "origin", "secret", "v"]);
    for (const key of after.keys()) expect(after.get(key)).toBe(before.get(key));
    expect(link.startsWith("shield://connect?")).toBe(true);
    transport.disconnect();
  });

  it("fits a small QR code a camera reads, which decodes to the same link", async () => {
    const { transport } = await relayTransport();
    const link = desktopPairingLink((await transport.connect(GRANT)).url, false, ORIGIN)!;
    const code = encodeQr(link, "M");
    expect(code.version).toBeLessThanOrEqual(14);
    const scale = 4;
    const side = (code.size + 8) * scale;
    const pixels = new Uint8ClampedArray(side * side * 4).fill(255);
    code.modules.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (!dark) return;
        for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) pixels.fill(0, (((y + 4) * scale + dy) * side + (x + 4) * scale + dx) * 4, (((y + 4) * scale + dy) * side + (x + 4) * scale + dx) * 4 + 3);
      }),
    );
    expect(jsQR(pixels, side, side)?.data).toBe(link);
    transport.disconnect();
  });

  it("shows nothing for a phone, where the adapter opens Shield itself, or when there is no link", () => {
    expect(desktopPairingLink(null, false)).toBeNull();
    expect(desktopPairingLink(undefined, false)).toBeNull();
    expect(desktopPairingLink("", false)).toBeNull();
    const ok = `shield://connect?channelId=6f1c2a3b-0000-4000-8000-000000000001&pubkey=02${"a".repeat(64)}&relay=${encodeURIComponent(SHIELD_RELAY_ORIGIN)}&origin=${encodeURIComponent(ORIGIN)}&secret=${"b".repeat(64)}&v=1`;
    expect(desktopPairingLink(ok, false, ORIGIN)).toBe(ok);
    expect(desktopPairingLink(ok, true, ORIGIN)).toBeNull();
  });

  it("refuses anything but a Shield pairing link on Shield's relay for this site", () => {
    const parts = {
      channelId: "6f1c2a3b-0000-4000-8000-000000000001",
      pubkey: `02${"a".repeat(64)}`,
      relay: SHIELD_RELAY_ORIGIN,
      origin: ORIGIN,
      secret: "b".repeat(64),
      v: "1",
    };
    const build = (over: Record<string, string | null>, base = "shield://connect") => {
      const url = new URL(base);
      for (const [k, v] of Object.entries({ ...parts, ...over })) if (v !== null) url.searchParams.set(k, v);
      return url.toString();
    };
    expect(desktopPairingLink(build({}), false, ORIGIN)).not.toBeNull();
    // Another relay: a code that sends Shield to a relay of someone else's choosing.
    expect(desktopPairingLink(build({ relay: "wss://relay.example.com" }), false, ORIGIN)).toBeNull();
    // Another site's origin, or another scheme or route.
    expect(desktopPairingLink(build({ origin: "https://evil.example" }), false, ORIGIN)).toBeNull();
    expect(desktopPairingLink(build({}, "https://app.shield.app/connect"), false, ORIGIN)).toBeNull();
    expect(desktopPairingLink(build({}, "shield://wake"), false, ORIGIN)).toBeNull();
    expect(desktopPairingLink(build({}, "evil://connect"), false, ORIGIN)).toBeNull();
    // A missing or malformed field, an unknown one, a duplicate, another protocol version.
    for (const key of Object.keys(parts)) expect(desktopPairingLink(build({ [key]: null }), false, ORIGIN), key).toBeNull();
    expect(desktopPairingLink(build({ secret: "b".repeat(63) }), false, ORIGIN)).toBeNull();
    expect(desktopPairingLink(build({ pubkey: "04" + "a".repeat(64) }), false, ORIGIN)).toBeNull();
    expect(desktopPairingLink(build({ v: "2" }), false, ORIGIN)).toBeNull();
    expect(desktopPairingLink(build({ extra: "1" }), false, ORIGIN)).toBeNull();
    expect(desktopPairingLink(`${build({})}&secret=${"c".repeat(64)}`, false, ORIGIN)).toBeNull();
    expect(desktopPairingLink(`${build({})}#x`, false, ORIGIN)).toBeNull();
    expect(desktopPairingLink("not a url", false, ORIGIN)).toBeNull();
  });

  it("never prints the link", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const { transport } = await relayTransport();
    const link = desktopPairingLink((await transport.connect(GRANT)).url, false, ORIGIN);
    desktopPairingLink("shield://connect?secret=1", false, ORIGIN);
    expect(link).not.toBeNull();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    transport.disconnect();
  });
});

describe("pairing a computer through the shown link (the adapter's transport, a simulated Shield app)", () => {
  it("pairs, and the connect the link no longer carries goes over the sealed channel", async () => {
    const second = await relayTransport();
    const { url, connected: answer } = await second.transport.connect(GRANT);
    const shown = desktopPairingLink(url, false, ORIGIN)!;
    const wallet = walletJoins(shown);
    second.deliver(wallet.handshake);
    await second.transport.waitForWallet();
    expect(second.transport.connected).toBe(true);
    // The connect request, sealed to the wallet's key, the same one the long link carried.
    const sealed = second.published.filter((e) => e.from === "dapp" && e.payload.type === "encrypted");
    expect(sealed).toHaveLength(1);
    const request = open(wallet.key, sealed[0].payload.data!);
    expect(request.msg.method).toBe("connect");
    expect(request.msg.origin).toBe(ORIGIN);
    expect((request.msg.params as unknown[])[2]).toEqual(WALLET_PROGRAMS);
    // Shield answers with the account it chose; the page's connect resolves with it.
    second.deliver({ type: "encrypted", data: seal(wallet.key, wallet.dappKey, Date.now(), { kind: "response", id: request.msg.id, result: { address: "aleo1testaccount" } }) });
    await expect(answer).resolves.toEqual({ address: "aleo1testaccount" });
    second.transport.disconnect();
  });

  it("after Shield has paired, a photo of the code can't take the pairing over", async () => {
    const { transport, published, deliver } = await relayTransport();
    const { url } = await transport.connect(GRANT);
    const shown = desktopPairingLink(url, false, ORIGIN)!;
    const rejected: unknown[] = [];
    transport.on("handshakeRejected", () => rejected.push(true));
    const shield = walletJoins(shown);
    deliver(shield.handshake);
    await transport.waitForWallet();
    // Someone with a photo of the code has everything Shield had: the secret, the channel, the page's key.
    const photo = walletJoins(shown);
    deliver(photo.handshake);
    expect(rejected).toHaveLength(1);
    // What the page sends next is sealed to Shield's key, which the photo doesn't have.
    const pending = transport.request("signMessage", [[1, 2, 3]]);
    await Promise.resolve();
    await Promise.resolve();
    const last = published.filter((e) => e.payload.type === "encrypted").at(-1)!;
    expect(() => open(photo.key, last.payload.data!)).toThrow();
    expect(open(shield.key, last.payload.data!).msg.method).toBe("signMessage");
    // And an answer forged by the photo's key is dropped: only Shield's signature counts.
    const forged = seal(photo.key, shield.dappKey, Date.now(), { kind: "response", id: open(shield.key, last.payload.data!).msg.id, result: [9, 9] });
    deliver({ type: "encrypted", data: forged });
    const outcome = expect(pending).rejects.toThrow(/disconnected/);
    transport.disconnect();
    await outcome;
  });

  it("before Shield pairs, whoever opens the code first holds the pairing: why the code is a secret", async () => {
    const { transport, deliver } = await relayTransport();
    const { url } = await transport.connect(GRANT);
    const shown = desktopPairingLink(url, false, ORIGIN)!;
    const rejected: unknown[] = [];
    transport.on("handshakeRejected", () => rejected.push(true));
    const photo = walletJoins(shown);
    deliver(photo.handshake);
    await transport.waitForWallet();
    const shield = walletJoins(shown);
    deliver(shield.handshake);
    expect(rejected).toHaveLength(1); // the person's own Shield is the one refused
    transport.disconnect();
  });

  it("a handshake without the secret is refused, so the relay alone can't pair", async () => {
    const { transport, deliver } = await relayTransport();
    const { url } = await transport.connect(GRANT);
    const shown = desktopPairingLink(url, false, ORIGIN)!;
    const wrong = new URL(shown);
    wrong.searchParams.set("secret", "0".repeat(64));
    const rejected: unknown[] = [];
    transport.on("handshakeRejected", () => rejected.push(true));
    deliver(walletJoins(wrong.toString()).handshake);
    expect(rejected).toHaveLength(1);
    expect(transport.connected).toBe(false);
    transport.disconnect();
  });
});

describe("an unfinished pairing left by an earlier page (forgetUnfinishedPairing)", () => {
  const storageOf = (memory: Map<string, string>) => ({ getItem: (k: string) => memory.get(k) ?? null, removeItem: (k: string) => void memory.delete(k) });

  it("is resumed by the adapter with the same secret, so the app forgets it before connecting again", async () => {
    const memory = new Map<string, string>();
    // A page shows a code and is closed or reloaded before Shield pairs.
    const first = await relayTransport(memory);
    const earlier = new URL(desktopPairingLink((await first.transport.connect(GRANT)).url, false, ORIGIN)!).searchParams;
    expect(memory.has(SHIELD_SESSION_KEY)).toBe(true);
    // Left alone, the next page's connect would wait for that same code again.
    const resumed = await relayTransport(new Map(memory));
    const again = await resumed.transport.connect(GRANT);
    expect(again.resumed).toBe(true);
    expect(new URL(again.url).searchParams.get("secret")).toBe(earlier.get("secret"));
    // Forgotten first, with the choice of Shield that would reconnect every panel by itself, the
    // next connect mints a new channel and secret: the earlier code pairs with nothing.
    memory.set(SELECTED_WALLET_KEY, JSON.stringify("Shield Wallet"));
    expect(forgetUnfinishedPairing(storageOf(memory))).toBe(true);
    expect(memory.has(SELECTED_WALLET_KEY)).toBe(false);
    const next = await relayTransport(memory);
    const fresh = await next.transport.connect(GRANT);
    expect(fresh.resumed).toBe(false);
    const now = new URL(desktopPairingLink(fresh.url, false, ORIGIN)!).searchParams;
    expect(now.get("secret")).not.toBe(earlier.get("secret"));
    expect(now.get("channelId")).not.toBe(earlier.get("channelId"));
    for (const t of [first, resumed, next]) t.transport.disconnect();
  });

  it("keeps a finished pairing, so a reload still finds Shield", async () => {
    const memory = new Map<string, string>();
    const { transport, deliver } = await relayTransport(memory);
    const shown = desktopPairingLink((await transport.connect(GRANT)).url, false, ORIGIN)!;
    deliver(walletJoins(shown).handshake);
    await transport.waitForWallet();
    const saved = memory.get(SHIELD_SESSION_KEY);
    expect(saved).toBeDefined();
    memory.set(SELECTED_WALLET_KEY, JSON.stringify("Shield Wallet"));
    expect(forgetUnfinishedPairing(storageOf(memory))).toBe(false);
    expect(memory.get(SHIELD_SESSION_KEY)).toBe(saved);
    expect(memory.has(SELECTED_WALLET_KEY)).toBe(true);
    transport.disconnect();
  });

  it("does nothing without storage or with nothing stored, and survives blocked or unreadable storage", () => {
    expect(forgetUnfinishedPairing(undefined)).toBe(false);
    expect(forgetUnfinishedPairing(storageOf(new Map()))).toBe(false);
    const blocked = {
      getItem: (): string | null => {
        throw new Error("blocked");
      },
      removeItem: () => undefined,
    };
    expect(forgetUnfinishedPairing(blocked)).toBe(false);
    const garbled = new Map([[SHIELD_SESSION_KEY, "{not json"]]);
    expect(forgetUnfinishedPairing(storageOf(garbled))).toBe(true);
    expect(garbled.size).toBe(0);
  });
});

describe("what the adapter does on a computer (pinned to the installed source)", () => {
  const remote = () => {
    const name = readFileSync(join(ADAPTER_DIST, "index.mjs"), "utf8").match(/import\("\.\/(remote-[A-Z0-9]+\.mjs)"\)/)![1];
    return readFileSync(join(ADAPTER_DIST, name), "utf8");
  };

  it("keeps its pairing under the key the app forgets an unfinished one by", () => {
    const name = readFileSync(join(ADAPTER_DIST, "index.mjs"), "utf8").match(/import\("\.\/(transport-[A-Z0-9]+\.mjs)"\)/)![1];
    expect(readFileSync(join(ADAPTER_DIST, name), "utf8")).toContain(`var STORAGE_KEY = "${SHIELD_SESSION_KEY}";`);
  });

  it("remembers the chosen wallet under the key the app forgets with an unfinished pairing", () => {
    const react = dirname(require.resolve("@provablehq/aleo-wallet-adapter-react"));
    expect(readFileSync(join(react, "index.mjs"), "utf8")).toContain(`localStorageKey = "${SELECTED_WALLET_KEY}",`);
  });

  it("waits five minutes for Shield to pair, the time the screen states", () => {
    expect(PAIRING_WAIT_MS).toBe(5 * 60 * 1e3);
    expect(remote()).toContain("var DEFAULT_PAIRING_TIMEOUT_MS = 5 * 60 * 1e3;");
  });

  it("hands the link to the page instead of opening it, and wakes Shield only on a phone", () => {
    const source = remote();
    expect(source).toContain("this.config.onConnectUrl?.(url, { resumed, sameDevice: isMobileUserAgent() });");
    expect(source).toContain("if (!isMobileUserAgent() || this.config.fireDeeplink === false || !this.channelId)");
  });
});
