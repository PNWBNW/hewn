"use client";

import { type ReactNode, type Ref, useState } from "react";
import { ArrowLeft, Eye, EyeOff, Lock } from "lucide-react";
import { cn } from "@pnw/ui/utils";
import { BRAND } from "@/brand";
import { BrandHero, BrandLogo } from "@/shell/Brand";

/** The wordmark on the left, whatever the page puts on the right. Shared by the front page and the screens behind it. */
export function AuthTopBar({ children }: { children?: ReactNode }) {
  return (
    <header className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-2 px-4">
      <BrandLogo height={30} />
      <div className="flex items-center gap-1">{children}</div>
    </header>
  );
}

/** Whole hero, never cropped or covered (the tagline is part of the art). On wide screens it's capped and fades into the ink band at the sides. */
export function AuthHero() {
  return (
    <div className="bg-[var(--hewn-ink)]">
      <BrandHero className="mx-auto max-w-[1100px] lg:[mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]" />
    </div>
  );
}

export function AuthFooter() {
  return (
    <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
      <Lock aria-hidden className="size-3" />
      Encrypted on this device. Nothing is sent to a server.{" "}
      <a href={BRAND.sourceUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4">
        Source code
      </a>
    </p>
  );
}

/**
 * Full-page frame for setup and restore (the books aren't open yet): top bar, the hero, then the
 * card below it. The card sits under the art and never over it. `onBack` adds a Back link to the bar.
 */
export function AuthCard({
  title,
  subtitle,
  onBack,
  backLabel = "Back",
  children,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  backLabel?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-background">
      <AuthTopBar>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft aria-hidden className="size-4" />
            {backLabel}
          </button>
        )}
      </AuthTopBar>
      <AuthHero />
      <div className="mx-auto w-full max-w-md px-4 pb-10 pt-6">
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
        <div className="mt-4">
          <AuthFooter />
        </div>
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

/** A passphrase box with a show/hide toggle. The toggle is a real button, 44px on phones. */
export function PassphraseInput({
  value,
  onChange,
  autoComplete = "current-password",
  name = "password",
  inputRef,
}: {
  value: string;
  onChange: (value: string) => void;
  autoComplete?: "current-password" | "new-password";
  name?: string;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const [shown, setShown] = useState(false);
  const Icon = shown ? EyeOff : Eye;
  return (
    <div className="relative">
      <input
        ref={inputRef}
        className={cn(inputClass, "pr-12")}
        type={shown ? "text" : "password"}
        name={name}
        aria-label="Passphrase"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        autoCapitalize="none"
        spellCheck={false}
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? "Hide passphrase" : "Show passphrase"}
        aria-pressed={shown}
        className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icon aria-hidden className="size-4" />
      </button>
    </div>
  );
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong";
}
