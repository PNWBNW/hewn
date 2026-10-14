"use client";

import { useState } from "react";
import { Briefcase, HardHat } from "lucide-react";
import { TEMPLATES, type TemplateId } from "@pnw/ledger";
import { MIN_PASSPHRASE } from "@pnw/vault";
import { Button } from "@pnw/ui/button";
import { cn } from "@pnw/ui/utils";
import { AuthCard, Field, FormError, errorMessage, inputClass } from "./AuthCard";
import { useBooks } from "./BooksProvider";
import type { Role } from "./work";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type Step = "role" | "business" | "accounts" | "person" | "protect";

export function SetupScreen({ onRestore }: { onRestore: () => void }) {
  const { create } = useBooks();
  const [role, setRole] = useState<Role>("business");
  const [step, setStep] = useState<Step>("role");
  const [businessName, setBusinessName] = useState("");
  const [fiscalYearStartMonth, setFyStart] = useState(1);
  const [template, setTemplate] = useState<TemplateId | "blank">("service");
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tooShort = [...passphrase].length < MIN_PASSPHRASE;
  const mismatch = confirm.length > 0 && confirm !== passphrase;
  const worker = role === "worker";

  async function finish() {
    setError(null);
    setBusy(true);
    try {
      if (worker) await create({ businessName: businessName.trim(), fiscalYearStartMonth: 1, template: "blank", passphrase, role });
      else await create({ businessName: businessName.trim(), fiscalYearStartMonth, template, passphrase });
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  // A business: who, which accounts, passphrase. A person: who, passphrase.
  const steps: Step[] = worker ? ["role", "person", "protect"] : ["role", "business", "accounts", "protect"];
  const stepNo = steps.indexOf(step) + 1;
  const back = () => setStep(steps[Math.max(0, steps.indexOf(step) - 1)] ?? "role");
  const title = step === "role" ? "Welcome" : worker ? "Set up your space" : "Set up your books";

  return (
    <AuthCard title={title} subtitle={`Step ${stepNo} of ${steps.length}`}>
      {step === "role" && (
        <div className="flex flex-col gap-5">
          <p className="text-sm text-muted-foreground">What brings you here?</p>
          <div className="flex flex-col gap-3">
            <RoleCard
              icon={Briefcase}
              title="I run a business"
              description="Books, invoices, bills, payroll and reports, all kept on this device."
              onClick={() => {
                setRole("business");
                setStep("business");
              }}
            />
            <RoleCard
              icon={HardHat}
              title="I work for a business"
              description="Offers to accept, clock in and out, send your week, and keep every paystub."
              onClick={() => {
                setRole("worker");
                setStep("person");
              }}
            />
          </div>
          <button type="button" onClick={onRestore} className="text-sm text-muted-foreground underline underline-offset-4">
            I have a backup file to restore
          </button>
        </div>
      )}

      {step === "person" && (
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (businessName.trim()) setStep("protect");
          }}
        >
          <Field label="Your name" hint="How you'd like to be greeted. Employers see the name you register later, not this one.">
            <input
              className={inputClass}
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              autoComplete="name"
              autoFocus
              required
            />
          </Field>
          <div className="flex gap-3">
            <Button type="button" variant="outline" className="h-11 flex-1" onClick={back}>
              Back
            </Button>
            <Button type="submit" className="h-11 flex-1" disabled={!businessName.trim()}>
              Continue
            </Button>
          </div>
        </form>
      )}

      {step === "business" && (
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (businessName.trim()) setStep("accounts");
          }}
        >
          <Field label="Business name">
            <input
              className={inputClass}
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              autoComplete="organization"
              autoFocus
              required
            />
          </Field>
          <Field label="Your fiscal year starts in" hint="Most small businesses use January.">
            <select className={inputClass} value={fiscalYearStartMonth} onChange={(e) => setFyStart(Number(e.target.value))}>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex gap-3">
            <Button type="button" variant="outline" className="h-11 flex-1" onClick={back}>
              Back
            </Button>
            <Button type="submit" className="h-11 flex-1" disabled={!businessName.trim()}>
              Continue
            </Button>
          </div>
        </form>
      )}

      {step === "accounts" && (
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            setStep("protect");
          }}
        >
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">Start with accounts for</legend>
            {[...TEMPLATES, { id: "blank" as const, label: "Start blank", description: "Only the built-in accounts. Add your own." }].map((t) => (
              <label
                key={t.id}
                className={cn(
                  "flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors",
                  template === t.id ? "border-primary bg-accent" : "hover:bg-muted",
                )}
              >
                <input
                  type="radio"
                  name="template"
                  value={t.id}
                  checked={template === t.id}
                  onChange={() => setTemplate(t.id)}
                  className="mt-1 accent-[var(--pnw-forest-500)]"
                />
                <span>
                  <span className="block text-sm font-medium">{t.label}</span>
                  <span className="block text-xs text-muted-foreground">{t.description}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <p className="text-xs text-muted-foreground">You can rename, add or deactivate accounts any time.</p>
          <div className="flex gap-3">
            <Button type="button" variant="outline" className="h-11 flex-1" onClick={back}>
              Back
            </Button>
            <Button type="submit" className="h-11 flex-1">
              Continue
            </Button>
          </div>
        </form>
      )}

      {step === "protect" && (
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!tooShort && !mismatch && confirm === passphrase && understood) void finish();
          }}
        >
          <p className="text-sm text-muted-foreground">
            {worker ? "Your agreements, hours and paystubs are" : "Your books are"} encrypted on this device with a passphrase only you know. Pick
            something long and memorable, like a short sentence.
          </p>
          <Field label="Passphrase" hint={`At least ${MIN_PASSPHRASE} characters.`}>
            <input
              className={inputClass}
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              autoComplete="new-password"
              autoFocus
            />
          </Field>
          <Field label="Type it again">
            <input
              className={cn(inputClass, mismatch && "border-destructive")}
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              aria-invalid={mismatch}
            />
          </Field>
          {mismatch && <p className="-mt-3 text-xs text-destructive">The two don&apos;t match yet.</p>}
          <label className="flex gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
            <input
              type="checkbox"
              checked={understood}
              onChange={(e) => setUnderstood(e.target.checked)}
              className="mt-0.5 accent-[var(--pnw-forest-500)]"
            />
            <span>
              I understand there is no &ldquo;forgot passphrase&rdquo;. No one, including PNW, can open {worker ? "this" : "these books"}
              {" "}without it. I&apos;ll keep a backup file somewhere safe.
            </span>
          </label>
          <FormError message={error} />
          <div className="flex gap-3">
            <Button type="button" variant="outline" className="h-11 flex-1" onClick={back} disabled={busy}>
              Back
            </Button>
            <Button
              type="submit"
              className="h-11 flex-1"
              disabled={busy || tooShort || mismatch || confirm !== passphrase || !understood}
            >
              {busy ? "Encrypting…" : worker ? "Create my space" : "Create my books"}
            </Button>
          </div>
        </form>
      )}
    </AuthCard>
  );
}

function RoleCard({ icon: Icon, title, description, onClick }: { icon: typeof Briefcase; title: string; description: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-11 items-start gap-3 rounded-lg border p-4 text-left transition-colors hover:border-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}
