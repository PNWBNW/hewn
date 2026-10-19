"use client";

// Page views, counted in aggregate by Vercel Web Analytics (Joshua, 2026-10-19).
// No cookies, nothing that identifies a person; the script and its endpoint
// are on this site's own address, so the security policy needs no new host.
// Only the path is sent: the query string and hash are stripped first, so
// nothing a link carries (an id, a filter) ever leaves the page.

import { Analytics } from "@vercel/analytics/next";

export function PageViews() {
  // The static bundle (next.config.ts) is not served by Vercel, so its page-view script would 404 there.
  if (process.env.NEXT_PUBLIC_HEWN_STATIC === "1") return null;
  return (
    <Analytics
      beforeSend={(event) => {
        try {
          const url = new URL(event.url);
          return { ...event, url: `${url.origin}${url.pathname}` };
        } catch {
          return null;
        }
      }}
    />
  );
}
