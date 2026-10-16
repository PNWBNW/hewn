"use client";

// ---------------------------------------------------------------------------
// Reaching coworkers by letter: each coworker's account comes from the list
// the business passed on (books/directory.ts), and every message to them is a
// letter (chain/letters.ts) through Shield. Use inside an
// AleoWalletProviderWrapper. Nothing here logs a key or an account.
// ---------------------------------------------------------------------------

import { Button } from "@pnw/ui/button";
import { useWork } from "@/books/BooksProvider";
import { type DirectoryEntry, coworkersFrom } from "@/books/directory";
import { workThread } from "@/books/work";
import { useLetters } from "../letter_reader";
import { LetterBox } from "../letters";

export class UnreachableError extends Error {
  constructor(name: string) {
    super(`${name} can't get letters yet: the business needs to send the coworker list again`);
    this.name = "UnreachableError";
  }
}

export function useCoworkerLetters(businessKey: string) {
  const { work } = useWork();
  const shield = useLetters();
  const { letters, wallet } = shield;
  const directory = coworkersFrom(workThread(work, businessKey));
  const addresses = new Map(directory.flatMap((c) => (c.address ? [[c.publicKey, c.address] as const] : [])));

  /** A letter box to one coworker; throws when they haven't an account on the list. */
  const clientFor = (m: DirectoryEntry) => {
    const to = m.address ?? addresses.get(m.publicKey);
    if (!to) throw new UnreachableError(m.name);
    return new LetterBox({ wallet, to });
  };

  return { ...shield, ready: letters !== null, clientFor, addressOf: (publicKey: string) => addresses.get(publicKey) };
}

/** What to show instead of a send button while Shield isn't connected to this account. */
export function LettersGate({ shield }: { shield: ReturnType<typeof useCoworkerLetters> }) {
  if (shield.ready) return null;
  if (shield.mismatch) return <p className="text-xs text-muted-foreground">Shield is on a different account; switch accounts in Shield to send.</p>;
  if (shield.state.kind === "missing") return <p className="text-xs text-muted-foreground">Messages go as letters through Shield. Open this in the Shield app to send.</p>;
  if (shield.state.kind === "connecting") return <p className="text-xs text-muted-foreground">Connecting… approve the request in Shield.</p>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="text-xs text-muted-foreground">Messages go as letters on the network.</p>
      <Button variant="outline" size="sm" className="min-h-11 sm:min-h-8" onClick={shield.connect}>
        Connect Shield
      </Button>
    </div>
  );
}
