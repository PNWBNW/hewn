// What the static bundle needs to be served from GitHub Pages
// (.github/workflows/pages.yml, docs/HOSTING.md step 4), decided from the
// brand alone, and refused when it would be unsafe.
//
// Every repository in the organisation shares the pnwbnw.github.io origin, and
// anything there counts as the same site (it could read stored data or register
// a service worker), so the app is served only on a custom domain of its own:
// an https address that isn't github.io. The CNAME file names it. GitHub reads
// the custom domain from the repository's Pages settings when Pages is
// published by a workflow; the file records it beside the files all the same.
//
// The page's own address serves plain files there, with no server behind it,
// so the traction counter has to live elsewhere: a counter on the app's own
// address is a warning (counting stops), not a failure.

export type PagesPlan = { cname: string; warnings: string[] };

const SHARED_HOSTS = /(^|\.)github\.io$|(^|\.)githubusercontent\.com$/;
const HOST = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]([a-z0-9-]*[a-z0-9])?$/;

export function pagesPlan({ appUrl, counterUrl }: { appUrl: string; counterUrl: string }): PagesPlan {
  const app = new URL(appUrl);
  if (app.protocol !== "https:") throw new Error(`the app's address must be https, not ${app.protocol}`);
  if (app.port || app.pathname !== "/" || app.search || app.hash || app.username || app.password) {
    throw new Error(`the app's address must be a bare origin, not ${appUrl}`);
  }
  if (!HOST.test(app.hostname)) throw new Error(`not a domain name: ${app.hostname}`);
  if (SHARED_HOSTS.test(app.hostname)) {
    throw new Error(`the app is never served from a shared origin (${app.hostname}): give it a custom domain`);
  }
  const warnings: string[] = [];
  if (new URL(counterUrl).origin === app.origin) {
    warnings.push(
      `the traction counter is still at the app's own address (${app.origin}), which serves plain files from Pages: point a domain at the counter and set BRAND.counterUrl, or visits go uncounted`,
    );
  }
  return { cname: app.hostname, warnings };
}
