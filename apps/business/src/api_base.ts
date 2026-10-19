// Where the server pieces live: the mailbox courier, the visit counter and the
// traction feed. The website serves them itself, so a relative address works
// there. The static bundle (`HEWN_STATIC=1`, next.config.ts) is the same
// screens packed into the installable app, with no server of its own, so it
// reaches them on the website by full address.
import { BRAND } from "./brand";

export const API_BASE: string = process.env.NEXT_PUBLIC_HEWN_STATIC === "1" ? BRAND.appUrl : "";

/** `/api/...` on whichever host serves the server pieces for this build. */
export const apiUrl = (path: `/api/${string}`): string => `${API_BASE}${path}`;
