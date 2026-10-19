"use client";

import { Button } from "@pnw/ui/button";
import { SHIELD_APP_URL, SHIELD_OPEN_URL } from "@pnw/wallet/wallet-provider";
import type { ShieldRoute, ShieldState } from "./shield";

const link = "font-medium text-primary underline-offset-4 hover:underline";

/**
 * The not-found / connecting / connect-button states every chain panel starts with.
 * `route` words the phone case: there the Shield app opens by itself.
 */
export function ShieldStatus({
  state,
  route = "injected",
  connect,
  onClose,
}: {
  state: ShieldState;
  route?: ShieldRoute;
  connect: () => void;
  onClose: () => void;
}) {
  if (state.kind === "missing") {
    return (
      <>
        <p className="text-sm">
          Shield wasn&apos;t found. On a computer, install the{" "}
          <a href={SHIELD_APP_URL} target="_blank" rel="noreferrer" className={link}>
            Shield browser extension
          </a>
          ; on a phone, install the Shield app. Then try again.
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
        <p className="text-sm">
          {route === "relay" ? "Shield should open now. Approve the request there, then come back here." : "Connecting… approve the request in Shield."}
        </p>
        {route === "relay" ? (
          <p className="text-xs text-muted-foreground">
            Shield didn&apos;t open?{" "}
            <a href={SHIELD_APP_URL} target="_blank" rel="noreferrer" className={link}>
              Get the Shield app
            </a>
            , then try again.
          </p>
        ) : null}
        <Button variant="outline" className="min-h-11 self-start sm:min-h-9" onClick={onClose}>
          Cancel
        </Button>
      </>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button className="min-h-11 sm:min-h-9" onClick={connect}>
        Connect Shield
      </Button>
      <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={onClose}>
        Cancel
      </Button>
      {route === "relay" ? <span className="text-xs text-muted-foreground">Opens the Shield app.</span> : null}
    </div>
  );
}

/**
 * Shown when the page is paired over the relay but the Shield app is in the
 * background: it answers reads only while open. The link brings it to the front.
 */
export function ShieldAway({ what }: { what: string }) {
  return (
    <p className="text-xs text-muted-foreground">
      Shield is in the background, so it can&apos;t answer yet.{" "}
      <a href={SHIELD_OPEN_URL} className={link}>
        Open Shield
      </a>
      , then come back here for {what}.
    </p>
  );
}
