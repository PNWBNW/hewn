"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftRight,
  ChartColumn,
  Download,
  CreditCard,
  FileText,
  FolderKanban,
  Landmark,
  LayoutDashboard,
  Lock,
  Menu,
  Settings,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@pnw/ui/utils";
import { useOpenBooks } from "@/books/BooksProvider";
import { BRAND } from "@/brand";
import { BrandLogo } from "./Brand";
import { SECTIONS } from "./sections";

const ICONS: Record<string, LucideIcon> = {
  transactions: ArrowLeftRight,
  sales: FileText,
  expenses: CreditCard,
  payroll: Users,
  projects: FolderKanban,
  reports: ChartColumn,
  taxes: Landmark,
};

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  ...SECTIONS.map((s) => ({ href: `/${s.id}`, label: s.label, icon: ICONS[s.id] ?? FileText })),
];

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function RailButton({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-11 items-center gap-3 rounded-md px-3 text-left text-sm hover:bg-white/5 hover:text-rail-active-foreground"
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      {label}
    </button>
  );
}

function Rail({
  pathname,
  onNavigate,
  onBackup,
  onLock,
}: {
  pathname: string;
  onNavigate?: () => void;
  onBackup: () => void;
  onLock: () => void;
}) {
  return (
    <nav aria-label="Main" className="flex h-full flex-col gap-1 bg-rail px-3 py-4 text-rail-foreground">
      <Link href="/" onClick={onNavigate} className="mb-4 flex min-h-11 items-center px-2" aria-label={`${BRAND.name}, dashboard`}>
        <BrandLogo tone="onDark" height={30} />
      </Link>
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-11 items-center gap-3 rounded-md px-3 text-sm transition-colors",
              active
                ? "bg-rail-active font-medium text-rail-active-foreground"
                : "hover:bg-white/5 hover:text-rail-active-foreground",
            )}
          >
            <Icon aria-hidden className={cn("size-4 shrink-0", active && "text-rail-accent")} />
            {label}
          </Link>
        );
      })}
      <div className="mt-auto flex flex-col gap-1 border-t border-rail-border pt-4">
        <Link
          href="/settings"
          onClick={onNavigate}
          aria-current={isActive(pathname, "/settings") ? "page" : undefined}
          className={cn(
            "flex min-h-11 items-center gap-3 rounded-md px-3 text-sm transition-colors",
            isActive(pathname, "/settings")
              ? "bg-rail-active font-medium text-rail-active-foreground"
              : "hover:bg-white/5 hover:text-rail-active-foreground",
          )}
        >
          <Settings aria-hidden className={cn("size-4 shrink-0", isActive(pathname, "/settings") && "text-rail-accent")} />
          Settings
        </Link>
        <RailButton icon={Download} label="Download a backup" onClick={onBackup} />
        <RailButton icon={Lock} label="Lock books" onClick={onLock} />
        <p className="px-3 pt-2 text-xs leading-relaxed text-rail-muted">
          Your books stay on this device, encrypted. Nothing is sent to a server.
        </p>
      </div>
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { books, lock, downloadBackup } = useOpenBooks();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close the mobile drawer on navigation and on Escape.
  useEffect(() => setDrawerOpen(false), [pathname]);
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawerOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="sticky top-0 hidden h-dvh border-r border-rail-border lg:block">
        <Rail pathname={pathname} onBackup={() => void downloadBackup()} onLock={lock} />
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button
            aria-label="Close menu"
            className="absolute inset-0 bg-black/40"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] shadow-xl">
            <Rail pathname={pathname} onNavigate={() => setDrawerOpen(false)} onBackup={() => void downloadBackup()} onLock={lock} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-card/90 px-4 backdrop-blur sm:px-6">
          <button
            className="-ml-2 grid size-11 place-items-center rounded-md hover:bg-accent lg:hidden"
            aria-label={drawerOpen ? "Close menu" : "Open menu"}
            onClick={() => setDrawerOpen((o) => !o)}
          >
            {drawerOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{books.settings.businessName}</div>
          </div>
          <span
            className="inline-flex items-center gap-1.5 rounded-full border bg-muted px-2.5 py-1 text-xs text-muted-foreground"
            title="Your books are kept only on this device, encrypted. Money moves through your bank as usual."
          >
            <Lock aria-hidden className="size-3" />
            Private · this device
          </span>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
