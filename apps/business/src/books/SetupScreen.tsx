"use client";

import { useState } from "react";
import Link from "next/link";
import { Briefcase, HardHat, Sparkles } from "lucide-react";
import { TEMPLATES, type TemplateId } from "@pnw/ledger";
import { MIN_NEW_PASSPHRASE, type Strength, checkNewPassphrase, suggestPassphrase } from "@pnw/vault";
import { Button } from "@pnw/ui/button";
import { cn } from "@pnw/ui/utils";
import { AuthCard, Field, FormError, PassphraseInput, errorMessage, inputClass } from "./AuthCard";
import { MAX_USERNAME_LENGTH, MIN_USERNAME_LENGTH, isUsername } from "./account";
import { BRAND } from "@/brand";
import { useBooks } from "./BooksProvider";
import type { Role } from "./work";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type Step = "role" | "business" | "accounts" | "person" | "protect";

/** New here: what brings you, a few details, then a username and passphrase. `onBack` returns to the front page. */
export function SetupScreen({ onBack, onRestore }: { onBack: () => void; onRestore: () => void }) {
  const { create } = useBooks();
  const [role, setRole] = useState<Role>("business");
  const [step, setStep] = useState<Step>("role");
  const [businessName, setBusinessName] = useState("");
  const [fiscalYearStartMonth, setFyStart] = useState(1);
  const [template, setTemplate] = useState<TemplateId | "blank">("service");
  const [username, setUsername] = useState("");
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  // Bumped when a passphrase is suggested, so the field remounts showing it (to write down).
  const [suggested, setSuggested] = useState(0);
  const [confirm, setConfirm] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const check = checkNewPassphrase(passphrase, username);
  const mismatch = confirm.length > 0 && confirm !== passphrase;
  const usernameOk = isUsername(username);
  const usernameBad = usernameTouched && username.trim() !== "" && !usernameOk;
  const worker = role === "worker";

  async function finish() {
    setError(null);
    setBusy(true);
    try {
      if (worker) await create({ businessName: businessName.trim(), fiscalYearStartMonth: 1, template: "blank", username, passphrase, role });
      else await create({ businessName: businessName.trim(), fiscalYearStartMonth, template, username, passphrase, role });
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
    <AuthCard
      title={title}
      subtitle={`Step ${stepNo} of ${steps.length}`}
      onBack={onBack}
      backLabel={step === "role" ? "Back" : "Front page"}
    >
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
          <p className="text-xs text-muted-foreground">
            You can have both. Make one now and add the other later, with the same username. Each needs its own Shield account and its own
            registered name.
          </p>
          <button type="button" onClick={onRestore} className="min-h-11 self-start text-sm text-muted-foreground underline underline-offset-4">
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
            if (usernameOk && check.ok && !mismatch && confirm === passphrase && understood) void finish();
          }}
        >
          <p className="text-sm text-muted-foreground">
            {worker ? "Your agreements, hours and paystubs are" : "Your books are"} encrypted on this device. Your username and a passphrase only you
            know open them together. Pick something long and memorable, like a short sentence. Next, you&apos;ll link your Shield account and
            register your name.
          </p>
          <Field label="Username" hint="Only this device knows it, and it isn't your public name. Letters, numbers, dots, dashes or underscores.">
            <input
              className={cn(inputClass, usernameBad && "border-destructive")}
              type="text"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={254}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onBlur={() => setUsernameTouched(true)}
              aria-invalid={usernameBad}
              autoFocus
            />
          </Field>
          {usernameBad && (
            <p className="-mt-3 text-xs text-destructive">
              Use {MIN_USERNAME_LENGTH} to {MAX_USERNAME_LENGTH} letters, numbers, dots, dashes or underscores.
            </p>
          )}
          <Field label="Passphrase" hint={`At least ${MIN_NEW_PASSPHRASE} characters, with a letter and a space or symbol. Five random words is best.`}>
            <PassphraseInput key={suggested} value={passphrase} onChange={setPassphrase} autoComplete="new-password" name="new-password" initiallyShown={suggested > 0} />
          </Field>
          <div className="-mt-3 flex flex-col gap-2">
            {passphrase && <StrengthMeter strength={check.strength} />}
            {passphrase && check.problems.length > 0 && (
              <ul className="text-xs text-destructive">
                {check.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11 sm:min-h-8"
                onClick={() => {
                  setPassphrase(suggestPassphrase());
                  setConfirm("");
                  setSuggested((n) => n + 1);
                }}
              >
                <Sparkles aria-hidden />
                Suggest one
              </Button>
              {suggested > 0 && <span className="text-xs text-muted-foreground">Write it down now, then type it below.</span>}
            </div>
          </div>
          <p className="-mt-3 text-sm">There is no password reset. If you lose your passphrase, you lose the books, so keep a backup.</p>
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
              I understand my passphrase can&apos;t be recovered, and that {BRAND.name} is testnet software provided as is: not tax, legal or accounting
              advice.{" "}
              <Link href="/terms" target="_blank" className="underline underline-offset-4">
                Terms
              </Link>
              {" · "}
              <Link href="/privacy" target="_blank" className="underline underline-offset-4">
                Privacy
              </Link>
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
              disabled={busy || !usernameOk || !check.ok || mismatch || confirm !== passphrase || !understood}
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

const STRENGTH_STEPS: Record<Strength, { filled: number; tone: string; label: string }> = {
  "too weak": { filled: 1, tone: "bg-destructive", label: "Too weak" },
  weak: { filled: 2, tone: "bg-destructive", label: "Weak" },
  fair: { filled: 3, tone: "bg-warning", label: "Fair: another word or two would help" },
  strong: { filled: 4, tone: "bg-[var(--hewn-green)]", label: "Strong" },
  "very strong": { filled: 5, tone: "bg-[var(--hewn-green)]", label: "Very strong" },
};

/** Five bars and a word: how hard the passphrase looks to guess offline. */
function StrengthMeter({ strength }: { strength: Strength }) {
  const step = STRENGTH_STEPS[strength];
  return (
    <div className="flex items-center gap-3" role="status" aria-live="polite">
      <div className="flex flex-1 gap-1" aria-hidden>
        {Array.from({ length: 5 }, (_, i) => (
          <span key={i} className={cn("h-1.5 flex-1 rounded-full", i < step.filled ? step.tone : "bg-muted")} />
        ))}
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">{step.label}</span>
    </div>
  );
}
