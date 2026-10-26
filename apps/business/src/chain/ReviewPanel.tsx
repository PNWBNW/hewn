"use client";

// ---------------------------------------------------------------------------
// Transactions → For review: money that moved in the Shield account, in plain
// words ("Sent 4.625 USDCx to PNW DAO"), each waiting to be said what it was.
// Accept posts it (books/review.ts); Exclude keeps it out. Opening the tab
// checks Shield for anything new (review_feed.ts), once Shield is connected.
//
// Names come from the business's own customers, vendors and team first, then
// from the registry (name.hewn), else a short account. Nothing is logged.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { ENV } from "@pnw/config/env";
import { type Account, type Books, baseOf, formatCents } from "@pnw/ledger";
import { RAIL_ACCOUNT_NAME, findRailAccount } from "@pnw/payroll";
import { Button } from "@pnw/ui/button";
import { cn } from "@pnw/ui/utils";
import { AleoWalletProviderWrapper } from "@pnw/wallet/wallet-provider";
import { FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import { AccountSelect, Money, todayIso } from "@/books/display";
import { GENERAL, defaultSource, fundBalances, isShieldFamily } from "@/books/funds";
import { minorToCents } from "@/books/opening";
import { shortAddress } from "@/books/rail";
import {
  type AcceptInput,
  type ReviewItem,
  NETWORK_FEES,
  acceptItem,
  addReviewItems,
  byNewest,
  changeItem,
  choicesOf,
  ensureNetworkFees,
  excludeItem,
  knownIds,
  undoReview,
} from "@/books/review";
import { BRAND } from "@/brand";
import { longDate } from "./agreement_draft";
import { formatSixDecimals } from "./balances";
import { decryptTransition, fetchExplorerTransaction } from "./decrypt";
import { entryLabel, lookupAddress } from "./directory";
import { findMovements } from "./review_feed";
import { useShield } from "./shield";
import { ShieldAway } from "./ShieldStatus";

export default function ReviewPanel() {
  return (
    <AleoWalletProviderWrapper>
      <ReviewFlow />
    </AleoWalletProviderWrapper>
  );
}

type Check = { state: "idle" } | { state: "running" } | { state: "done"; found: number; unread: number } | { state: "failed"; message: string };
type Tab = "new" | "reviewed" | "excluded";

function ReviewFlow() {
  const { rail, review, sales, payroll, updateCompany } = useOpenBooks();
  const { state, away, connect, error: connectError, wallet } = useShield();
  const [check, setCheck] = useState<Check>({ state: "idle" });
  const [tab, setTab] = useState<Tab>("new");
  const [names, setNames] = useState<Record<string, string>>({});
  const ran = useRef<string | null>(null);

  const address = state.kind === "connected" ? state.address : null;
  const mismatch = address !== null && rail !== null && address !== rail.address;
  const items = useMemo(() => byNewest(review?.items ?? []), [review]);
  const waiting = items.filter((i) => i.status === "new");
  const reviewed = items.filter((i) => i.status === "accepted" || i.status === "recorded" || i.status === "internal");
  const excluded = items.filter((i) => i.status === "excluded");

  // Who's on the other side: the business's own people first.
  const known = useMemo(() => {
    const map = new Map<string, string>();
    const customers = new Map(sales.customers.map((c) => [c.id, c.name]));
    const vendors = new Map(sales.vendors.map((v) => [v.id, v.name]));
    const workers = new Map(payroll.workers.map((w) => [w.id, w.name]));
    for (const p of rail?.partyLinks ?? []) {
      const name = p.kind === "customer" ? customers.get(p.id) : p.kind === "vendor" ? vendors.get(p.id) : workers.get(p.id);
      if (p.address && name) map.set(p.address, name);
    }
    for (const l of rail?.links ?? []) {
      const name = workers.get(l.workerId);
      if (name) map.set(l.address, name);
    }
    return map;
  }, [rail, sales, payroll]);

  const run = useCallback(async () => {
    if (!rail || !address || mismatch) return;
    setCheck({ state: "running" });
    try {
      const result = await findMovements({
        me: rail.address,
        start: rail.start ?? null,
        known: knownIds(review),
        deps: {
          wallet: {
            requestRecords: (p, all) => wallet.requestRecords(p, all),
            requestTransactionHistory: (p) => wallet.requestTransactionHistory(p),
            transitionViewKeys: (id) => wallet.transitionViewKeys(id),
            decryptRecord: (c) => wallet.decrypt(c),
          },
          fetchTransaction: (id) => fetchExplorerTransaction(id, ENV.ALEO_ENDPOINT),
          decrypt: decryptTransition,
        },
      });
      if (result.items.length > 0) await updateCompany((c) => addReviewItems(c, result.items));
      setCheck({ state: "done", found: result.items.filter((i) => i.status === "new").length, unread: result.unread });
    } catch (e) {
      setCheck({ state: "failed", message: errorMessage(e) });
    }
    // `wallet` changes identity every render; the account and the list are what matter.
  }, [rail, address, mismatch, review, updateCompany]);

  // Check once when the tab opens with Shield connected to the linked account.
  useEffect(() => {
    if (!address || mismatch || !rail || ran.current === address) return;
    ran.current = address;
    void run();
  }, [address, mismatch, rail, run]);

  // Registry names for accounts the business doesn't know yet.
  useEffect(() => {
    const unknown = [...new Set(items.map((i) => i.counterparty).filter((a): a is string => !!a && !known.has(a) && !(a in names)))];
    if (unknown.length === 0) return;
    let live = true;
    void Promise.all(
      unknown.map(async (a) => {
        try {
          return [a, entryLabel(await lookupAddress(a), BRAND.nameSuffix)] as const;
        } catch {
          return [a, ""] as const;
        }
      }),
    ).then((found) => live && setNames((n) => ({ ...n, ...Object.fromEntries(found) })));
    return () => {
      live = false;
    };
  }, [items, known, names]);

  const nameOf = (a: string | undefined) => (a ? (known.get(a) ?? (names[a] || shortAddress(a))) : null);

  if (!rail) {
    return (
      <div className="rounded-lg border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
        Link your Shield account in Settings, and every payment in or out of it comes in here to review.
        <Link href="/settings" className="mt-2 block font-medium text-primary underline-offset-4 hover:underline">
          Go to Settings
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          {mismatch
            ? `Shield is signed in to a different account (${shortAddress(address!)}). Switch to ${shortAddress(rail.address)} to check for new money.`
            : !address
              ? state.kind === "missing"
                ? "Open this page in the Shield app to check for new money."
                : state.kind === "connecting"
                  ? "Connecting… approve the request in Shield."
                  : "Connect Shield to check for new money in the account."
              : check.state === "running"
                ? "Checking Shield for new money…"
                : check.state === "failed"
                  ? `Couldn't check: ${check.message}`
                  : check.state === "done"
                    ? `${check.found === 0 ? "Nothing new" : `${check.found} new`}${check.unread > 0 ? `; ${check.unread} couldn't be read yet and will be tried next time` : ""}.`
                    : rail.start
                      ? `Every movement since ${longDate(rail.start.date)}; earlier ones are in your opening balance.`
                      : "Every movement in and out of your Shield account."}
        </p>
        {!address && state.kind === "ready" ? (
          <Button className="min-h-11 sm:min-h-9" onClick={connect}>
            Connect Shield
          </Button>
        ) : address && !mismatch ? (
          <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={check.state === "running"} onClick={() => void run()}>
            <RefreshCw aria-hidden className={cn(check.state === "running" && "animate-spin")} />
            Check now
          </Button>
        ) : null}
      </div>
      <FormError message={connectError} />
      {away ? <ShieldAway what="the check" /> : null}

      <div role="tablist" aria-label="Review" className="flex gap-2">
        {(
          [
            ["new", `To review (${waiting.length})`],
            ["reviewed", `Reviewed (${reviewed.length})`],
            ["excluded", `Excluded (${excluded.length})`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn("min-h-11 rounded-md border px-3 text-sm sm:min-h-9", tab === id ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent")}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "new" &&
        (waiting.length === 0 ? (
          <Empty text="Nothing waiting. New money in or out of the Shield account shows up here." />
        ) : (
          <ul className="flex flex-col gap-3">
            {waiting.map((item) => (
              <li key={item.id}>
                <ReviewCard item={item} who={nameOf(item.counterparty)} knownName={item.counterparty ? known.get(item.counterparty) : undefined} />
              </li>
            ))}
          </ul>
        ))}
      {tab === "reviewed" &&
        (reviewed.length === 0 ? <Empty text="Nothing reviewed yet." /> : <DoneList items={reviewed} nameOf={nameOf} />)}
      {tab === "excluded" && (excluded.length === 0 ? <Empty text="Nothing excluded." /> : <DoneList items={excluded} nameOf={nameOf} />)}
    </div>
  );
}

const Empty = ({ text }: { text: string }) => <div className="rounded-lg border bg-card px-6 py-10 text-center text-sm text-muted-foreground">{text}</div>;

/** "Sent 4.625 USDCx to PNW DAO", "Received 4.25 USDCx from Employer 1", "Received 20 USDCx (minted)". */
function sentence(item: ReviewItem, who: string | null): string {
  const amount = `${formatSixDecimals(BigInt(item.minor))} USDCx`;
  if (item.status === "internal") return `Moved ${amount} within your Shield account`;
  if (item.direction === "in") return who ? `Received ${amount} from ${who}` : item.kind.startsWith("mint") ? `Received ${amount} (minted)` : `Received ${amount}`;
  return who ? `Sent ${amount} to ${who}` : `Sent ${amount}`;
}

type Kind = "income" | "expense" | "owner" | "swap" | "other";

const CHOICES: Record<ReviewItem["direction"], { id: Kind; label: string }[]> = {
  in: [
    { id: "income", label: "Customer payment" },
    { id: "owner", label: "Owner money in" },
    { id: "swap", label: "Swap from ALEO" },
    { id: "other", label: "Other" },
  ],
  out: [
    { id: "expense", label: "Expense or vendor" },
    { id: "owner", label: "Owner money out" },
    { id: "swap", label: "Swap to ALEO" },
    { id: "other", label: "Other" },
  ],
};

/** Which accounts each choice offers. */
function filterFor(kind: Kind, shieldId: string | undefined): (a: Account) => boolean {
  const notShield = (a: Account) => a.active && a.id !== shieldId;
  if (kind === "income") return (a) => notShield(a) && baseOf(a) === "income";
  if (kind === "expense") return (a) => notShield(a) && baseOf(a) === "expense";
  if (kind === "owner") return (a) => notShield(a) && baseOf(a) === "equity" && !a.system;
  return notShield;
}

/** A sensible first pick: the owner's investment or draw account by name, else the first that fits. */
function defaultAccount(books: Books, kind: Kind, direction: ReviewItem["direction"], shieldId: string | undefined): string {
  const fits = books.accounts.filter(filterFor(kind, shieldId));
  if (kind === "owner") {
    const word = direction === "in" ? /invest|contribut|capital/i : /draw|distribut/i;
    return (fits.find((a) => word.test(a.name)) ?? fits[0])?.id ?? "";
  }
  // Income has an obvious first pick; an expense category is the business's call, so none is chosen for it.
  if (kind !== "income") return "";
  return fits[0]?.id ?? "";
}

/** Which "What was this?" choice an earlier posting to `accountId` was. */
function kindOf(books: Books, accountId: string): Kind {
  const account = books.accounts.find((a) => a.id === accountId);
  if (!account) return "other";
  if (account.name.trim().toLowerCase() === NETWORK_FEES.toLowerCase()) return "swap";
  const base = baseOf(account);
  return base === "income" ? "income" : base === "expense" ? "expense" : base === "equity" && !account.system ? "owner" : "other";
}

function ReviewCard({
  item,
  who,
  knownName,
  editing,
  onDone,
}: {
  item: ReviewItem;
  who: string | null;
  knownName?: string;
  /** Set when correcting an accepted item: its earlier choices, and what to do when saved or cancelled. */
  editing?: AcceptInput;
  onDone?: () => void;
}) {
  const { books, sales, dimensions, rail, funds, updateCompany } = useOpenBooks();
  const shieldId = findRailAccount(books)?.id;
  const fundView = fundBalances({ books, funds: funds ?? undefined });
  const startKind: Kind = editing ? kindOf(books, editing.accountId) : item.direction === "in" ? "income" : "expense";
  const [kind, setKind] = useState<Kind>(startKind);
  const [accountId, setAccountId] = useState(() => editing?.accountId ?? defaultAccount(books, startKind, item.direction, shieldId));
  const parties = item.direction === "in" ? sales.customers : sales.vendors;
  const linked = rail?.partyLinks?.find((p) => p.address === item.counterparty && p.kind === (item.direction === "in" ? "customer" : "vendor"));
  const [partyId, setPartyId] = useState(editing ? (editing.name?.id ?? "") : (linked?.id ?? ""));
  const [projectId, setProjectId] = useState(editing?.tags?.project ?? "");
  // Which part of the Shield account: a vendor's payment defaults to the set-aside that pays it.
  const sourceFor = (vendor: string) => (item.direction === "out" ? defaultSource({ books, funds: funds ?? undefined }, vendor || undefined) : shieldId) ?? "";
  const [side, setSide] = useState(() => editing?.shieldAccountId ?? (editing ? (shieldId ?? "") : sourceFor(linked?.id ?? "")));
  const [sidePicked, setSidePicked] = useState(!!editing);
  const [memo, setMemo] = useState(editing?.memo ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cents = minorToCents(BigInt(item.minor));
  const dust = BigInt(item.minor) % 10_000n !== 0n;
  const projects = dimensions.projects.filter((p) => p.status === "active");

  function choose(next: Kind) {
    setKind(next);
    setAccountId(defaultAccount(books, next, item.direction, shieldId));
  }

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await updateCompany((c) => {
        let company = c;
        let target = accountId;
        if (kind === "swap") {
          const fees = ensureNetworkFees(c.books);
          company = { ...c, books: fees.books };
          target = fees.accountId;
        }
        if (!target) throw new Error("Choose an account");
        const input: AcceptInput = {
          accountId: target,
          ...(partyId && kind !== "swap" ? { name: { kind: item.direction === "in" ? "customer" : "vendor", id: partyId } } : {}),
          ...(projectId ? { tags: { project: projectId } } : {}),
          ...(side && side !== shieldId ? { shieldAccountId: side } : {}),
          memo: memo || (kind === "swap" ? (item.direction === "out" ? "Swap to ALEO (fee money)" : "Swap from ALEO") : knownName ? "" : who ? `${item.direction === "in" ? "From" : "To"} ${who}` : ""),
        };
        return editing ? changeItem(company, item.id, input, todayIso()) : acceptItem(company, item.id, input);
      });
      onDone?.();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  async function exclude() {
    setBusy(true);
    setError(null);
    try {
      await updateCompany((c) => excludeItem(c, item.id));
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      {!editing && (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="font-medium">{sentence(item, who)}</p>
            <span className={cn("text-sm font-semibold tabular-nums", item.direction === "in" ? "text-money-positive" : "text-money-negative")}>
              {item.direction === "in" ? "+" : "−"}
              <Money cents={cents} />
            </span>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">
            {longDate(item.date)}
            {item.counterparty && who !== shortAddress(item.counterparty) && <> · {shortAddress(item.counterparty)}</>}
            {dust && <> · goes in the books as <Money cents={cents} /> (a fraction of a cent isn&apos;t kept)</>}
          </p>
        </>
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">What was this?</legend>
        <div className="flex flex-wrap gap-2">
          {CHOICES[item.direction].map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={kind === c.id}
              onClick={() => choose(c.id)}
              className={cn("min-h-11 rounded-full border px-3 text-sm sm:min-h-9", kind === c.id ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent")}
            >
              {c.label}
            </button>
          ))}
        </div>
      </fieldset>

      {kind === "swap" ? (
        <p className="text-xs text-muted-foreground">
          {item.direction === "out"
            ? `Posted to ${NETWORK_FEES}: buying ALEO is buying fee money, so the cost counts when it's bought.`
            : `Reduces ${NETWORK_FEES}: the ALEO sold back was fee money.`}
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <AccountSelect
            books={books}
            value={accountId}
            onChange={setAccountId}
            filter={filterFor(kind, shieldId)}
            className={inputClass}
            ariaLabel="Account"
            placeholder={kind === "income" ? "Income account" : kind === "expense" ? "Expense account" : "Account"}
          />
          {(kind === "income" || kind === "expense") && parties.length > 0 && (
            <select
              aria-label={item.direction === "in" ? "Customer" : "Vendor"}
              className={inputClass}
              value={partyId}
              onChange={(e) => {
                setPartyId(e.target.value);
                if (!sidePicked) setSide(sourceFor(e.target.value));
              }}
            >
              <option value="">{item.direction === "in" ? "Customer (optional)" : "Vendor (optional)"}</option>
              {parties
                .filter((p) => p.active || p.id === partyId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          )}
        </div>
      )}

      {fundView.funds.length > 0 && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{item.direction === "out" ? "Paid from" : "Went into"}</span>
          <select
            className={inputClass}
            value={side}
            onChange={(e) => {
              setSide(e.target.value);
              setSidePicked(true);
            }}
          >
            <option value={shieldId}>
              {GENERAL} ({formatCents(fundView.general)})
            </option>
            {fundView.funds.map((f) => (
              <option key={f.accountId} value={f.accountId}>
                {f.name} ({formatCents(f.cents)})
              </option>
            ))}
          </select>
          {item.direction === "out" && !editing && cents > (side === shieldId ? fundView.general : (fundView.funds.find((f) => f.accountId === side)?.cents ?? 0n)) && (
            <span className="text-xs text-money-negative">This takes {side === shieldId ? GENERAL : fundView.funds.find((f) => f.accountId === side)?.name} below zero.</span>
          )}
        </label>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        {projects.length > 0 && (
          <select aria-label="Project" className={inputClass} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Project (optional)</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <input aria-label="Memo" className={inputClass} placeholder="Memo (optional)" value={memo} maxLength={200} onChange={(e) => setMemo(e.target.value)} />
      </div>

      <FormError message={error} />
      <div className="flex flex-wrap gap-3">
        <Button className="min-h-11 sm:min-h-9" disabled={busy || (kind !== "swap" && !accountId)} onClick={() => void accept()}>
          {editing ? "Save change" : "Accept"}
        </Button>
        {editing ? (
          <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={onDone}>
            Cancel
          </Button>
        ) : (
          <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={() => void exclude()}>
            Exclude
          </Button>
        )}
      </div>
    </div>
  );
}

function DoneList({ items, nameOf }: { items: ReviewItem[]; nameOf: (a: string | undefined) => string | null }) {
  const { books, review, sales, updateCompany } = useOpenBooks();
  const [error, setError] = useState<string | null>(null);
  const [changing, setChanging] = useState<string | null>(null);
  /** A customer's payment recorded against an invoice: which invoices, by the entry it posted. */
  const paidFor = (entryId: string | undefined) => {
    const payment = entryId ? sales.payments.find((p) => p.entryId === entryId) : undefined;
    const numbers = payment?.applications.map((a) => sales.invoices.find((i) => i.id === a.invoiceId)?.number).filter(Boolean) ?? [];
    return payment ? (numbers.length ? `Paid through ${BRAND.name} · ${numbers.join(", ")}` : `Paid through ${BRAND.name}`) : null;
  };
  const accountName = (entryId: string | undefined) => {
    const entry = books.entries.find((e) => e.id === entryId);
    const other = entry?.lines.find((l) => !isShieldFamily({ books }, l.accountId));
    return books.accounts.find((a) => a.id === other?.accountId)?.name;
  };
  const status = (i: ReviewItem) =>
    i.status === "accepted"
      ? `Posted to ${accountName(i.entryId) ?? "the books"}`
      : i.status === "recorded"
        ? (paidFor(i.entryId) ?? "Already in the books (paid from the app)")
        : i.status === "internal"
          ? `Nothing to post: the money stayed in the ${RAIL_ACCOUNT_NAME}`
          : "Kept out of the books";

  async function undo(id: string) {
    setError(null);
    try {
      await updateCompany((c) => undoReview(c, id, todayIso()));
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <FormError message={error} />
      <ul className="divide-y rounded-lg border bg-card text-sm">
        {items.map((i) => (
          <li key={i.id} className="flex flex-col gap-3 px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{sentence(i, nameOf(i.counterparty))}</p>
                <p className="text-xs text-muted-foreground">
                  {longDate(i.date)} · {status(i)}
                </p>
              </div>
              {i.status === "accepted" && changing !== i.id && (
                <Button variant="link" size="sm" className="h-auto min-h-11 p-0 sm:min-h-0" onClick={() => setChanging(i.id)}>
                  Change
                </Button>
              )}
              {(i.status === "accepted" || i.status === "excluded") && changing !== i.id && (
                <Button variant="link" size="sm" className="h-auto min-h-11 p-0 sm:min-h-0" onClick={() => void undo(i.id)}>
                  {i.status === "accepted" ? "Undo" : "Review again"}
                </Button>
              )}
            </div>
            {changing === i.id && (
              <ReviewCard
                item={{ ...i, status: "new" }}
                who={nameOf(i.counterparty)}
                editing={choicesOf({ books, review: review ?? undefined }, i.id) ?? { accountId: "" }}
                onDone={() => setChanging(null)}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
