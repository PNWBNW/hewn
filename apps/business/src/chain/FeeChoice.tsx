"use client";

// ---------------------------------------------------------------------------
// The fee choice next to a send button (Joshua, 2026-10-16): pay this send's
// network fee privately (from private ALEO; the network can't see who sent
// it) or publicly (from the public balance; the fee names this account). It
// starts from the device's switch on the dashboard and only changes this
// send. The choice travels with the call (`feeMode`, chain/shield.ts).
// ---------------------------------------------------------------------------

import type { FeeMode } from "@pnw/wallet/fee-mode";
import { cn } from "@pnw/ui/utils";

export function FeeChoice({ value, onChange, disabled }: { value: FeeMode; onChange: (mode: FeeMode) => void; disabled?: boolean }) {
  const option = (mode: FeeMode, label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={value === mode}
      disabled={disabled}
      onClick={() => onChange(mode)}
      className={cn(
        "min-h-11 flex-1 rounded-md px-3 text-sm font-medium sm:min-h-9",
        value === mode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent",
      )}
    >
      {label}
    </button>
  );
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">Network fee</span>
      <div role="radiogroup" aria-label="How to pay the network fee" className="flex gap-1 rounded-lg border bg-card p-1">
        {option("private", "Private")}
        {option("public", "Public")}
      </div>
      <span className="text-xs text-muted-foreground">
        {value === "private"
          ? "Paid from your private ALEO: the network can't see which account sent it. Needs some private ALEO in Shield."
          : "Paid from your public ALEO: the fee shows which account sent it (never what it says or who it's to)."}
      </span>
    </div>
  );
}
