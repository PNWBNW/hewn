"use client";

// Registers the update worker (register.ts) in the static bundle on the web, and says so plainly
// when the browser starts installing another one: an update this app can't check, because the
// browser takes the worker from the host without asking the worker it replaces. Renders nothing
// on the website, in the desktop app, and until that happens.

import { useEffect, useState } from "react";
import { Button } from "@pnw/ui/button";
import { BRAND } from "@/brand";
import { registerUpdateWorker, shouldRegister } from "./register";

/** How anyone checks a release against its published signature and anchor. */
export const RELEASE_CHECK_URL = `${BRAND.sourceUrl}/blob/main/scripts/release/README.md`;

export function UpdateNotice() {
  const [arriving, setArriving] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!shouldRegister()) return;
    let live = true;
    registerUpdateWorker(navigator.serviceWorker, () => {
      if (live) setArriving(true);
    }).catch(() => {
      // No worker (a private window, storage off): the app runs from the host's files as before.
    });
    return () => {
      live = false;
    };
  }, []);

  if (!arriving || dismissed) return null;
  return (
    <aside
      role="status"
      aria-live="polite"
      data-update-notice=""
      className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-xl rounded-lg border border-border bg-card p-4 text-sm text-card-foreground shadow-lg"
    >
      <p className="font-medium">An update arrived that this app can&apos;t check</p>
      <p className="mt-1 text-muted-foreground">
        Your browser is installing a new version of the part of this app that checks its updates. It comes straight
        from the server, so the app can&apos;t check it against the release signature. Most likely it&apos;s a normal
        release.
      </p>
      <p className="mt-1 text-muted-foreground">
        If you&apos;d rather be sure before you unlock your books, wait and open the app again later, or check the
        release first.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <a className="text-primary underline underline-offset-4" href={RELEASE_CHECK_URL} target="_blank" rel="noreferrer">
          How to check a release
        </a>
        <Button size="sm" variant="outline" onClick={() => setDismissed(true)}>
          Got it
        </Button>
      </div>
    </aside>
  );
}
