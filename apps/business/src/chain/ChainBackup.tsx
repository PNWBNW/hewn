"use client";

// ---------------------------------------------------------------------------
// "Back up with your account": the books as letters to this account's own
// account (docs/CHAIN_BACKUP.md; chain/books_backup.ts). It works inside
// Shield's own browser, where a backup file can't be saved.
//
// One tap works out the next backup (the changes since the last, or a full
// copy), shows what it costs before anything is signed (Joshua, 2026-10-26),
// then sends each page as a letter, one Shield approval each. The vault
// records the backup only once every page is in; a backup cut off partway
// leaves the vault as it was, and the next try starts a fresh copy rather
// than reuse a half-filled place.
//
// Nothing here logs a key, a lookup, an address or a letter.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { CloudUpload } from "lucide-react";
import { Button } from "@pnw/ui/button";
import { type FeeMode, readFeeMode } from "@pnw/wallet/fee-mode";
import { AleoWalletProviderWrapper } from "@pnw/wallet/wallet-provider";
import { FormError, errorMessage } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import { markBackedUp } from "@/books/backup_reminder";
import { shortAddress } from "@/books/rail";
import { type BackupPlan, planBackup } from "./books_backup";
import { useLetters } from "./letter_reader";
import { LetterBox } from "./letters";

export default function ChainBackup() {
  return (
    <AleoWalletProviderWrapper>
      <Backup />
    </AleoWalletProviderWrapper>
  );
}

/** What the plan costs, in words: "1 letter", "2 pages", with the approvals and the fee. */
export function costLine(plan: Pick<BackupPlan, "letters" | "fullPages" | "fee" | "pages">): string {
  const parts = [plan.letters ? `${plan.letters} ${plan.letters === 1 ? "letter" : "letters"}` : "", plan.fullPages ? `${plan.fullPages} ${plan.fullPages === 1 ? "page" : "pages"}` : ""].filter(Boolean);
  const approvals = plan.pages.length;
  return `${parts.join(" and ")}, ${approvals} ${approvals === 1 ? "approval" : "approvals"} in Shield, about ${plan.fee} ALEO in fees (none when Shield's sponsor pays)`;
}

/**
 * The note for backing up on testnet with private fees on (Joshua, 2026-10-27): Shield's sponsor pays
 * every fee there, and asking it for a private one stops the backup before it's sent. Null otherwise.
 */
export function privateFeeNote(network: string, feeMode: FeeMode): string | null {
  if (network !== "testnet" || feeMode !== "private") return null;
  return "On testnet Shield covers the network fee, and a backup won't go through while \"Pay network fees privately\" is on. Turn it off on the Dashboard (Shield account card) before backing up.";
}

type Step = { kind: "idle" } | { kind: "planning" } | { kind: "ready"; plan: BackupPlan } | { kind: "sending"; plan: BackupPlan; sent: number } | { kind: "done"; what: string };

function Backup() {
  const { rail, username, backupSealer, currentCompany, updateCompany } = useOpenBooks();
  const { state, connect, address, mismatch, letters, wallet } = useLetters();
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  if (!rail) return null;

  async function plan() {
    setError(null);
    setStep({ kind: "planning" });
    try {
      const sealer = backupSealer();
      const company = currentCompany();
      if (!sealer || !company || !letters || !address) throw new Error("Open your books and connect Shield first");
      letters.refresh();
      const taken = async (lookup: string) => (await letters.getAll(lookup)).some((r) => r.sender === address);
      const p = await planBackup({ sealer, company, username: username ?? "", address, state: company.chainBackup ?? null, taken });
      if (!p) {
        // Nothing changed since the last backup kept with the account: it still covers everything.
        await updateCompany((c) => markBackedUp(c));
        setStep({ kind: "done", what: "Nothing has changed since your last backup, so it's up to date." });
        return;
      }
      setStep({ kind: "ready", plan: p });
    } catch (e) {
      setError(errorMessage(e));
      setStep({ kind: "idle" });
    }
  }

  async function send(p: BackupPlan) {
    if (!address) return;
    setError(null);
    const box = new LetterBox({ wallet, to: address });
    const feeMode = readFeeMode();
    let sent = 0;
    try {
      for (const page of p.pages) {
        setStep({ kind: "sending", plan: p, sent });
        await box.put(page.lookup, page.envelope, { feeMode });
        sent++;
      }
      await updateCompany((c) => ({ ...markBackedUp(c), chainBackup: p.next }));
      setStep({ kind: "done", what: p.kind === "snapshot" ? "Your books are backed up with your account." : "The changes since your last backup are saved with your account." });
    } catch (e) {
      setError(
        sent > 0
          ? `The backup stopped after ${sent} of ${p.pages.length}: ${errorMessage(e)}. Nothing is recorded yet; trying again starts a fresh copy.`
          : errorMessage(e),
      );
      setStep({ kind: "idle" });
    }
  }

  let body;
  if (mismatch && address) {
    body = <p className="text-xs text-muted-foreground">Shield is signed in to {shortAddress(address)}. Switch to {shortAddress(rail.address)} in Shield to back up with your account.</p>;
  } else if (state.kind === "missing") {
    body = <p className="text-xs text-muted-foreground">Open this page in the Shield app, or with the Shield extension, to back up with your account.</p>;
  } else if (!letters) {
    body = (
      <Button variant="outline" className="min-h-11 self-start sm:min-h-9" disabled={state.kind === "connecting"} onClick={connect}>
        {state.kind === "connecting" ? "Connecting…" : "Connect Shield to back up"}
      </Button>
    );
  } else if (step.kind === "ready") {
    body = (
      <div className="flex flex-col gap-2 rounded-md border border-dashed p-3">
        <p className="text-sm">
          {step.plan.kind === "snapshot" ? "A full copy of your books" : "The changes since your last backup"}: {costLine(step.plan)}.
        </p>
        <p className="text-xs text-muted-foreground">Sealed so only your username with your passphrase, or your recovery key, opens it. Nobody else can read it.</p>
        <div className="flex flex-wrap gap-3">
          <Button className="min-h-11 sm:min-h-9" onClick={() => void send(step.plan)}>
            Back up now
          </Button>
          <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={() => setStep({ kind: "idle" })}>
            Cancel
          </Button>
        </div>
      </div>
    );
  } else if (step.kind === "sending") {
    body = (
      <p className="text-sm" role="status">
        Sending {step.sent + 1} of {step.plan.pages.length}… approve it in Shield.
      </p>
    );
  } else {
    body = (
      <>
        {step.kind === "done" && <p className="text-sm text-money-positive">{step.what}</p>}
        <Button className="min-h-11 self-start sm:min-h-9" disabled={step.kind === "planning"} onClick={() => void plan()}>
          <CloudUpload aria-hidden className="size-4" />
          {step.kind === "planning" ? "Working it out…" : "Back up with your account"}
        </Button>
      </>
    );
  }

  const note = privateFeeNote(rail.network, readFeeMode());
  return (
    <div className="flex flex-col gap-2">
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      {body}
      <FormError message={error} />
    </div>
  );
}
