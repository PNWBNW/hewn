"use client";

import { useState } from "react";
import { TEMPLATES, type TemplateId } from "@pnw/ledger";
import { MIN_PASSPHRASE } from "@pnw/vault";
import { Button } from "@pnw/ui/button";
import { cn } from "@pnw/ui/utils";
import { AuthCard, Field, FormError, errorMessage, inputClass } from "./AuthCard";
import { useBooks } from "./BooksProvider";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type Step = "business" | "accounts" | "protect";

export function SetupScreen({ onRestore }: { onRestore: () => void }) {
  const { create } = useBooks();
  const [step, setStep] = useState<Step>("business");
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

  async function finish() {
    setError(null);
    setBusy(true);
    try {
      await create({ businessName: businessName.trim(), fiscalYearStartMonth, template, passphrase });
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  const stepNo = { business: 1, accounts: 2, protect: 3 }[step];

  return (
    <AuthCard title="Set up your books" subtitle={`Step ${stepNo} of 3`}>
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
          <Button type="submit" className="h-11" disabled={!businessName.trim()}>
            Continue
          </Button>
          <button type="button" onClick={onRestore} className="text-sm text-muted-foreground underline underline-offset-4">
            I have a backup file to restore
          </button>
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
            <Button type="button" variant="outline" className="h-11 flex-1" onClick={() => setStep("business")}>
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
            Your books are encrypted on this device with a passphrase only you know. Pick something long and
            memorable, like a short sentence.
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
              I understand there is no &ldquo;forgot passphrase&rdquo;. No one, including PNW, can open these books
              without it. I&apos;ll keep a backup file somewhere safe.
            </span>
          </label>
          <FormError message={error} />
          <div className="flex gap-3">
            <Button type="button" variant="outline" className="h-11 flex-1" onClick={() => setStep("accounts")} disabled={busy}>
              Back
            </Button>
            <Button
              type="submit"
              className="h-11 flex-1"
              disabled={busy || tooShort || mismatch || confirm !== passphrase || !understood}
            >
              {busy ? "Encrypting…" : "Create my books"}
            </Button>
          </div>
        </form>
      )}
    </AuthCard>
  );
}
