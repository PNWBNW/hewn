"use client";

import { useEffect, useRef, useState } from "react";
import { Briefcase, Handshake, HardHat, X } from "lucide-react";
import { Button } from "@pnw/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@pnw/ui/dialog";
import { Field, FormError, PassphraseInput, errorMessage, inputClass } from "./AuthCard";
import { useBooks } from "./BooksProvider";
import { NewPassphraseFields, newPassphraseReady } from "./NewPassphrase";
import type { RestoreStart } from "./RestoreScreen";
import type { Role } from "./work";

const linkClass =
  "inline-flex min-h-11 items-center justify-center rounded-md px-2 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * The Log in pop-up: username and passphrase, nothing else open behind it. Esc, a tap on the backdrop
 * and the X all close it. The form is only mounted while it is open, so closing clears what was typed.
 */
export function LoginDialog({
  open,
  onOpenChange,
  onNewHere,
  onRestore,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNewHere: () => void;
  onRestore: (start?: RestoreStart) => void;
}) {
  const { cancelChoice } = useBooks();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) cancelChoice();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100%-2rem)] max-w-sm overflow-y-auto p-5 sm:p-6" aria-labelledby="login-title">
        <DialogClose
          aria-label="Close"
          className="absolute right-2 top-2 grid size-11 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X aria-hidden className="size-4" />
        </DialogClose>
        {open && <LoginForm onNewHere={onNewHere} onRestore={onRestore} />}
      </DialogContent>
    </Dialog>
  );
}

