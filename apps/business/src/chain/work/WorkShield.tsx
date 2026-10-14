"use client";

// Shield, for the person's side: the one adapter, connected through the
// same hook the business panels use, and checked against the account linked
// in Settings so a document is never read or signed from the wrong one.

import type { ReactNode } from "react";
import { Button } from "@pnw/ui/button";
import { AleoWalletProviderWrapper } from "@pnw/wallet/wallet-provider";
import { useOpenBooks } from "@/books/BooksProvider";
import { shortAddress } from "@/books/rail";
import { ShieldStatus } from "../ShieldStatus";
import { useShield } from "../shield";

export function WorkShieldProvider({ children }: { children: ReactNode }) {
  return (
    <AleoWalletProviderWrapper>
      <div className="flex flex-col gap-4 rounded-md border bg-muted/40 p-4">{children}</div>
    </AleoWalletProviderWrapper>
  );
}

/** The connected account when it is the linked one; otherwise what to show instead. */
export function useWorkShield() {
  const { rail } = useOpenBooks();
  const shield = useShield();
  const address = shield.state.kind === "connected" ? shield.state.address : null;
  const mismatch = address !== null && rail !== null && address !== rail.address;
  return { ...shield, address: address && !mismatch ? address : null, mismatch, linked: rail?.address ?? null };
}

/** Rendered until the linked account is connected; `children` only then. */
export function ShieldGate({ onClose, children }: { onClose: () => void; children: (address: string) => ReactNode }) {
  const { state, connect, error, address, mismatch, linked } = useWorkShield();
  if (address) return <>{children(address)}</>;
  if (mismatch && state.kind === "connected") {
    return (
      <>
        <p className="text-sm">
          Shield is signed in to a different account ({shortAddress(state.address)}) than the one linked in Settings ({shortAddress(linked ?? "")}). Switch
          accounts in Shield, then try again.
        </p>
        <Button variant="outline" className="min-h-11 self-start sm:min-h-9" onClick={onClose}>
          Close
        </Button>
      </>
    );
  }
  return (
    <>
      <ShieldStatus state={state} connect={connect} onClose={onClose} />
      {error && <p className="text-sm text-destructive">{error}</p>}
    </>
  );
}
