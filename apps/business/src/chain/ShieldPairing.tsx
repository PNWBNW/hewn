"use client";

// A computer without the Shield extension reaches Shield on the person's phone (the `pair` route,
// ./shield_route.ts): this shows the pairing link as a QR code for the phone's camera to open in
// Shield, and, once paired, says "open Shield on your phone" whenever an approval is waiting.
// Mounted once per wallet provider by ./ShieldProvider.tsx, so every chain panel gets it.
//
// The pairing link is a secret while it waits (docs/THREAT_MODEL.md T3): whoever opens it first
// pairs with this page. It is drawn only here, only after a tap, as an SVG built on this device
// (@pnw/wallet/qr; no image service, nothing fetched), and never logged, stored or sent. It stops
// working once Shield pairs, after five minutes, or on Cancel.

import { useState, useSyncExternalStore } from "react";
import { Button } from "@pnw/ui/button";
import { PAIRING_WAIT_MS } from "@pnw/wallet/desktop-pairing";
import { encodeQr, qrSvgPath } from "@pnw/wallet/qr";
import { SHIELD_APP_URL } from "@pnw/wallet/wallet-provider";
import { BRAND } from "@/brand";
import { approvalsWaiting, subscribeApprovals } from "./phone_approval";
import { useShield } from "./shield";

const link = "font-medium text-primary underline-offset-4 hover:underline";
const MINUTES = Math.round(PAIRING_WAIT_MS / 60_000);

/** The code itself: dark modules on a white square, whatever the page's theme, as cameras expect. */
export function PairingCode({ value }: { value: string }) {
  const { d, viewBox } = qrSvgPath(encodeQr(value, "M"));
  return (
    <svg
      viewBox={`0 0 ${viewBox} ${viewBox}`}
      role="img"
      aria-label={`Code for the Shield app on your phone to connect to ${BRAND.name}`}
      className="h-56 w-56 max-w-full self-center rounded-sm"
      shapeRendering="crispEdges"
    >
      <rect width={viewBox} height={viewBox} fill="#ffffff" />
      <path d={d} fill="#000000" />
    </svg>
  );
}

/** The steps, in the person's words. */
export const PAIRING_STEPS = [
  "On your phone, open the camera and point it at the code.",
  "Tap the Shield link the camera shows. Shield opens and asks to connect.",
  `Check that Shield names ${BRAND.name} and this site's address, then approve. This page connects by itself.`,
];

export function ShieldPairing() {
  const { route, state, pairing, cancel } = useShield();
  const [shown, setShown] = useState(false);
  const waiting = useSyncExternalStore(subscribeApprovals, approvalsWaiting, () => 0);
  if (route !== "pair") return null;
  return (
    <ShieldPairingView
      connected={state.kind === "connected"}
      pairing={pairing}
      waiting={waiting}
      shown={shown}
      onShow={() => setShown(true)}
      onCancel={() => {
        setShown(false);
        void cancel();
      }}
    />
  );
}

/** What the pairing screen shows, from its state; ShieldPairing above feeds it. */
export function ShieldPairingView({
  connected,
  pairing,
  waiting,
  shown,
  onShow,
  onCancel,
}: {
  connected: boolean;
  pairing: string | null;
  waiting: number;
  shown: boolean;
  onShow: () => void;
  onCancel: () => void;
}) {
  if (connected) {
    if (waiting === 0) return null;
    return (
      <p role="status" className="rounded-md border border-dashed p-3 text-sm">
        Open Shield on your phone to approve. From a computer, Shield can&apos;t open by itself: the request waits in Shield until you open
        it, for up to {MINUTES} minutes.
      </p>
    );
  }

  if (!pairing) return null;

  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <p className="text-sm font-medium">Connect Shield on your phone</p>
      {shown ? (
        <>
          <PairingCode value={pairing} />
          <ol className="list-decimal pl-5 text-sm">
            {PAIRING_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="text-xs text-muted-foreground">
            This code works once, for {MINUTES} minutes, and connects whoever opens it first. Don&apos;t share it or let anyone photograph
            it. Afterwards, open Shield on your phone whenever this page asks for an approval.
          </p>
        </>
      ) : (
        <>
          <p className="text-sm">
            Without the Shield extension on this computer, connect the Shield app on your phone instead. This page shows a code for your
            phone&apos;s camera.
          </p>
          <Button className="min-h-11 self-start sm:min-h-9" onClick={onShow}>
            Show the code
          </Button>
        </>
      )}
      <p className="text-xs text-muted-foreground">
        If your phone&apos;s camera doesn&apos;t offer to open Shield, this way in doesn&apos;t work on that phone yet. Install the{" "}
        <a href={SHIELD_APP_URL} target="_blank" rel="noreferrer" className={link}>
          Shield browser extension
        </a>{" "}
        on this computer instead.
      </p>
      <Button variant="outline" className="min-h-11 self-start sm:min-h-9" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}
