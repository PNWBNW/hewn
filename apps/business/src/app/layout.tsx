import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { BRAND } from "@/brand";
import { AppShell } from "@/shell/AppShell";
import { BooksGate } from "@/books/BooksGate";
import { BooksProvider } from "@/books/BooksProvider";
import { PageViews } from "@/shell/PageViews";
import { VisitCounter } from "@/traction/VisitCounter";
import "./globals.css";

export const metadata: Metadata = {
  title: BRAND.name,
  description: `${BRAND.tagline} Private bookkeeping, payroll and reports for small businesses.`,
  applicationName: BRAND.name,
  appleWebApp: { title: BRAND.name, capable: true, statusBarStyle: "default" },
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
  // The static bundle (next.config.ts) has no request to wait for and no nonce to stamp: its
  // policy goes into each page after the export (scripts/static_csp.ts).
  if (process.env.NEXT_PUBLIC_HEWN_STATIC !== "1") await connection();
  return (
    <html lang="en">
      <body className="antialiased">
        <BooksProvider>
          <BooksGate>
            <AppShell>{children}</AppShell>
          </BooksGate>
        </BooksProvider>
        <PageViews />
        <VisitCounter />
      </body>
    </html>
  );
}
