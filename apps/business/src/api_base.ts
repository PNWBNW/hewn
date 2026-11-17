// Where the one server piece lives: the traction counter (`/api/count`, the
// visit counter, and `/api/traction`, the published numbers; INV-05). The
// website serves it itself, so a relative address works there. The static
// bundle (`HEWN_STATIC=1`, next.config.ts) is the same screens as plain files,
// served from GitHub Pages or carried by the desktop app, with no server of
// its own, so it reaches the counter by full address (`BRAND.counterUrl`),
// the one extra origin its security policy names (scripts/static_csp.mjs).
// The counter answers cross-site requests only from the app's own origins
// (app/api/traction/counts.ts).
import { BRAND } from "./brand";

export const API_BASE: string = process.env.NEXT_PUBLIC_HEWN_STATIC === "1" ? BRAND.counterUrl : "";

/** `/api/...` on whichever host serves the counter for this build. */
export const apiUrl = (path: `/api/${string}`): string => `${API_BASE}${path}`;
