// ---------------------------------------------------------------------------
// The product's name and brand, in one place, shared by the app and the
// marketing site. Renaming the product means editing this file and re-running
// brand/build_assets.py with the new art.
// ---------------------------------------------------------------------------

export const BRAND = {
  name: "Plumb", // working name; final name to be decided
  tagline: "honest books, grounded and true.",
  /** Extension for downloaded backup files. */
  backupExtension: "plumb",
  /** Shown after a registered name (`name.hewn`). The registry stores the bare name. */
  nameSuffix: "hewn",
  /** Prefix of the message Shield signs to link an account. A protocol tag: it stays put if the name changes. */
  railLinkDomain: "hewn:link:v1",
  colors: { green: "#113b31", cream: "#f5f0e3", ink: "#091623", canvas: "#f7f5ef" },
  assets: {
    markDark: "/brand/plumb-mark-dark.png",
    wordmarkOnLight: "/brand/plumb-wordmark-green.png",
    wordmarkOnDark: "/brand/plumb-wordmark-cream.png",
    wordmarkAspect: 373 / 115,
    heroWebp768: "/brand/plumb-hero-768.webp",
    heroWebp1536: "/brand/plumb-hero-1536.webp",
    heroJpg1536: "/brand/plumb-hero-1536.jpg",
    icon192: "/brand/plumb-icon-192.png",
    icon512: "/brand/plumb-icon-512.png",
    iconMaskable512: "/brand/plumb-icon-maskable-512.png",
  },
  /** Where the app lives. The site's "Open the app" button points here. */
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "https://app.hewnaccounting.com",
  /** Where the marketing site lives. */
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "https://hewnaccounting.com",
} as const;
