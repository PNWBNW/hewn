// ---------------------------------------------------------------------------
// The product's name and brand, in one place. Renaming the product means
// editing this file and re-running brand/build_assets.py with the new art.
// ---------------------------------------------------------------------------

export const BRAND = {
  name: "Plumb", // working name; final name to be decided
  tagline: "honest books, grounded and true.",
  /** Extension for downloaded backup files. */
  backupExtension: "plumb",
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
} as const;
