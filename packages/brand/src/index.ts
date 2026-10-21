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
    /** The navigation icon family (brand/source/nav-icons.png): ink tiles, one per menu item. */
    nav: {
      dashboard: "/brand/hewn-nav-dashboard.png",
      transactions: "/brand/hewn-nav-transactions.png",
      sales: "/brand/hewn-nav-sales.png",
      expenses: "/brand/hewn-nav-expenses.png",
      payroll: "/brand/hewn-nav-payroll.png",
      projects: "/brand/hewn-nav-projects.png",
      reports: "/brand/hewn-nav-reports.png",
      taxes: "/brand/hewn-nav-taxes.png",
      jobs: "/brand/hewn-nav-jobs.png",
      messages: "/brand/hewn-nav-messages.png",
      settings: "/brand/hewn-nav-settings.png",
      schedule: "/brand/hewn-nav-schedule.png",
    },
  },
  /**
   * Where the app lives. The site's "Open the app" button, the icon Shield shows and the installable
   * app's calls to the server all point here. www for now: app.hewnaccounting.com doesn't resolve
   * yet (2026-10-21).
   */
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "https://www.hewnaccounting.com",
  /** Where the marketing site lives. */
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "https://hewnaccounting.com",
  /**
   * The source code. Hewn is AGPL-3.0: anyone who runs a changed copy for others
   * must offer them its source, so every copy links to where its code lives.
   * A fork changes this to its own repository.
   */
  sourceUrl: "https://github.com/PNWBNW/hewn",
  /** Where people write to Hewn: a report can be copied and emailed here. A fork changes it. */
  supportEmail: "hewnsupport@gmail.com",
  /**
   * The account reports go to as sealed letters (Hewn's own; the job board's fees go there
   * too). Only that account's view key opens them. A fork changes it to its own.
   */
  reportsAccount: "aleo1s8t86aza932zah3mv5knclvnn5zy4gedpl5a4wn5h2yrt08mxqzsw5amdd",
  licence: "AGPL-3.0",
} as const;
