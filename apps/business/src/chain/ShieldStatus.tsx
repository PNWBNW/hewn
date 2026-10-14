"use client";

import { Button } from "@pnw/ui/button";
import type { ShieldState } from "./shield";

/** The not-found / connecting / connect-button states every chain panel starts with. */
export function ShieldStatus({ state, connect, onClose }: { state: ShieldState; connect: () => void; onClose: () => void }) {
  if (state.kind === "missing") {
    return (
      <>
        <p className="text-sm">
          Shield wasn&apos;t found. Install the Shield browser extension, or open this page inside the Shield app on your phone, then
          try again.
        </p>
        <Button variant="outline" className="min-h-11 self-start sm:min-h-9" onClick={onClose}>
          Cancel
        </Button>
      </>
    );
  }
  if (state.kind === "connecting") {
    return (
      <>
        <p className="text-sm">Connecting… approve the request in Shield.</p>
        <Button variant="outline" className="min-h-11 self-start sm:min-h-9" onClick={onClose}>
          Cancel
        </Button>
      </>
    );
  }
  return (
    <div className="flex flex-wrap gap-3">
      <Button className="min-h-11 sm:min-h-9" onClick={connect}>
        Connect Shield
      </Button>
      <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={onClose}>
        Cancel
      </Button>
    </div>
  );
}
