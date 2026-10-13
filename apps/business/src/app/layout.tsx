import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { AppShell } from "@/shell/AppShell";
import { BooksGate } from "@/books/BooksGate";
import { BooksProvider } from "@/books/BooksProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "PNW Ledger",
  description: "Private bookkeeping, payroll and reports for small businesses.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
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
