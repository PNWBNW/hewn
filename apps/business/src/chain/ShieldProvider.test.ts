import { describe, expect, it } from "vitest";
import { SELECTED_WALLET_KEY, SHIELD_SESSION_KEY } from "@pnw/wallet/desktop-pairing";
import { earlierPairingForgetter } from "./ShieldProvider";

const unfinished = JSON.stringify({ channelId: "c", privateKeyHex: "k", secret: "s", sendSeq: 0, recvSeq: 0 });
const finished = JSON.stringify({ channelId: "c", privateKeyHex: "k", secret: "s", walletPublicKey: "02ab", sendSeq: 0, recvSeq: 0 });

function store(value: string) {
  const memory = new Map([
    [SHIELD_SESSION_KEY, value],
    [SELECTED_WALLET_KEY, JSON.stringify("Shield Wallet")],
  ]);
  return { memory, storage: () => ({ getItem: (k: string) => memory.get(k) ?? null, removeItem: (k: string) => void memory.delete(k) }) };
}

describe("an unfinished pairing from an earlier visit", () => {
  it("is forgotten on a computer when the first panel mounts, so an old code pairs with nothing", () => {
    const { memory, storage } = store(unfinished);
    earlierPairingForgetter()(false, storage);
    expect(memory.has(SHIELD_SESSION_KEY)).toBe(false);
    expect(memory.has(SELECTED_WALLET_KEY)).toBe(false); // no panel starts a new pairing by itself
  });

  it("is forgotten once per visit: panels opened later share the pairing this visit started", () => {
    const forget = earlierPairingForgetter();
    forget(false, store(unfinished).storage);
    const later = store(unfinished);
    forget(false, later.storage);
    expect(later.memory.has(SHIELD_SESSION_KEY)).toBe(true);
  });

  it("is kept on a phone, which comes back from Shield by reloading mid-pairing", () => {
    const { memory, storage } = store(unfinished);
    earlierPairingForgetter()(true, storage);
    expect(memory.has(SHIELD_SESSION_KEY)).toBe(true);
    expect(memory.has(SELECTED_WALLET_KEY)).toBe(true);
  });

  it("keeps a finished pairing on a computer, so a reload still finds Shield", () => {
    const { memory, storage } = store(finished);
    earlierPairingForgetter()(false, storage);
    expect(memory.get(SHIELD_SESSION_KEY)).toBe(finished);
    expect(memory.has(SELECTED_WALLET_KEY)).toBe(true);
  });
});
