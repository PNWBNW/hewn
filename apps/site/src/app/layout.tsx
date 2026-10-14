import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { BRAND } from "@pnw/brand";
import { SiteFooter, SiteHeader } from "@/components/Chrome";
import { DESCRIPTION } from "@/copy";
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
    images: [{ url: BRAND.assets.heroJpg1536, width: 1536, height: 729, alt: `${BRAND.name}: ${BRAND.tagline}` }],
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
  return (
    <html lang="en">
      <body className="flex min-h-dvh flex-col overflow-x-hidden antialiased">
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
