"use client";

// ---------------------------------------------------------------------------
// The account's card (docs/HEWN_ART.md): issued as the last step of setup
// (one Shield approval after the name, or after a worker's profile), claimed
// once from Settings by an account from before the cards, and switched there
// by a worker between shown and hidden. The chain is read first, so a card
// issued on another device is simply kept. Loaded through a dynamic import.
// Nothing here logs an input, an id or an error.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { Button } from "@pnw/ui/button";
import { FormError, errorMessage } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import type { Card } from "@/books/card";
import { setProfile } from "@/books/work";
import { BRAND } from "@/brand";
import { HIDE_CARD, ISSUE_BUSINESS_CARD, ISSUE_WORKER_CARD, SHOW_CARD, awaitCard, blockTime, issueBusinessCardInputs, issueWorkerCardInputs, queryCard, switchCardInputs } from "./cards";
import { queryEmployerSuffix } from "./directory";
import { executeAndWait } from "./work/execute";
import { ShieldGate, WorkShieldProvider, useWorkShield } from "./work/WorkShield";

export type CardPanelProps = { onClose: () => void; onDone?: () => void };

export default function CardPanel(props: CardPanelProps) {
  return (
    <WorkShieldProvider>
      <ShieldGate onClose={props.onClose}>{() => <CardFlow {...props} />}</ShieldGate>
    </WorkShieldProvider>
  );
}

const FEE_NOTE = "Issuing is free. Shield asks you to approve it, and the network fee is a little ALEO.";

/** The honest limit of hiding, said before the switch (docs/HEWN_ART.md). */
export const HIDE_NOTE =
  "Hiding stops your card from showing anywhere from now on. It can't erase that the card was issued: that was a public transaction, and the chain keeps its history.";

const sinceLabel = (card: Card) =>
  card.since ? new Date(card.since).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : `block ${card.issuedAt.toLocaleString()}`;

function CardFlow({ onClose, onDone }: CardPanelProps) {
  const { role, rail, work, updateCompany } = useOpenBooks();
  const { wallet } = useWorkShield();
  const worker = role === "worker";
  const nameHash = worker ? work?.profile?.nameHash : rail?.businessNameHash;
  const name = worker ? work?.profile?.name : rail?.businessName;
  const known = worker ? work?.profile?.card : rail?.card;
  // undefined until the chain has been read; null when the name has no card yet.
  const [card, setCard] = useState<Card | null | undefined>(undefined);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const readFor = useRef<string | null>(null);

  /** Keeps the card in the books, with its date once the explorer gives it: what Settings shows without a read. */
  async function save(next: Card) {
    const since = next.since ?? (known?.issuedAt === next.issuedAt ? known.since : undefined) ?? (await blockTime(next.issuedAt)) ?? undefined;
    const kept: Card = since ? { ...next, since } : { issuedAt: next.issuedAt, shown: next.shown };
    await updateCompany((c) => {
      if (worker) return c.work?.profile ? { ...c, work: setProfile(c.work, { ...c.work.profile, card: kept }) } : c;
      return c.rail ? { ...c, rail: { ...c.rail, card: kept } } : c;
    });
    setCard(kept);
  }

  async function read(hash: string) {
    setError(null);
    try {
      const found = await queryCard(hash);
      if (found && (!known || known.issuedAt !== found.issuedAt || known.shown !== found.shown)) await save(found);
      else setCard(found ? { ...found, ...(known?.since ? { since: known.since } : {}) } : null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  // Once per name: what does the chain say?
  useEffect(() => {
    if (!nameHash || readFor.current === nameHash) return;
    readFor.current = nameHash;
    void read(nameHash);
  }, [nameHash]);

  async function issue() {
    if (!nameHash) return;
    setBusy(true);
    setError(null);
    try {
      if (worker) {
        await executeAndWait(wallet, { ...ISSUE_WORKER_CARD, inputs: issueWorkerCardInputs(nameHash, shown) });
      } else {
        const code = await queryEmployerSuffix(nameHash);
        if (code === null) throw new Error("The business name's industry couldn't be read; try again in a moment");
        await executeAndWait(wallet, { ...ISSUE_BUSINESS_CARD, inputs: issueBusinessCardInputs(nameHash, code) });
      }
      await save(await awaitCard(nameHash));
      onDone?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function flip(to: boolean) {
    if (!nameHash) return;
    setBusy(true);
    setError(null);
    try {
      await executeAndWait(wallet, { ...(to ? SHOW_CARD : HIDE_CARD), inputs: switchCardInputs(nameHash) });
      await save(await awaitCard(nameHash, { until: (c) => c.shown === to }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const close = (
    <Button variant="outline" className="min-h-11 self-start sm:min-h-9" disabled={busy} onClick={onClose}>
      {card ? "Done" : "Cancel"}
    </Button>
  );

  if (!nameHash) {
    return (
      <>
        <FormError message="Register your name first." />
        {close}
      </>
    );
  }

  if (card === undefined) {
    return (
      <>
        <p className="text-sm text-muted-foreground">{error ? "Couldn't read the chain." : "Checking the chain…"}</p>
        <FormError message={error} />
        {error && (
          <Button variant="outline" className="min-h-11 self-start sm:min-h-9" onClick={() => void read(nameHash)}>
            Try again
          </Button>
        )}
      </>
    );
  }

  if (card) {
    return (
      <>
        <p className="text-sm">
          <span className="font-medium">
            {name}.{BRAND.nameSuffix}
          </span>{" "}
          has its card. On {BRAND.name} since {sinceLabel(card)}.
        </p>
        {worker ? (
          <>
            <p className="text-sm">{card.shown ? "It is shown publicly: anyone can see it where your name appears." : "It is hidden: it shows only in your own app."}</p>
            {card.shown && <p className="text-xs text-muted-foreground">{HIDE_NOTE}</p>}
            <FormError message={error} />
            <div className="flex flex-wrap gap-3">
              <Button className="min-h-11 sm:min-h-9" variant="outline" disabled={busy} onClick={() => void flip(!card.shown)}>
                {busy ? "Working…" : card.shown ? "Hide it" : "Show it"}
              </Button>
              {close}
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">It is public, like your name, and bound to it: it can&apos;t be sold or traded on its own.</p>
            <FormError message={error} />
            {close}
          </>
        )}
      </>
    );
  }

  return (
    <>
      <div>
        <h3 className="text-sm font-semibold">{worker ? "Your card" : "Your business's card"}</h3>
        <p className="text-xs text-muted-foreground">
          {worker
            ? `Your land, drawn from your name, with a pine that grows with your time on ${BRAND.name}. It shows your name and your time here: never who you work for, your pay or your credentials.`
            : `Your land as a map, drawn from your name, with your time on ${BRAND.name} counting from today. It is public, like your name, and bound to it.`}
        </p>
      </div>
      {worker && (
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input type="checkbox" className="size-4" checked={shown} onChange={(e) => setShown(e.target.checked)} disabled={busy} />
          <span>Show my card publicly</span>
        </label>
      )}
      {worker && <p className="text-xs text-muted-foreground">You can switch this any time in Settings. Issuing the card is itself a public transaction.</p>}
      <p className="text-xs text-muted-foreground">{FEE_NOTE}</p>
      <FormError message={error} />
      <div className="flex flex-wrap gap-3">
        <Button className="min-h-11 sm:min-h-9" disabled={busy} onClick={() => void issue()}>
          {busy ? "Issuing…" : "Issue my card"}
        </Button>
        {close}
      </div>
    </>
  );
}
