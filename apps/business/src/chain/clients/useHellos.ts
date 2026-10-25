"use client";

// ---------------------------------------------------------------------------
// Saying hello and reading hellos (chain/clients.ts), for the screens on both
// sides: the business's customers, the customer's businesses. Use inside an
// AleoWalletProviderWrapper. Nothing here logs an account or a letter.
// ---------------------------------------------------------------------------

import { useCallback } from "react";
import { readFeeMode } from "@pnw/wallet/fee-mode";
import type { Hello, HelloSide } from "@/books/connections";
import type { Half } from "@/books/key_ring";
import { checkHello, nextHelloPlace, packHello, readHellos } from "../clients";
import { useLetters } from "../letter_reader";
import { LetterBox } from "../letters";

/** A hello whose sender the registry vouches for, with the registry's name for them. */
export type CheckedHello = { address: string; name: string; nameHash: string; publicKey: string };

export function useHellos(side: HelloSide, me: { name: string; nameHash: string } | null) {
  const shield = useLetters();
  const { letters, wallet, address } = shield;

  /** Every hello to this account that checks out; the rest are left out. */
  const check = useCallback(async (): Promise<CheckedHello[]> => {
    if (!letters || !address) throw new Error("Connect Shield first");
    letters.refresh();
    const found = await readHellos((lookup) => letters.getAll(lookup), address);
    const out: CheckedHello[] = [];
    for (const h of found) {
      if (h.hello.side === side) continue; // a business only hears from customers, and the other way round
      const who = await checkHello(h);
      if (who) out.push({ address: h.sender, ...who, publicKey: h.hello.publicKey });
    }
    return out;
  }, [letters, address, side]);

  /** Sends my hello to `to`: one Shield approval. */
  const sayHello = useCallback(
    async (to: string, mine: Half): Promise<void> => {
      if (!letters || !address) throw new Error("Connect Shield first");
      if (!me) throw new Error("Register your name first");
      const box = new LetterBox({ wallet, to });
      letters.refresh();
      const place = await nextHelloPlace(async (lookup) => (await letters.getSent(lookup)) !== null, to);
      if (!place) throw new Error("Too many hellos to that account");
      const hello: Hello = { v: 1, type: "hello", side, name: me.name, nameHash: me.nameHash, publicKey: mine.publicKey };
      await box.put(place, packHello(hello), { feeMode: readFeeMode() });
    },
    [letters, address, wallet, me, side],
  );

  return { ...shield, check, sayHello };
}
