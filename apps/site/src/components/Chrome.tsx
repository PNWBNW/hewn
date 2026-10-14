import Link from "next/link";
import { BRAND } from "@pnw/brand";
import { BrandLogo } from "@/components/Brand";

export const buttonClass =
  "inline-flex h-11 items-center justify-center rounded-md bg-primary px-5 text-base font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function SiteHeader() {
  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4">
        <Link href="/" className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <BrandLogo height={28} />
        </Link>
        <nav aria-label="Site" className="flex items-center gap-4 text-sm">
          <Link href="/privacy" className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            Privacy
          </Link>
          <a
            href={BRAND.appUrl}
            className="inline-flex h-9 items-center rounded-md border px-3 font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Open the app
          </a>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>
          <span className="font-medium text-foreground">{BRAND.name}</span> · {BRAND.tagline}
        </p>
        <nav aria-label="Footer" className="flex items-center gap-4">
          <Link href="/privacy" className="underline-offset-4 hover:text-foreground hover:underline">
            Privacy
          </Link>
          <a href={BRAND.appUrl} className="underline-offset-4 hover:text-foreground hover:underline">
            Open the app
          </a>
        </nav>
      </div>
    </footer>
  );
}
