"use client";

// What a connections screen says while Shield isn't connected to this account.

import { Button } from "@pnw/ui/button";
import { shortAddress } from "@/books/rail";

export function ShieldNeeded({
  state,
  connect,
  address,
  mismatch,
  linked,
  what,
}: {
  state: { kind: string };
  connect: () => void;
  address: string | null;
  mismatch: boolean;
  linked: string;
  what: string;
}) {
  if (mismatch && address) {
    return (
      <p className="text-sm text-muted-foreground">
        Shield is signed in to {shortAddress(address)}. Switch to {shortAddress(linked)} in Shield to {what}.
      </p>
    );
  }
  if (state.kind === "missing") return <p className="text-sm text-muted-foreground">Open this page in the Shield app, or with the Shield extension, to {what}.</p>;
  return (
    <Button variant="outline" className="min-h-11 self-start sm:min-h-9" disabled={state.kind === "connecting"} onClick={connect}>
      {state.kind === "connecting" ? "Connecting…" : `Connect Shield to ${what}`}
    </Button>
  );
}
