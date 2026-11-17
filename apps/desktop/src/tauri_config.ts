// The desktop app's Tauri configuration, made from @pnw/brand so the product's name, its
// identifier, its update key and where its updates come from live in one place.
// `scripts/tauri_config.mjs --write` writes it to src-tauri/tauri.conf.json; a test fails when the
// committed file differs from what this makes.
//
// Every choice here is a security choice; the README says why each one is so.

import { BRAND, CREDIT } from "@pnw/brand";

/** What the configuration reads from the brand; a fork's brand gives a fork's app. */
type Brand = {
  name: string;
  tagline: string;
  siteUrl: string;
  sourceUrl: string;
  operator: string;
  desktop: { id: string; updateKey: string };
};
type Credit = { copyright: string };

/** Where the app looks for updates: the source repository's latest release, which lists them. */
export function updateEndpoint(sourceUrl: string): string {
  return `${sourceUrl.replace(/\/$/, "")}/releases/latest/download/latest.json`;
}

/** The static bundle, relative to src-tauri/ (where tauri.conf.json lives). */
export const FRONTEND_DIST = "../../business/out";

export function tauriConfig(brand: Brand = BRAND, credit: Credit = CREDIT) {
  return {
    $schema: "https://schema.tauri.app/config/2",
    productName: brand.name,
    // The app's version is apps/desktop/package.json's.
    version: "../package.json",
    // Fixed once released: each system keeps the app's storage, the books included, under it.
    identifier: brand.desktop.id,
    build: {
      // The static bundle, built first by `pnpm --filter @pnw/business build:static`. No dev
      // server: `cargo tauri dev` runs the same files.
      frontendDist: FRONTEND_DIST,
    },
    app: {
      // No `window.__TAURI__` in the pages: they have nothing to call.
      withGlobalTauri: false,
      windows: [
        {
          label: "main",
          // Made in src/lib.rs, with the navigation rule attached before anything loads.
          create: false,
          title: brand.name,
          width: 1280,
          height: 860,
          minWidth: 360,
          minHeight: 560,
          // Windows serves the app from https://tauri.localhost rather than http://: the same
          // secure origin as the other systems, and the policy's upgrade-insecure-requests can't
          // turn the app's own requests into ones that fail. Fixed from the first release: the
          // origin decides where the browser engine keeps the books.
          useHttpsScheme: true,
          // No browser developer tools in a release build (Tauri allows them in debug only).
          devtools: false,
        },
      ],
      security: {
        // No policy of Tauri's own: each page carries the website's policy in its meta tag
        // (apps/business/scripts/static_csp.mjs), and that is the one that applies. A second
        // policy here would only combine with it, and Tauri rewrites the one it sends.
        csp: null,
        // No capabilities: no window may call any command, core or plugin.
        capabilities: [],
        // The pages' own scripts are the only ones in them; Tauri's are added by the app.
        dangerousDisableAssetCspModification: false,
        freezePrototype: false,
      },
    },
    bundle: {
      active: true,
      targets: "all",
      // Made by `pnpm --filter @pnw/desktop icons` from brand/source/hewn-icon.png; not committed.
      icon: ["icons/32x32.png", "icons/128x128.png", "icons/128x128@2x.png", "icons/icon.icns", "icons/icon.ico"],
      // The update packages and their signatures are made on the operator's machine, not here:
      // the update key never goes into CI (apps/desktop/README.md).
      createUpdaterArtifacts: false,
      category: "Finance",
      shortDescription: brand.tagline,
      longDescription: `${brand.name}: ${brand.tagline}`,
      publisher: brand.operator,
      copyright: credit.copyright,
      homepage: brand.siteUrl,
      license: "AGPL-3.0-only",
      windows: {
        // Downloads WebView2 if the computer doesn't have it; Windows 11 always does.
        webviewInstallMode: { type: "downloadBootstrapper", silent: true },
      },
    },
    plugins: {
      updater: {
        // The operator's update key (minisign, base64): an update signed with anything else is
        // refused. Empty until the operator adds it; the app then checks for nothing.
        pubkey: brand.desktop.updateKey,
        endpoints: [updateEndpoint(brand.sourceUrl)],
        // The signature must name the version it was made for, so an old signed release can't be
        // served as a newer one.
        requireSignedVersion: true,
        windows: { installMode: "passive" },
      },
    },
  } as const;
}

/** The file as written: two-space JSON and a final newline. */
export function tauriConfigText(brand?: Brand, credit?: Credit): string {
  return `${JSON.stringify(tauriConfig(brand, credit), null, 2)}\n`;
}
