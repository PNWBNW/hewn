// ---------------------------------------------------------------------------
// The product's name and brand, in one place, shared by the app and the
// marketing site. Renaming the product means editing this file and re-running
// brand/build_assets.py with the new art.
// ---------------------------------------------------------------------------

export const BRAND = {
  name: "Hewn",
  tagline: "honest books, grounded and true.",
  /** Extension for downloaded backup files. */
  backupExtension: "hewn",
  /** Shown after a registered name (`name.hewn`). The registry stores the bare name. */
  nameSuffix: "hewn",
  /** Prefix of the message Shield signs to link an account. A protocol tag: it stays put if the name changes. */
  railLinkDomain: "hewn:link:v1",
  colors: { green: "#113b31", cream: "#f5f0e3", ink: "#091623", canvas: "#f7f5ef" },
  assets: {
    markDark: "/brand/hewn-mark.png",
    wordmarkOnLight: "/brand/hewn-wordmark-green.png",
    wordmarkOnDark: "/brand/hewn-wordmark-cream.png",
    wordmarkAspect: 315 / 123,
    heroWebp768: "/brand/hewn-hero-768.webp",
    heroWebp1536: "/brand/hewn-hero-1536.webp",
    heroJpg1536: "/brand/hewn-hero-1536.jpg",
    icon192: "/brand/hewn-icon-192.png",
    icon512: "/brand/hewn-icon-512.png",
    iconMaskable512: "/brand/hewn-icon-maskable-512.png",
    /** Product tiles the marketing site shows. */
    tiles: {
      books: "/brand/hewn-tile-books.png",
      payroll: "/brand/hewn-tile-payroll.png",
      invoices: "/brand/hewn-tile-invoices.png",
      reports: "/brand/hewn-tile-reports.png",
    },
  },
  /** Where the app lives. The site's "Open the app" button points here. */
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "https://app.hewnaccounting.com",
  /** Where the marketing site lives. */
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "https://hewnaccounting.com",
} as const;
