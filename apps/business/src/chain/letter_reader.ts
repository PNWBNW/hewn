"use client";

// ---------------------------------------------------------------------------
// Shield, for screens that read (and send) letters: the account's letter box
// once Shield is connected to the linked account. Use inside an
// AleoWalletProviderWrapper. A screen that checks in the background waits
// for `settled` (Shield reconnects on its own when it can, or the wait runs
// out) and reads the old mailbox alone when there's no letter box.
// Nothing here logs an address, a lookup or a letter.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import { useOpenBooks } from "@/books/BooksProvider";
import { LetterBox, type LetterWallet } from "./letters";
import { useShield } from "./shield";

export function useLetters(waitMs = 4_000) {
  const { rail } = useOpenBooks();
  const shield = useShield();
  // The wallet object is new each render; the letter box calls through to the latest one.
  const latest = useRef(shield.wallet);
  latest.current = shield.wallet;
  const address = shield.state.kind === "connected" ? shield.state.address : null;
  const mismatch = address !== null && rail !== null && address !== rail.address;
  const ready = address !== null && !mismatch;
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setWaited(true), waitMs);
    return () => clearTimeout(t);
  }, [waitMs]);
  const wallet = useMemo<LetterWallet>(
    () => ({
      executeTransaction: (o) => latest.current.executeTransaction(o),
      transactionStatus: (id) => latest.current.transactionStatus(id),
      requestRecords: (program, plaintext) => latest.current.requestRecords(program, plaintext),
    }),
    [],
  );
  const letters = useMemo(() => (ready ? new LetterBox({ wallet }) : null), [ready, wallet]);
  return {
    ...shield,
    address,
    mismatch,
    /** The account's letters (shared by every thread on the screen), or null while Shield isn't connected to it. */
    letters,
    /** Calls through to Shield; for sending letters. Use only while `letters` is set. */
    wallet,
    /** Shield is connected, or it had its moment to reconnect. */
    settled: ready || waited,
  };
}
