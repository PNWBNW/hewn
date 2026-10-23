"use client";

// ---------------------------------------------------------------------------
// Coworkers' registered names on screen (chain/coworker_names.ts has why):
// what the vault kept from the last day, and a look at the chain for any
// account not confirmed in that time, one at a time. Nothing is logged.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { ShieldCheck, TriangleAlert } from "lucide-react";
import { BRAND } from "@/brand";
import { useWork } from "@/books/BooksProvider";
import { confirmAgainDue } from "@/books/directory";
import { isRailAddress } from "@/books/rail";
import { forgetConfirmedName, keepConfirmedName } from "@/books/work";
import { type NameCheck, checkAccountName } from "../coworker_names";

export type ShownName = { status: "confirmed"; name: string } | { status: "business"; name: string } | { status: "checking" } | { status: "unconfirmed" };

/** This tab's answers, so an account that couldn't be confirmed isn't asked about on every visit. */
const answered = new Map<string, { check: NameCheck; at: number }>();
/** Accounts being looked up now, so two screens don't ask about the same one at once. */
const asking = new Set<string>();
const ASK_AGAIN_MS = 5 * 60 * 1000;

/** Each account's name as far as the chain has confirmed it, checking the ones due. */
export function useCoworkerNames(accounts: readonly (string | undefined)[]): Map<string, ShownName> {
  const { work, updateWork } = useWork();
  const [, setAnswers] = useState(0);
  const list = [...new Set(accounts.filter((a): a is string => !!a && isRailAddress(a)))].sort().join(",");
  const kept = work.confirmedNames;

  useEffect(() => {
    let live = true;
    void (async () => {
      for (const address of list ? list.split(",") : []) {
        const now = Date.now();
        const last = answered.get(address);
        if (!confirmAgainDue(kept?.[address], now) || (last && now - last.at < ASK_AGAIN_MS) || asking.has(address)) continue;
        if (!live) return;
        asking.add(address);
        try {
          const check = await checkAccountName(address);
          answered.set(address, { check, at: Date.now() });
          if (check.status === "person") await updateWork((w) => keepConfirmedName(w, address, check.name, new Date().toISOString()));
          else if (check.status === "business") await updateWork((w) => forgetConfirmedName(w, address));
        } catch {
          // the books are locked or changed elsewhere; this tab's answer still shows
        } finally {
          asking.delete(address);
        }
        // Even after this screen moved on: the answer is in `answered` for whichever shows next.
        setAnswers((n) => n + 1);
      }
    })();
    return () => {
      live = false;
    };
  }, [list, kept, updateWork]);

  const shown = new Map<string, ShownName>();
  for (const address of list ? list.split(",") : []) {
    const check = answered.get(address)?.check;
    const name = kept?.[address]?.name;
    if (check?.status === "business") shown.set(address, { status: "business", name: check.name });
    else if (check?.status === "person") shown.set(address, { status: "confirmed", name: check.name });
    else if (name) shown.set(address, { status: "confirmed", name });
    else shown.set(address, { status: check ? "unconfirmed" : "checking" });
  }
  return shown;
}

/** `ana.hewn`, or "a business" when a business's name has no text on chain. */
const label = (name: string) => (name ? `${name}.${BRAND.nameSuffix}` : "a business");

/** One line under a coworker's name: who the chain says holds their account. */
export function ConfirmedNameLine({ shown }: { shown: ShownName | undefined }) {
  if (!shown || shown.status === "checking") return <span className="block truncate text-xs text-muted-foreground">Checking their name on chain…</span>;
  if (shown.status === "confirmed") {
    return (
      <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
        <ShieldCheck aria-hidden className="size-3 shrink-0" />
        {label(shown.name)} · confirmed on chain
      </span>
    );
  }
  if (shown.status === "business") {
    return (
      <span className="flex items-center gap-1 truncate text-xs text-destructive">
        <TriangleAlert aria-hidden className="size-3 shrink-0" />
        A business&apos;s account ({label(shown.name)}), not a person&apos;s
      </span>
    );
  }
  return <span className="block truncate text-xs text-muted-foreground">Name not confirmed on chain yet</span>;
}
