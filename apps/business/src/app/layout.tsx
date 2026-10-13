import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { AppShell } from "@/shell/AppShell";
import { BooksGate } from "@/books/BooksGate";
import { BooksProvider } from "@/books/BooksProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Plumb",
  description: "Honest books, grounded and true. Private bookkeeping, payroll and reports for small businesses.",
  applicationName: "Plumb",
  appleWebApp: { title: "Plumb", capable: true, statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f5ef" },
    { media: "(prefers-color-scheme: dark)", color: "#091623" },
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
      </body>
    </html>
  );
}
