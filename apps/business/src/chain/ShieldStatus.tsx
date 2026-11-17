"use client";

import type { ReactNode } from "react";
import { Button } from "@pnw/ui/button";
import { SHIELD_APP_URL } from "@pnw/wallet/wallet-provider";
import { BRAND } from "@/brand";
import { useDesktopApp } from "@/desktop";
import type { ShieldRoute, ShieldState } from "./shield";

const link = "font-medium text-primary underline-offset-4 hover:underline";

/**
 * The not-found / connecting / connect-button states every chain panel starts with.
 * `route` words the phone case (there the Shield app opens by itself) and the computer without the
 * extension (the code for the phone is shown above the panel, by ShieldPairing).
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
        <ShieldMissing className="text-sm" website>
          Shield wasn&apos;t found. On a computer, install the{" "}
          <a href={SHIELD_APP_URL} target="_blank" rel="noreferrer" className={link}>
            Shield browser extension
          </a>
          ; on a phone, install the Shield app. Then try again.
        </ShieldMissing>
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
          {route === "relay"
            ? "Shield should open now. Approve the request there, then come back here."
            : route === "pair"
              ? "Waiting for Shield on your phone: open the code above with your phone's camera, then approve in Shield."
              : "Connecting… approve the request in Shield."}
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
      {route === "pair" ? <span className="text-xs text-muted-foreground">Shows a code for the Shield app on your phone.</span> : null}
    </div>
  );
}

/**
 * Shown when the page is paired over the relay but the Shield app is in the
 * background: it answers reads only while open. The link brings it to the front; `href` is
 * `useShield().wakeUrl()`, which names this site's pairing so Shield doesn't call it expired.
 * On a computer paired with a phone `href` is empty: no link can open Shield there.
 */
export function ShieldAway({ what, href }: { what: string; href: string }) {
  if (href === "") {
    return <p className="text-xs text-muted-foreground">Shield is closed on your phone, so it can&apos;t answer yet. Open Shield on your phone for {what}.</p>;
  }
  return (
    <p className="text-xs text-muted-foreground">
      Shield is in the background, so it can&apos;t answer yet.{" "}
      <a href={href} className={link}>
        Open Shield
      </a>
      , then come back here for {what}.
    </p>
  );
}

/**
 * The desktop app can't reach Shield yet: no extension runs inside it, and Shield's phone app
 * can't scan a pairing code (apps/desktop/README.md). Every screen that needs Shield says this
 * there, instead of a connect button that would wait for nothing.
 */
export const SHIELD_NOT_IN_DESKTOP =
  "This desktop app can't reach Shield yet, so anything that needs Shield isn't available here for now. Use the website in a browser with the Shield extension, or in the Shield app on a phone.";

/**
 * What a screen says when Shield isn't found: its own words (`children`) in a browser, and
 * SHIELD_NOT_IN_DESKTOP inside the desktop app, with a link to the website where `website` asks
 * for one (the desktop app opens it in the person's browser).
 */
export function ShieldMissing({ className, website = false, children }: { className: string; website?: boolean; children: ReactNode }) {
  const desktop = useDesktopApp();
  if (!desktop) return <p className={className}>{children}</p>;
  return (
    <p className={className}>
      {SHIELD_NOT_IN_DESKTOP}
      {website ? (
        <>
          {" "}
          <a href={BRAND.appUrl} target="_blank" rel="noreferrer" className={link}>
            Open the website
          </a>
          .
        </>
      ) : null}
    </p>
  );
}
