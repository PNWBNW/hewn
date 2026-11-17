// The traction counter on an address of its own (docs/HOSTING.md, step 4).
//
// Once the app is served as plain files (GitHub Pages, on the app's address),
// the website build keeps running on Vercel for one job: the counter
// (`/api/count`, `/api/traction`; INV-05), at `BRAND.counterUrl`. There every
// page and public file answers 404, so the counter's address never becomes a
// second place the app's pages run. The request proxy (src/proxy.ts, its
// matcher) never sees the framework's own script files, so those are still
// served there: code, not a page, and the same files the app serves. While the
// counter shares the app's address (the default), nothing changes.
import { BRAND } from "@/brand";

/** The only paths the counter's own address answers. */
export const COUNTER_PATHS: ReadonlySet<string> = new Set(["/api/count", "/api/traction"]);

/**
 * Whether a request to the website build should be turned away: it came in on the counter's own
 * address (when that differs from the app's) and asks for something other than the counter.
 */
export function offCounterPath(
  host: string | null,
  pathname: string,
  urls: { appUrl: string; counterUrl: string } = BRAND,
): boolean {
  const counter = new URL(urls.counterUrl).host;
  if (counter === new URL(urls.appUrl).host || host?.toLowerCase() !== counter) return false;
  return !COUNTER_PATHS.has(pathname.replace(/\/+$/, ""));
}
