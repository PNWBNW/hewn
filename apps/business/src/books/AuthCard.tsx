import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import { PlumbHero, PlumbLogo } from "@/shell/Brand";

/** Full-page frame for setup, unlock and restore: the books aren't open yet. */
export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-background">
      {/* Whole hero, never cropped (the tagline is part of the art). On wide screens it's capped
          and fades into the ink band at the sides. */}
      <div className="bg-[var(--plumb-ink)]">
        <PlumbHero className="mx-auto max-w-[1100px] lg:[mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]" />
      </div>
      <div className="relative mx-auto -mt-6 w-full max-w-md px-4 pb-10 sm:-mt-16">
        <div className="rounded-xl border bg-card p-6 shadow-lg">
          <PlumbLogo height={30} className="mb-5" />
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
        <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <Lock aria-hidden className="size-3" />
          Encrypted on this device. Nothing is sent to a server.
        </p>
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {message}
    </p>
  );
}

export const inputClass =
  "flex h-11 w-full rounded-md border border-input bg-card px-3 text-base shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-10 sm:text-sm";

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong";
}
