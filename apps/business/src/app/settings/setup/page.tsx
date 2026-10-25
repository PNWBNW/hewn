"use client";

// Finishing setup: every account links its Shield account and registers its
// name.hewn before it can use the app, a worker also creates the private
// profile behind the name, and a new account ends by issuing its card
// (docs/HEWN_ART.md). The app shell keeps an unfinished account here. Each
// step loads its Shield-backed panel only when it is the current one.

import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { CircleCheck, Circle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@pnw/ui/card";
import { cn } from "@pnw/ui/utils";
import { useOpenBooks } from "@/books/BooksProvider";
import { type SetupStep, setupStep, setupSteps } from "@/books/setup";
import { BRAND } from "@/brand";
import { PageHeader } from "@/shell/SectionView";

const loading = () => <p className="text-sm text-muted-foreground">Loading…</p>;
const RailPanel = dynamic(() => import("@/chain/RailPanel"), { ssr: false, loading });
const ProfilePanel = dynamic(() => import("@/chain/work/Profile"), { ssr: false, loading });
const CardPanel = dynamic(() => import("@/chain/CardPanel"), { ssr: false, loading });

export default function SetupPage() {
  const { role, rail, work } = useOpenBooks();
  const worker = role === "worker";
  const step = setupStep({ role, rail, work });
  // There's nowhere to go back to, so a panel's Cancel starts its step over.
  const [attempt, setAttempt] = useState(0);
  const restart = () => setAttempt((n) => n + 1);

  const label: Record<Exclude<SetupStep, "done">, string> = {
    link: "Link your Shield account",
    name: worker ? `Register your name (yourname.${BRAND.nameSuffix})` : `Register your business name (yourbusiness.${BRAND.nameSuffix})`,
    profile: "Create your profile",
    card: worker ? "Your card" : "Your business's card",
  };
  const steps = setupSteps(role, rail);
  const current = step === "done" ? steps.length : steps.indexOf(step);
  const name = worker ? work?.profile?.name : rail?.businessName;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={step === "done" ? "You're set up" : "Finish setting up"}
        summary={
          step === "done"
            ? `Registered as ${name ? `${name}.${BRAND.nameSuffix}` : "your name"}.`
            : worker
              ? "Businesses find you by your registered name, and offers, hours and pay go between your Shield account and theirs."
              : "Workers and other businesses find you by your registered name, and offers and payments go between your Shield accounts."
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{step === "done" ? "All done" : `Step ${current + 1} of ${steps.length}`}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ol className="divide-y">
            {steps.map((s, i) => {
              const done = i < current;
              const Icon = done ? CircleCheck : Circle;
              return (
                <li key={s} className="flex min-h-11 items-center gap-3 py-2 text-sm">
                  <Icon aria-hidden className={cn("size-4 shrink-0", done ? "text-money-positive" : i === current ? "text-primary" : "text-muted-foreground")} />
                  <span className={cn(done && "text-muted-foreground line-through", i === current && "font-medium")}>{label[s]}</span>
                  <span className="sr-only">{done ? "Done" : i === current ? "Current step" : "Not done"}</span>
                </li>
              );
            })}
          </ol>

          {step === "link" && (
            <>
              <p className="text-xs text-muted-foreground">
                Shield is the account your pay, offers and documents move through. Use the Shield app or browser extension; linking only asks it to
                sign a short message, nothing is paid.
              </p>
              <RailPanel key={`link-${attempt}`} mode="connect" onClose={restart} />
            </>
          )}
          {step === "name" && !worker && <RailPanel key={`name-${attempt}`} mode="register" onClose={restart} />}
          {(step === "name" || step === "profile") && worker && <ProfilePanel key={`work-${attempt}`} onClose={restart} />}
          {step === "card" && (
            <>
              <p className="text-xs text-muted-foreground">
                {worker
                  ? "Your land, drawn from your name, with a pine that grows with your time here. You choose whether it is shown publicly, and can change that in Settings."
                  : "Your land as a map, drawn from your name, with your time here counting from today. It is public, like your name."}
              </p>
              <CardPanel key={`card-${attempt}`} onClose={restart} />
            </>
          )}
          {step === "done" && (
            <Link
              href={worker ? "/work" : "/"}
              className="inline-flex min-h-11 items-center self-start rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground sm:min-h-9"
            >
              {worker ? "Go to your home page" : "Go to the dashboard"}
            </Link>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
