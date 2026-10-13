import type { Metadata, Viewport } from "next";
import { AppShell } from "@/shell/AppShell";
import "./globals.css";

export const metadata: Metadata = {
  title: "PNW Ledger",
  description: "Private bookkeeping, payroll and reports for small businesses.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