function LoginForm({ onNewHere, onRestore }: { onNewHere: () => void; onRestore: (start?: RestoreStart) => void }) {
  const { unlock, unlockLegacy, recover, chooseAccount, cancelChoice, legacyAvailable } = useBooks();
  const [legacy, setLegacy] = useState(false);
  // A forgotten passphrase: the username, the recovery key and a new passphrase.
  const [recovering, setRecovering] = useState(false);
  const [code, setCode] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [username, setUsername] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [stay, setStay] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [choices, setChoices] = useState<Role[] | null>(null);
  const usernameRef = useRef<HTMLInputElement>(null);
  const passphraseRef = useRef<HTMLInputElement>(null);

  // Focus the first field once the dialog has opened (it opens just after this mounts). Only here,
  // never on the page behind.
  useEffect(() => {
    if (choices) return;
    const t = setTimeout(() => (legacy ? passphraseRef.current : usernameRef.current)?.focus(), 0);
    return () => clearTimeout(t);
  }, [legacy, choices]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (legacy) {
        await unlockLegacy(passphrase, stay);
        return;
      }
      const outcome = recovering ? await recover(username, code, next, stay) : await unlock(username, passphrase, stay);
      if (!outcome.opened) {
        setChoices(outcome.choices);
        setPassphrase("");
        setCode("");
        setNext("");
        setConfirm("");
        setBusy(false);
      }
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  async function choose(role: Role) {
    setBusy(true);
    setError(null);
    try {
      await chooseAccount(role);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  if (choices) {
    return (
      <div className="flex flex-col gap-5">
        <DialogHeader className="pr-10 text-left">
          <DialogTitle id="login-title">Which would you like to open?</DialogTitle>
          <DialogDescription>{recovering ? "That recovery key set the new passphrase on each." : "That username and passphrase open more than one account."}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {choices.includes("business") && (
            <Button className="h-12 justify-start gap-3 px-4" disabled={busy} onClick={() => void choose("business")}>
              <Briefcase aria-hidden />
              Open your business books
            </Button>
          )}
          {choices.includes("worker") && (
            <Button className="h-12 justify-start gap-3 px-4" variant="outline" disabled={busy} onClick={() => void choose("worker")}>
              <HardHat aria-hidden />
              Open your worker account
            </Button>
          )}
          {choices.includes("customer") && (
            <Button className="h-12 justify-start gap-3 px-4" variant="outline" disabled={busy} onClick={() => void choose("customer")}>
              <Handshake aria-hidden />
              Open your customer account
            </Button>
          )}
        </div>
        <FormError message={error} />
        <button
          type="button"
          className={linkClass}
          onClick={() => {
            cancelChoice();
            setChoices(null);
          }}
        >
          Back
        </button>
      </div>
    );
  }

  if (recovering) {
    const ready = username.trim() !== "" && code.trim() !== "" && newPassphraseReady(next, confirm, username.trim().toLowerCase());
    return (
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && ready) void submit();
        }}
      >
        <DialogHeader className="pr-10 text-left">
          <DialogTitle id="login-title">Forgot your passphrase?</DialogTitle>
          <DialogDescription>
            Your recovery key sets a new passphrase for your books on this device. Lost books on another device? Restore a backup file with it instead.
          </DialogDescription>
        </DialogHeader>
        <Field label="Username">
          <input
            ref={usernameRef}
            className={inputClass}
            type="text"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={254}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </Field>
        <Field label="Recovery key" hint="28 letters and numbers, as you wrote it down. Dashes and spaces don't matter.">
          <input
            className={`${inputClass} font-mono text-sm uppercase`}
            type="text"
            name="recovery-key"
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={40}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </Field>
        <NewPassphraseFields username={username.trim().toLowerCase()} passphrase={next} onPassphrase={setNext} confirm={confirm} onConfirm={setConfirm} />
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input type="checkbox" className="size-5 shrink-0 accent-primary" checked={stay} onChange={(e) => setStay(e.target.checked)} />
          <span>Stay logged in on this device for 24 hours</span>
        </label>
        <FormError message={error} />
        <Button type="submit" className="h-11" disabled={busy || !ready}>
          {busy ? "Checking…" : "Set the new passphrase and log in"}
        </Button>
        <div className="flex flex-col items-center">
          <button
            type="button"
            className={linkClass}
            onClick={() => {
              setRecovering(false);
              setError(null);
            }}
          >
            Back to Log in
          </button>
          <button type="button" className={linkClass} onClick={() => onRestore()}>
            Restore from a backup file
          </button>
        </div>
      </form>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy && passphrase && (legacy || username.trim())) void submit();
      }}
    >
      <DialogHeader className="pr-10 text-left">
        <DialogTitle id="login-title">Log in</DialogTitle>
        <DialogDescription>
          {legacy
            ? "These books were made before accounts, so the passphrase alone opens them."
            : "Your username and passphrase open your books on this device. If you made your account with an email, that's your username."}
        </DialogDescription>
      </DialogHeader>

      {!legacy && (
        <Field label="Username">
          <input
            ref={usernameRef}
            className={inputClass}
            type="text"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={254}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </Field>
      )}
      <Field label="Passphrase">
        <PassphraseInput value={passphrase} onChange={setPassphrase} inputRef={passphraseRef} />
      </Field>

      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input type="checkbox" className="size-5 shrink-0 accent-primary" checked={stay} onChange={(e) => setStay(e.target.checked)} />
        <span>
          Stay logged in on this device for 24 hours
          <span className="block text-xs text-muted-foreground">Until you log out. Leave it off on a shared device.</span>
        </span>
      </label>

      <FormError message={error} />
      <Button type="submit" className="h-11" disabled={busy || !passphrase || (!legacy && !username.trim())}>
        {busy ? "Opening…" : "Log in"}
      </Button>

      <div className="flex flex-col items-center">
        {legacy ? (
          <button type="button" className={linkClass} onClick={() => setLegacy(false)}>
            Log in with a username instead
          </button>
        ) : (
          <>
            <button
              type="button"
              className={linkClass}
              onClick={() => {
                setRecovering(true);
                setError(null);
              }}
            >
              Forgot your passphrase? Use your recovery key
            </button>
            <button type="button" className={linkClass} onClick={() => onRestore({ from: "account", username })}>
              Books gone from this device? Find them with Shield
            </button>
            <button type="button" className={linkClass} onClick={() => onRestore()}>
              Restore from a backup file
            </button>
            <button type="button" className={linkClass} onClick={onNewHere}>
              New here? Create an account
            </button>
            {legacyAvailable && (
              <button
                type="button"
                className={linkClass}
                onClick={() => {
                  setLegacy(true);
                  setError(null);
                }}
              >
                Open books created before accounts
              </button>
            )}
          </>
        )}
      </div>
    </form>
  );
}
