// Whether this page is running inside the installable desktop app (apps/desktop), which carries
// the static bundle and serves it from its own origin on the device:
//
// - `tauri://localhost` on macOS and Linux,
// - `https://tauri.localhost` on Windows (the app asks for the https form, `useHttpsScheme`;
//   `http://tauri.localhost` is the default it would otherwise get, accepted here too).
//
// Neutral code that imports nothing of the network's, so the books and the shell may ask it too.
//
// What it decides:
// - No service worker inside the desktop app (`mayRegisterServiceWorker`). The app's own updater
//   checks every update against the operator's update key; a worker there would only add a second,
//   weaker copy of the files, kept by the web engine.
// - Shield is reached from the desktop app only by pairing with the phone (the `pair` route,
//   apps/desktop/README.md), with the website's origin declared for Shield to show.

import { useSyncExternalStore } from "react";

/** The origins the desktop app serves the bundle from, one per platform (see above). */
export const DESKTOP_ORIGINS = ["tauri://localhost", "https://tauri.localhost", "http://tauri.localhost"] as const;

type Where = Pick<Location, "protocol" | "hostname" | "port">;

/**
 * True inside the desktop app. Reads the page's address rather than anything the app injects, so
 * it holds with no bridge to the app at all. Compares the parts, not `location.origin`: engines
 * disagree on how they write the origin of a custom scheme such as `tauri:`. A plain browser can
 * only meet `tauri.localhost` on a server someone runs on their own machine without a port.
 */
export function isDesktopApp(where: Where | undefined = typeof location === "undefined" ? undefined : location): boolean {
  if (!where) return false;
  if (where.protocol === "tauri:") return where.hostname === "localhost";
  return (where.protocol === "https:" || where.protocol === "http:") && where.hostname === "tauri.localhost" && where.port === "";
}

/**
 * Whether the page may register a service worker: never inside the desktop app, and only where
 * the browser has them. Whatever registers one asks this first.
 */
export function mayRegisterServiceWorker(
  where: Where | undefined = typeof location === "undefined" ? undefined : location,
  nav: object | undefined = typeof navigator === "undefined" ? undefined : navigator,
): boolean {
  return !isDesktopApp(where) && nav !== undefined && "serviceWorker" in nav;
}

const never = () => () => undefined;

/**
 * `isDesktopApp()` for a component. The static export renders every page ahead of time, where
 * there is no address, so the first render says false (as the prerendered page did) and the next
 * says what the address says, without a mismatch while the page hydrates.
 */
export function useDesktopApp(): boolean {
  return useSyncExternalStore(never, () => isDesktopApp(), () => false);
}
