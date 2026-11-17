import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { BRAND } from "@pnw/brand";
import { SiteFooter, SiteHeader } from "@/components/Chrome";
import { DESCRIPTION } from "@/copy";
import { PageViews } from "@/PageViews";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(BRAND.siteUrl),
  title: { default: BRAND.name, template: `%s · ${BRAND.name}` },
  description: DESCRIPTION,
  applicationName: BRAND.name,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: BRAND.name,
    title: BRAND.name,
    description: DESCRIPTION,
    images: [{ url: BRAND.assets.heroJpg1536, width: 1536, height: 526, alt: `${BRAND.name}: ${BRAND.tagline}` }],
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: BRAND.colors.canvas },
    { media: "(prefers-color-scheme: dark)", color: BRAND.colors.ink },
  ],
};

// Render per request so every page gets a fresh CSP nonce (src/proxy.ts).
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await connection();
  // The page stays hidden until the site's own code finds it is the top page and marks <html>
  // (src/instrumentation-client.ts, before hydration), hence suppressHydrationWarning: that mark
  // is not in this markup on purpose. Without JavaScript only the note below shows.
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-dvh flex-col overflow-x-hidden antialiased">
        <noscript>
          <p className="mx-auto max-w-md p-6 text-sm">
            {BRAND.name}: {BRAND.tagline} This page needs JavaScript to show. Turn it on for this site and reload
            the page.
          </p>
        </noscript>
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
        <PageViews />
      </body>
    </html>
  );
}
