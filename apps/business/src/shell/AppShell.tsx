"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeftRight, Briefcase, ChartColumn, Clock, CreditCard, Download, FileText, FolderKanban, Home, IdCard, Inbox, Landmark, LayoutDashboard, Lock, LogOut, Mailbox, Menu, MessageSquare, Settings, type LucideIcon, Users, X } from "lucide-react";
import { cn } from "@pnw/ui/utils";
import { useBooks, useOpenBooks } from "@/books/BooksProvider";
import { SETUP_PATH, setupRedirect, setupStep } from "@/books/setup";
import { unreadCount } from "@/books/mailbox";
import { unreadIn } from "@/books/thread";
import { unreadPosts } from "@/books/channels";
import { waitingCount } from "@/books/review";
import type { Role } from "@/books/work";
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

type NavItem = { href: string; label: string; icon: LucideIcon };

const BUSINESS_NAV: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  ...SECTIONS.map((s) => ({ href: `/${s.id}`, label: s.label, icon: ICONS[s.id] ?? FileText })),
  { href: "/jobs", label: "Jobs", icon: Briefcase },
  { href: "/mailbox", label: "Mailbox", icon: Mailbox },
  { href: "/messages", label: "Messages", icon: MessageSquare },
];

/** A person who works for a business: their own, smaller app. */
export const WORK_NAV: NavItem[] = [
  { href: "/work", label: "Home", icon: Home },
  { href: "/work/offers", label: "Offers", icon: Inbox },
  { href: "/board", label: "Find work", icon: Briefcase },
  { href: "/work/applications", label: "Applications", icon: FileText },
  { href: "/work/messages", label: "Messages", icon: MessageSquare },
  { href: "/work/hours", label: "Hours", icon: Clock },
  { href: "/work/paystubs", label: "Paystubs", icon: Mailbox },
  { href: "/work/profile", label: "Profile", icon: IdCard },
];

/** The pathname without a trailing slash: the static bundle's pages are folders (next.config.ts), the website's are not. */
export const canonicalPath = (pathname: string) => (pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname);

export const isWorkPath = (pathname: string) => pathname === "/work" || pathname.startsWith("/work/");

/** Pages anyone can read without an account: the job board, and traction. */
export const isPublicPath = (pathname: string) =>
  ["/board", "/traction"].some((p) => pathname === p || pathname.startsWith(`${p}/`));

/** Where a vault of this role belongs when it lands on the other role's pages; null when the path is fine. */
export function redirectFor(role: Role, pathname: string): string | null {
  if (pathname === "/settings" || pathname.startsWith("/settings/") || isPublicPath(pathname)) return null;
  if (role === "worker") return isWorkPath(pathname) ? null : "/work";
  return isWorkPath(pathname) ? "/" : null;
}

