"use client";

import { useState } from "react";
import { BadgeDollarSign, HardDrive, LogIn, UserCheck } from "lucide-react";
import { Button } from "@pnw/ui/button";
import { BRAND } from "@/brand";
import { AuthFooter, AuthHero, AuthTopBar } from "./AuthCard";
import { LoginDialog } from "./LoginDialog";
import type { RestoreStart } from "./RestoreScreen";

const VALUES = [
  { icon: HardDrive, text: "Your books stay on your device" },
  { icon: UserCheck, text: "Pay your team privately, if you want to" },
  { icon: BadgeDollarSign, text: "Free" },
] as const;

/**
 * What a visitor sees first: the whole hero, a few plain words, and two ways in. Nothing opens by
 * itself. On a device with no books Get started leads; on one with books Log in does.
 */
export function FrontPage({ locked, onNewHere, onRestore }: { locked: boolean; onNewHere: () => void; onRestore: (start?: RestoreStart) => void }) {
  const [loginOpen, setLoginOpen] = useState(false);

  const getStarted = (
    <Button key="start" variant={locked ? "outline" : "default"} className="h-12 px-6 sm:min-w-44" onClick={onNewHere}>
      Get started
    </Button>
  );
  const logIn = (
    <Button key="login" variant={locked ? "default" : "outline"} className="h-12 px-6 sm:min-w-44" onClick={() => setLoginOpen(true)}>
      <LogIn aria-hidden />
      Log in
    </Button>
  );

  return (
    <div className="min-h-dvh bg-background">
      <AuthTopBar>
        <button
          type="button"
          onClick={onNewHere}
          className="inline-flex min-h-11 items-center rounded-md px-2.5 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          New here?
        </button>
        <Button variant={locked ? "default" : "outline"} className="min-h-11 px-3 sm:min-h-9" onClick={() => setLoginOpen(true)}>
          <LogIn aria-hidden />
          Log in
        </Button>
      </AuthTopBar>

      <AuthHero />

      <main className="mx-auto w-full max-w-3xl px-4 pb-6 pt-8 text-center sm:pt-10">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{BRAND.tagline}</h1>
        <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-muted-foreground">
          {BRAND.name} is bookkeeping and payroll for a small business, and it runs entirely in your browser. Your books are encrypted on your
          own computer or phone, nothing is uploaded, and nobody but you can read them.
        </p>

        <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-center">{locked ? [logIn, getStarted] : [getStarted, logIn]}</div>

        <ul className="mt-9 grid gap-3 text-left sm:grid-cols-3">
          {VALUES.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-3 rounded-lg border bg-card p-3 text-sm font-medium">
              <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground">
                <Icon className="size-5" />
              </span>
              {text}
            </li>
          ))}
        </ul>

        <div className="mt-8">
          <AuthFooter />
        </div>
      </main>

      <LoginDialog
        open={loginOpen}
        onOpenChange={setLoginOpen}
        onNewHere={() => {
          setLoginOpen(false);
          onNewHere();
        }}
        onRestore={(start) => {
          setLoginOpen(false);
          onRestore(start);
        }}
      />
    </div>
  );
}
