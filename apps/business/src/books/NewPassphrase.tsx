"use client";

// A new passphrase, typed twice, with the strength meter and the reasons it isn't accepted yet: for
// setting one with a recovery key (login and restore). Setup has its own fuller version.

import { type Strength, MIN_NEW_PASSPHRASE, checkNewPassphrase } from "@pnw/vault";
import { cn } from "@pnw/ui/utils";
import { Field, PassphraseInput, inputClass } from "./AuthCard";

const STRENGTH_STEPS: Record<Strength, { filled: number; tone: string; label: string }> = {
  "too weak": { filled: 1, tone: "bg-destructive", label: "Too weak" },
  weak: { filled: 2, tone: "bg-destructive", label: "Weak" },
  fair: { filled: 3, tone: "bg-warning", label: "Fair: another word or two would help" },
  strong: { filled: 4, tone: "bg-[var(--hewn-green)]", label: "Strong" },
  "very strong": { filled: 5, tone: "bg-[var(--hewn-green)]", label: "Very strong" },
};

/** Five bars and a word: how hard the passphrase looks to guess offline. */
export function StrengthMeter({ strength }: { strength: Strength }) {
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

/** True when a new passphrase is acceptable and typed the same twice. */
export const newPassphraseReady = (passphrase: string, confirm: string, username: string): boolean => checkNewPassphrase(passphrase, username).ok && confirm === passphrase;

export function NewPassphraseFields({
  username,
  passphrase,
  onPassphrase,
  confirm,
  onConfirm,
}: {
  username: string;
  passphrase: string;
  onPassphrase: (v: string) => void;
  confirm: string;
  onConfirm: (v: string) => void;
}) {
  const check = checkNewPassphrase(passphrase, username);
  const mismatch = confirm.length > 0 && confirm !== passphrase;
  return (
    <>
      <Field label="New passphrase" hint={`At least ${MIN_NEW_PASSPHRASE} characters, with a letter and a space or symbol. Five random words is best.`}>
        <PassphraseInput value={passphrase} onChange={onPassphrase} autoComplete="new-password" name="new-password" />
      </Field>
      {passphrase && (
        <div className="-mt-2 flex flex-col gap-1">
          <StrengthMeter strength={check.strength} />
          {check.problems.length > 0 && (
            <ul className="text-xs text-destructive">
              {check.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <Field label="Type it again">
        <input
          className={cn(inputClass, mismatch && "border-destructive")}
          type="password"
          value={confirm}
          onChange={(e) => onConfirm(e.target.value)}
          autoComplete="new-password"
          aria-invalid={mismatch}
        />
      </Field>
      {mismatch && <p className="-mt-2 text-xs text-destructive">The two don&apos;t match yet.</p>}
    </>
  );
}