function isActive(pathname: string, href: string): boolean {
  const home = href === "/" || href === "/work";
  return home ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
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
  role,
  setupDone,
  onNavigate,
  onBackup,
  onLock,
}: {
  pathname: string;
  role: Role;
  /** Until setup is finished the only place to go is the setup page. */
  setupDone: boolean;
  onNavigate?: () => void;
  onBackup: () => void;
  onLock: () => void;
}) {
  const { mailbox, review, work } = useOpenBooks();
  const unread = unreadCount(mailbox);
  // Unread messages: in the business's threads, or the person's.
  const unreadMessages =
    Object.values((role === "worker" ? work?.threads : mailbox?.threads) ?? {}).reduce((n, t) => n + unreadIn(t), 0) +
    (role === "worker" ? (work?.channels ?? []).reduce((n, c) => n + unreadPosts(c), 0) + Object.values(work?.coworkers ?? {}).reduce((n, t) => n + unreadIn(t), 0) : 0);
  const waiting = waitingCount(review);
  const worker = role === "worker";
  const nav = !setupDone ? [{ href: SETUP_PATH, label: "Finish setup", icon: Settings }] : worker ? WORK_NAV : BUSINESS_NAV;
  const home = worker ? "/work" : "/";
  return (
    // Scrolls when the menu is taller than the screen (a phone with the Shield browser's bars), so Log out is never out of reach.
    <nav aria-label="Main" className="flex h-full flex-col gap-1 overflow-y-auto overscroll-contain bg-rail px-3 py-4 text-rail-foreground">
      <Link href={home} onClick={onNavigate} className="mb-4 flex min-h-11 items-center px-2" aria-label={`${BRAND.name}, ${worker ? "home" : "dashboard"}`}>
        <BrandLogo tone="onDark" height={30} />
      </Link>
      {nav.map(({ href, label, icon: Icon }) => {
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
            {(href === "/messages" || href === "/work/messages") && unreadMessages > 0 && (
              <span className="ml-auto rounded-full bg-rail-accent px-2 text-xs font-medium text-rail" aria-label={`${unreadMessages} unread`}>
                {unreadMessages}
              </span>
            )}
            {href === "/mailbox" && unread > 0 && (
              <span className="ml-auto rounded-full bg-rail-accent px-2 text-xs font-medium text-rail" aria-label={`${unread} unread`}>
                {unread}
              </span>
            )}
            {href === "/transactions" && waiting > 0 && (
              <span className="ml-auto rounded-full bg-rail-accent px-2 text-xs font-medium text-rail" aria-label={`${waiting} to review`}>
                {waiting}
              </span>
            )}
          </Link>
        );
      })}
      <div className="mt-auto flex flex-col gap-1 border-t border-rail-border pt-4">
        {setupDone && (
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
        )}
        <RailButton icon={Download} label="Download a backup" onClick={onBackup} />
        <RailButton icon={LogOut} label="Log out" onClick={onLock} />
        <p className="px-3 pt-2 text-xs leading-relaxed text-rail-muted">
          {worker ? "Your hours and paystubs stay on this device, encrypted." : "Your books stay on this device, encrypted."} They are never sent
          to a server.{" "}
          <a href={BRAND.sourceUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-rail-active-foreground">
            Source code
          </a>
          {" · "}
          <Link href="/traction" className="underline underline-offset-4 hover:text-rail-active-foreground">
            Traction map
          </Link>
        </p>
      </div>
    </nav>
  );
}

/** The app around a page: the rail and header once the books are open; a bare header for a public page before then. */
export function AppShell({ children }: { children: ReactNode }) {
  const { status } = useBooks();
  return status === "open" ? <OpenShell>{children}</OpenShell> : <PublicShell>{children}</PublicShell>;
}

/** Around a public page (the job board) for someone without open books: the brand, and a way in. */
function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-card/90 px-4 backdrop-blur sm:px-6">
        <Link href="/" className="flex min-h-11 items-center" aria-label={`${BRAND.name}, front page`}>
          <BrandLogo height={24} />
        </Link>
        <div className="flex-1" />
        <Link href="/" className="inline-flex min-h-11 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 sm:min-h-9">
          Open {BRAND.name}
        </Link>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:py-8">{children}</main>
    </div>
  );
}

function OpenShell({ children }: { children: ReactNode }) {
  const pathname = canonicalPath(usePathname());
  const router = useRouter();
  const { books, role, rail, work, lock, downloadBackup } = useOpenBooks();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // A worker's vault lives under /work and a business's everywhere else;
  // landing on the other side (a stale link, a typed URL) goes home.
  // Every account links Shield and registers its name before anything else.
  const step = setupStep({ role, rail, work });
  const setupDone = step === "done";
  const redirect = setupRedirect(step, pathname) ?? redirectFor(role, pathname);
  useEffect(() => {
    if (redirect) router.replace(redirect);
  }, [redirect, router]);

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
        <Rail pathname={pathname} role={role} setupDone={setupDone} onBackup={() => void downloadBackup()} onLock={lock} />
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button
            aria-label="Close menu"
            className="absolute inset-0 bg-black/40"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] shadow-xl">
            <Rail pathname={pathname} role={role} setupDone={setupDone} onNavigate={() => setDrawerOpen(false)} onBackup={() => void downloadBackup()} onLock={lock} />
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
            title={
              role === "worker"
                ? "Your hours and paystubs are kept only on this device, encrypted."
                : "Your books are kept only on this device, encrypted. Money moves through your bank as usual."
            }
          >
            <Lock aria-hidden className="size-3" />
            Private · this device
          </span>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:py-8">
          {redirect ? <p className="text-sm text-muted-foreground">{setupDone ? "Taking you home…" : "Finishing setup…"}</p> : children}
        </main>
      </div>
    </div>
  );
}
