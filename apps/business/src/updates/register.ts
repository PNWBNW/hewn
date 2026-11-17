// Registering the update worker (worker.js) and noticing when the browser installs another one.
//
// Only the static bundle served on the web registers it: never the website build (Vercel serves no
// worker) and never inside the desktop app, whose own updater checks every update
// (`mayRegisterServiceWorker` in src/desktop.ts).
//
// The browser fetches the worker from the host and replaces it by itself; the running worker can't
// check or stop that. What the page can do is notice it and tell the person (UpdateNotice.tsx).

import { mayRegisterServiceWorker } from "../desktop";

/** The worker's address: the bundle's root, so it covers every page. */
export const WORKER_URL = "/sw.js";

type Where = Pick<Location, "protocol" | "hostname" | "port">;

/** Whether this page registers the update worker: the static bundle, on the web, where the browser has workers. */
export function shouldRegister(
  staticBuild: string | undefined = process.env.NEXT_PUBLIC_HEWN_STATIC,
  where: Where | undefined = typeof location === "undefined" ? undefined : location,
  nav: object | undefined = typeof navigator === "undefined" ? undefined : navigator,
): boolean {
  return staticBuild === "1" && mayRegisterServiceWorker(where, nav);
}

/** The parts of the browser's worker container and registration this uses (so tests can stand in). */
export type Registration = Pick<ServiceWorkerRegistration, "installing" | "waiting" | "active" | "addEventListener">;
export type Container = { readonly controller: unknown; register(url: string, options: RegistrationOptions): Promise<Registration> };

/**
 * Registers the worker and calls `onArriving` when the browser installs a worker other than the
 * first one: an update to the worker itself, which this app can't check. Also calls it at once when
 * one is already installing or waiting, so a reload keeps saying so until it has taken over.
 */
export async function registerUpdateWorker(container: Container, onArriving: () => void): Promise<Registration> {
  const reg = await container.register(WORKER_URL, { scope: "/", updateViaCache: "none" });
  // The first worker on this device installs with nothing before it: that's no update.
  const hadOne = () => Boolean(container.controller || reg.active);
  if ((reg.installing || reg.waiting) && hadOne()) onArriving();
  reg.addEventListener("updatefound", () => {
    if (hadOne()) onArriving();
  });
  return reg;
}
