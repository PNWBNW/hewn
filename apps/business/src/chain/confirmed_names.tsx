"use client";

// ---------------------------------------------------------------------------
// Registered names on screen, as the chain confirms them (chain/coworker_names.ts
// has why): under a coworker, on an announcement channel, on an invitation.
// What a person's vault kept from the last day shows at once; any account not
// confirmed in that time is looked up, one at a time. A business's books keep
// the answers for this tab only. Nothing is logged.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { ShieldCheck, TriangleAlert } from "lucide-react";
import { BRAND } from "@/brand";
import { useOpenBooks } from "@/books/BooksProvider";
import { confirmAgainDue } from "@/books/directory";
import { isRailAddress } from "@/books/rail";
import { keepConfirmedName } from "@/books/work";
import { type NameCheck, checkAccountName } from "./coworker_names";

export type AccountKind = "person" | "business";

export type ShownName =
  /** The kind of account it should be, and the name the chain confirms for it. */
  | { status: "confirmed"; name: string; kind: AccountKind }
  /** The other kind: a business's account listed as a coworker, or a person's posting as an employer. */
  | { status: "unexpected"; name: string; kind: AccountKind }
  | { status: "checking" }
  | { status: "unconfirmed" };

/** This tab's answers, so an account that couldn't be confirmed isn't asked about on every visit. */
const answered = new Map<string, { check: NameCheck; at: number }>();
/** Accounts being looked up now, so two screens don't ask about the same one at once. */
const asking = new Set<string>();
const ASK_AGAIN_MS = 5 * 60 * 1000;

/** Each account's name as far as the chain has confirmed it, checking the ones due. */
export function useConfirmedNames(accounts: readonly (string | undefined)[], expect: AccountKind): Map<string, ShownName> {
  const { work, updateCompany } = useOpenBooks();
  const [, setAnswers] = useState(0);
  const list = [...new Set(accounts.filter((a): a is string => !!a && isRailAddress(a)))].sort().join(",");
  const kept = work?.confirmedNames;

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
          // A person's vault keeps what the chain confirmed; a failed look-up keeps what was there.
          if (check.status !== "unconfirmed" && check.name) {
            const kind = check.status === "business" ? "business" : undefined;
            await updateCompany((c) => (c.work ? { ...c, work: keepConfirmedName(c.work, address, check.name, new Date().toISOString(), kind) } : c));
          }
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
  }, [list, kept, updateCompany]);

  const shown = new Map<string, ShownName>();
  for (const address of list ? list.split(",") : []) {
    const check = answered.get(address)?.check;
    const keptName = kept?.[address];
    let found: { name: string; kind: AccountKind } | null = null;
    if (check && check.status !== "unconfirmed") found = { name: check.name, kind: check.status };
    else if (keptName) found = { name: keptName.name, kind: keptName.kind === "business" ? "business" : "person" };
    if (found) shown.set(address, { status: found.kind === expect ? "confirmed" : "unexpected", ...found });
    else shown.set(address, { status: check ? "unconfirmed" : "checking" });
  }
  return shown;
}

/** `ana_w.hewn`, or "a business" when a business's name has no text on chain. */
export const confirmedLabel = (name: string): string => (name ? `${name}.${BRAND.nameSuffix}` : "a business");

/** One line: who the chain says holds an account. */
export function ConfirmedNameLine({ shown }: { shown: ShownName | undefined }) {
  if (!shown || shown.status === "checking") return <span className="block truncate text-xs text-muted-foreground">Checking the name on chain…</span>;
  if (shown.status === "confirmed") {
    return (
      <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
        <ShieldCheck aria-hidden className="size-3 shrink-0" />
        {confirmedLabel(shown.name)} · confirmed on chain
      </span>
    );
  }
  if (shown.status === "unexpected") {
    return (
      <span className="flex items-center gap-1 truncate text-xs text-destructive">
        <TriangleAlert aria-hidden className="size-3 shrink-0" />
        {shown.kind === "business" ? `A business's account (${confirmedLabel(shown.name)}), not a person's` : `A person's account (${confirmedLabel(shown.name)}), not a business's`}
      </span>
    );
  }
  return <span className="block truncate text-xs text-muted-foreground">Name not confirmed on chain yet</span>;
}

/** The line for one account; the default export, so screens outside src/chain can load it on demand. */
export default function ConfirmedFrom({ account, expect }: { account: string | undefined; expect: AccountKind }) {
  const shown = useConfirmedNames([account], expect).get(account ?? "");
  if (!account) return null;
  return <ConfirmedNameLine shown={shown} />;
}
