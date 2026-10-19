import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { BRAND } from "@/brand";
import { AppShell } from "@/shell/AppShell";
import { BooksGate } from "@/books/BooksGate";
import { BooksProvider } from "@/books/BooksProvider";
import { PageViews } from "@/PageViews";
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
  await connection();
  return (
    <html lang="en">
      <body className="antialiased">
        <BooksProvider>
          <BooksGate>
            <AppShell>{children}</AppShell>
          </BooksGate>
        </BooksProvider>
        <PageViews />
      </body>
    </html>
  );
}
