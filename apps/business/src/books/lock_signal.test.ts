// Closing the books in one tab closes them in every tab (lock_signal.ts). Each fresh import of the
// module is a tab of its own, with its own channel; Node's BroadcastChannel carries messages between
// them as a browser does between tabs of one origin.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

type Tab = typeof import("./lock_signal");

async function newTab(): Promise<Tab> {
  vi.resetModules();
  return import("./lock_signal");
}

/** Long enough for a channel message to arrive, in Node as in a browser. */
const settle = () => new Promise((r) => setTimeout(r, 50));

const read = (file: string) => readFileSync(join(__dirname, "..", file), "utf8");

const stops: (() => void)[] = [];
afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
});

describe("closing the books in one tab", () => {
  it("runs this tab's listeners at once", async () => {
    const tab = await newTab();
    const dropped = vi.fn();
    stops.push(tab.onBooksClosed(dropped));
    tab.announceBooksClosed();
    expect(dropped).toHaveBeenCalledTimes(1);
  });

  it("stops calling a listener once it is taken away", async () => {
    const tab = await newTab();
    const dropped = vi.fn();
    tab.onBooksClosed(dropped)();
    tab.announceBooksClosed();
    expect(dropped).not.toHaveBeenCalled();
  });

  it("tells every other tab, which locks without passing the word on, and never itself", async () => {
    const a = await newTab();
    const b = await newTab();
    const c = await newTab();
    const heardByA = vi.fn();
    const heardByC = vi.fn();
    const droppedInB = vi.fn();
    stops.push(a.listenForOtherTabs(heardByA));
    stops.push(c.listenForOtherTabs(heardByC));
    stops.push(b.onBooksClosed(droppedInB));
    // B does what BooksProvider does when another tab locks: lock({ fromOtherTab: true }).
    stops.push(b.listenForOtherTabs(() => b.announceBooksClosed({ fromOtherTab: true })));

    a.announceBooksClosed();
    await settle();

    expect(droppedInB).toHaveBeenCalledTimes(1);
    expect(heardByC).toHaveBeenCalledTimes(1); // A's word only: B said nothing more
    expect(heardByA).not.toHaveBeenCalled(); // no echo, from itself or from B
  });

  it("ignores any other message on the channel", async () => {
    const a = await newTab();
    const heard = vi.fn();
    stops.push(a.listenForOtherTabs(heard));
    const other = new BroadcastChannel(a.LOCK_CHANNEL);
    other.postMessage({ type: "open" });
    other.postMessage("lock");
    other.postMessage(null);
    await settle();
    other.close();
    expect(heard).not.toHaveBeenCalled();
  });

  it("still locks this tab where the browser has no channel", async () => {
    const real = globalThis.BroadcastChannel;
    vi.stubGlobal("BroadcastChannel", undefined);
    try {
      const tab = await newTab();
      const dropped = vi.fn();
      stops.push(tab.onBooksClosed(dropped));
      expect(() => tab.listenForOtherTabs(() => {})).not.toThrow();
      expect(() => tab.announceBooksClosed()).not.toThrow();
      expect(dropped).toHaveBeenCalledTimes(1);
    } finally {
      vi.stubGlobal("BroadcastChannel", real);
    }
  });
});

describe("the open books' provider", () => {
  const provider = read("books/BooksProvider.tsx");
  const lock = provider.slice(provider.indexOf("const lock = useCallback("), provider.indexOf("// Updates run one at a time"));

  it("tells this tab's listeners and the other tabs on every lock, unless another tab asked for it", () => {
    expect(lock).toContain("async ({ fromOtherTab = false }: { fromOtherTab?: boolean } = {}) => {");
    expect(lock).toContain("announceBooksClosed({ fromOtherTab });");
  });

  it("locks when another tab does, without passing the word on", () => {
    expect(provider).toContain("useEffect(() => listenForOtherTabs(() => void lock({ fromOtherTab: true })), [lock]);");
  });

  it("forgets which wallet was chosen, so the next login waits for a tap", () => {
    expect(provider).toMatch(/const SHIELD_WALLET_NAME = "walletName";/);
    expect(provider).toContain("localStorage.removeItem(SHIELD_WALLET_NAME);");
    expect(lock).toContain("forgetChosenWallet();");
    // The adapter's default key, which the wallet package doesn't change.
    const wrapper = read("../../../packages/wallet/src/wallet-provider.tsx");
    expect(wrapper).toContain("<AleoWalletProvider");
    expect(wrapper).not.toContain("localStorageKey");
    const adapter = read("../../../packages/wallet/node_modules/@provablehq/aleo-wallet-adapter-react/dist/index.mjs");
    expect(adapter).toContain('localStorageKey = "walletName"');
  });

  it("is never handed a click's event in place of its options", () => {
    expect(read("app/settings/page.tsx")).not.toMatch(/onClick=\{lock\}/);
    expect(read("shell/AppShell.tsx")).not.toMatch(/onLock=\{lock\}/);
  });
});

describe("the names a page confirmed in this tab", () => {
  it("are dropped when the books close", () => {
    expect(read("chain/confirmed_names.tsx")).toContain("onBooksClosed(() => {");
  });
});
