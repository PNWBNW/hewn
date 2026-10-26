"use client";

// ---------------------------------------------------------------------------
// The business's view key (books/view_key.ts): entered in setup or Settings,
// checked on this device against the linked Shield account before it's kept,
// and forgotten on request. Skipping says what the books lose. The key is
// never shown back, sent or logged.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Button } from "@pnw/ui/button";
import { Field, FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import { shortAddress } from "@/books/rail";
import { cleanViewKey, forgetViewKey, setViewKey, skipViewKey } from "@/books/view_key";
import { viewKeyAccount } from "./decrypt";

const WITHOUT =
  "Without it, For review can't read private payments from people you aren't connected with: Shield shows them to you but won't open them for the books, and folds each into your balance within a minute. You'd record those by hand.";

export default function ViewKeyPanel({ setup, onClose }: { setup?: boolean; onClose?: () => void }) {
  const { rail, viewKey, viewKeyChoice, updateCompany } = useOpenBooks();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!rail) return null;

  async function keep() {
    setBusy(true);
    setError(null);
    try {
      const key = cleanViewKey(text);
      let account: string;
      try {
        account = await viewKeyAccount(key);
      } catch {
        throw new Error("That isn't a view key. It starts with AViewKey1; copy it from Shield's settings.");
      }
      if (account !== rail!.address) throw new Error(`That view key is for another account (${shortAddress(account)}), not the linked one (${shortAddress(rail!.address)}).`);
      await updateCompany((c) => setViewKey(c, key));
      setText("");
      onClose?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function choose(change: typeof skipViewKey) {
    setBusy(true);
    setError(null);
    try {
      await updateCompany(change);
      setSkipping(false);
      onClose?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (viewKey && !setup) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm">The books read private payments into {shortAddress(rail.address)} with its view key, kept encrypted on this device.</p>
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={() => void choose(forgetViewKey)}>
            Forget the view key
          </Button>
          {onClose && (
            <Button variant="ghost" className="min-h-11 sm:min-h-9" disabled={busy} onClick={onClose}>
              Close
            </Button>
          )}
        </div>
        <FormError message={error} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        A view key lets the books see each payment into and out of your Shield account, one by one, the way a bank feed does. It can only read: it
        can&apos;t spend, sign or move anything. It stays encrypted in your books on this device and is never sent anywhere. Find it in Shield&apos;s
        settings (export or show view key).
        {!setup && viewKeyChoice === "added" ? " The books had one before; a restore leaves it out, so enter it again." : ""}
      </p>
      <Field label="View key" hint={`Checked against your linked account, ${shortAddress(rail.address)}, before it's kept.`}>
        <input
          className={inputClass}
          type="password"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="AViewKey1…"
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
        />
      </Field>
      {skipping ? (
        <div className="flex flex-col gap-3 rounded-md border border-dashed p-3">
          <p className="text-sm">{WITHOUT}</p>
          <p className="text-xs text-muted-foreground">You can add it any time in Settings, under Private payments.</p>
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={() => void choose(skipViewKey)}>
              Go on without it
            </Button>
            <Button variant="ghost" className="min-h-11 sm:min-h-9" disabled={busy} onClick={() => setSkipping(false)}>
              Back
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          <Button className="min-h-11 sm:min-h-9" disabled={busy || !text.trim()} onClick={() => void keep()}>
            {busy ? "Checking…" : "Check and keep it"}
          </Button>
          {setup ? (
            <Button variant="ghost" className="min-h-11 sm:min-h-9" disabled={busy} onClick={() => setSkipping(true)}>
              Skip for now
            </Button>
          ) : (
            onClose && (
              <Button variant="ghost" className="min-h-11 sm:min-h-9" disabled={busy} onClick={onClose}>
                Cancel
              </Button>
            )
          )}
        </div>
      )}
      <FormError message={error} />
    </div>
  );
}
