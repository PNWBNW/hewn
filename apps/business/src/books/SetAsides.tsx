"use client";

// ---------------------------------------------------------------------------
// The dashboard's set-asides card: General (free to spend, after the taxes
// owed, which are set aside on their own) and each set-aside in the Shield
// account, with ways to make one, move money into or out of it,
// rename it, choose the vendors it pays, and close it (books/funds.ts). Every
// change is a book entry; no money moves in the Shield account.
// ---------------------------------------------------------------------------

import { drawingStep } from "./drawing_step";
import { useState } from "react";
import { formatCents, parseCents } from "@pnw/ledger";
import { Button } from "@pnw/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@pnw/ui/card";
import { cn } from "@pnw/ui/utils";
import { FormError, errorMessage, inputClass } from "./AuthCard";
import { useOpenBooks } from "./BooksProvider";
import { Money, todayIso } from "./display";
import { type FundView, GENERAL, closeFund, createFund, freeToSpend, fundBalances, moveFund, updateFund } from "./funds";

export function SetAsides() {
  const { books, funds, sales } = useOpenBooks();
  drawingStep("the set-asides");
  const view = fundBalances({ books, funds: funds ?? undefined });
  const free = freeToSpend({ books, funds: funds ?? undefined }, 0n);
  const [open, setOpen] = useState<string | null>(null); // a fund id, or "new"
  const vendorName = new Map(sales.vendors.map((v) => [v.id, v.name]));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Set-asides</CardTitle>
        <p className="text-sm text-muted-foreground">
          Earmark money in your Shield account for something. No money moves: the books keep it apart, and payments come out of General
          unless you pick a set-aside.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="divide-y rounded-md border text-sm">
          <li className="flex items-center gap-3 px-3 py-2">
            <span className="flex-1">
              <span className="font-medium">{GENERAL}</span>
              <span className="block text-xs text-muted-foreground">Free to spend{free.taxes > 0n ? ", after taxes owed" : ""}</span>
            </span>
            <Money cents={free.cents} className={cn("font-semibold", free.cents < 0n && "text-money-negative")} />
          </li>
          {free.taxes > 0n && (
            <li className="flex items-center gap-3 px-3 py-2">
              <span className="flex-1">
                <span className="font-medium">Taxes owed</span>
                <span className="block text-xs text-muted-foreground">Set aside on their own until they&apos;re paid: sales tax and payroll taxes</span>
              </span>
              <Money cents={free.taxes} className="font-semibold" />
            </li>
          )}
          {view.funds.map((f) => (
            <li key={f.accountId} className="flex flex-col gap-2 px-3 py-2">
              <div className="flex items-center gap-3">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{f.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {f.vendorIds.length > 0 ? `Pays ${f.vendorIds.map((id) => vendorName.get(id) ?? "a vendor").join(", ")}` : "Pays only when you pick it"}
                  </span>
                </span>
                <Money cents={f.cents} className="font-semibold" />
                {open !== f.accountId && (
                  <Button variant="link" size="sm" className="h-auto min-h-11 p-0 sm:min-h-0" onClick={() => setOpen(f.accountId)}>
                    Manage
                  </Button>
                )}
              </div>
              {open === f.accountId && <ManageFund fund={f} general={view.general} onDone={() => setOpen(null)} />}
            </li>
          ))}
          <li className="flex items-center gap-3 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <span className="flex-1">Total in the Shield account</span>
            <Money cents={view.total} />
          </li>
        </ul>
        {open === "new" ? (
          <NewFund general={view.general} onDone={() => setOpen(null)} />
        ) : (
          <Button variant="outline" className="min-h-11 self-start sm:min-h-9" onClick={() => setOpen("new")}>
            New set-aside
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/** Checkboxes for the vendors a set-aside pays. */
function VendorPicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const { sales } = useOpenBooks();
  const vendors = sales.vendors.filter((v) => v.active || value.includes(v.id));
  if (vendors.length === 0) return <p className="text-xs text-muted-foreground">Add vendors under Expenses to have a set-aside pay them by default.</p>;
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-xs font-medium">Pays these vendors by default</legend>
      {vendors.map((v) => (
        <label key={v.id} className="flex min-h-11 items-center gap-3 text-sm sm:min-h-8">
          <input
            type="checkbox"
            className="size-5 accent-primary"
            checked={value.includes(v.id)}
            onChange={(e) => onChange(e.target.checked ? [...value, v.id] : value.filter((id) => id !== v.id))}
          />
          {v.name}
        </label>
      ))}
    </fieldset>
  );
}

function NewFund({ general, onDone }: { general: bigint; onDone: () => void }) {
  const { updateCompany } = useOpenBooks();
  const [name, setName] = useState("");
  const [vendorIds, setVendorIds] = useState<string[]>([]);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const cents = amount.trim() ? parseCents(amount) : 0n;
      await updateCompany((c) => {
        const made = createFund(c, { name, vendorIds });
        return cents > 0n ? moveFund(made.company, { accountId: made.accountId, cents, direction: "into", date: todayIso() }) : made.company;
      });
      onDone();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-dashed p-3">
      <input aria-label="Name" className={inputClass} placeholder="Name, like Equipment fund" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
      <input
        aria-label="Amount to set aside now"
        className={inputClass}
        inputMode="decimal"
        placeholder={`Amount to set aside now (optional, up to ${formatCents(general)})`}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <VendorPicker value={vendorIds} onChange={setVendorIds} />
      <FormError message={error} />
      <div className="flex flex-wrap gap-3">
        <Button className="min-h-11 sm:min-h-9" disabled={busy || !name.trim()} onClick={() => void save()}>
          Make set-aside
        </Button>
        <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function ManageFund({ fund, general, onDone }: { fund: FundView; general: bigint; onDone: () => void }) {
  const { updateCompany } = useOpenBooks();
  const [direction, setDirection] = useState<"into" | "out">("into");
  const [amount, setAmount] = useState("");
  const [name, setName] = useState(fund.name);
  const [vendorIds, setVendorIds] = useState(fund.vendorIds);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(op: Parameters<typeof updateCompany>[0]) {
    setBusy(true);
    setError(null);
    try {
      await updateCompany(op);
      onDone();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  const changed = name.trim() !== fund.name || vendorIds.join() !== fund.vendorIds.join();

  return (
    <div className="flex flex-col gap-3 rounded-md border border-dashed p-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Move money">
        {(
          [
            ["into", `Set aside (from ${GENERAL})`],
            ["out", `Release (back to ${GENERAL})`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={direction === id}
            onClick={() => setDirection(id)}
            className={cn("min-h-11 rounded-full border px-3 text-sm sm:min-h-9", direction === id ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent")}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        <input
          aria-label="Amount"
          className={cn(inputClass, "flex-1")}
          inputMode="decimal"
          placeholder={`Amount (up to ${formatCents(direction === "into" ? general : fund.cents)})`}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Button
          className="min-h-11 sm:min-h-9"
          disabled={busy || !amount.trim()}
          onClick={() => void run((c) => moveFund(c, { accountId: fund.accountId, cents: parseCents(amount), direction, date: todayIso() }))}
        >
          {direction === "into" ? "Set aside" : "Release"}
        </Button>
      </div>

      <input aria-label="Name" className={inputClass} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
      <VendorPicker value={vendorIds} onChange={setVendorIds} />
      <FormError message={error} />
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={busy || !changed} onClick={() => void run((c) => updateFund(c, fund.accountId, { name, vendorIds }))}>
          Save name and vendors
        </Button>
        <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={() => void run((c) => closeFund(c, fund.accountId, todayIso()))}>
          Close set-aside
        </Button>
        <Button variant="ghost" className="min-h-11 sm:min-h-9" disabled={busy} onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}
