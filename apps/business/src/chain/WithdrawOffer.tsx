"use client";

// ---------------------------------------------------------------------------
// Withdraw an offer that's still waiting: expired, or taken back. One Shield
// approval (`terminate_employer_open`), after which the person can't accept it
// anywhere; then its terms and files come out of the mailbox and the team
// member is typed again, ready for a new offer. Loaded only when tapped.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import { MailboxClient } from "@pnw/mailbox";
import { Button } from "@pnw/ui/button";
import { AleoWalletProviderWrapper } from "@pnw/wallet/wallet-provider";
import { FormError, errorMessage } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import { isExpired } from "@/books/offer_letter";
import { dropOffer } from "@/books/hiring";
import { linkFor, shortAddress } from "@/books/rail";
import { ShieldStatus } from "./ShieldStatus";
import { withdrawOffer } from "./offer";
import { useShield } from "./shield";

export type WithdrawOfferProps = { workerId: string; onClose: () => void };

export default function WithdrawOffer(props: WithdrawOfferProps) {
  return (
    <AleoWalletProviderWrapper>
      <div className="flex flex-col gap-3 rounded-md border bg-muted/40 p-4">
        <WithdrawFlow {...props} />
      </div>
    </AleoWalletProviderWrapper>
  );
}

function WithdrawFlow({ workerId, onClose }: WithdrawOfferProps) {
  const { rail, payroll, updateCompany, discardAttachment } = useOpenBooks();
  const { state, connect, error: shieldError, wallet } = useShield();
  const client = useMemo(() => new MailboxClient(), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const link = rail ? linkFor(rail, workerId) : undefined;
  const name = payroll.workers.find((w) => w.id === workerId)?.name ?? "them";

  if (!rail || !link || link.status !== "offered") return <FormError message="There's no waiting offer to withdraw." />;
  const expired = link.terms?.version === 2 && isExpired(link.terms.expiresAt);
  const address = state.kind === "connected" ? state.address : null;
  if (!address) return <ShieldStatus state={state} connect={connect} onClose={onClose} />;
  if (address !== rail.address) {
    return (
      <>
        <p className="text-sm">
          Shield is signed in to a different account ({shortAddress(address)}) than the one linked to these books ({shortAddress(rail.address)}). Switch
          accounts in Shield, then try again.
        </p>
        <Button variant="outline" className="min-h-11 self-start sm:min-h-9" onClick={onClose}>
          Close
        </Button>
      </>
    );
  }

  async function withdraw() {
    if (!rail?.businessNameHash || !link) return;
    setBusy(true);
    setError(null);
    try {
      await withdrawOffer({
        link,
        employerNameHash: rail.businessNameHash,
        client,
        wallet: {
          executeTransaction: async (opts) => {
            const r = await wallet.executeTransaction(opts);
            if (!r?.transactionId) throw new Error("Shield didn't take the withdrawal");
            return r;
          },
          transactionStatus: (id) => wallet.transactionStatus(id),
        },
      });
      // Someone the offer was hiring leaves the books; a team member already in them is typed again.
      await updateCompany((c) => dropOffer(c, workerId));
      for (const ref of link.offerFiles ?? []) await discardAttachment(ref.attachmentId).catch(() => {});
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <>
      <p className="text-sm">
        {expired ? `The offer to ${name} expired without an answer.` : `Take back the offer to ${name}?`} Withdrawing closes it for good: they
        can&apos;t accept it anywhere, its documents are cleared from the mailbox, and you can send a new offer.
      </p>
      <p className="text-xs text-muted-foreground">Shield asks you to approve one transaction; the business pays its network fee.</p>
      <FormError message={error ?? shieldError} />
      <div className="flex flex-wrap gap-3">
        <Button variant="destructive" className="min-h-11 sm:min-h-9" disabled={busy || !rail.businessNameHash} onClick={() => void withdraw()}>
          {busy ? "Withdrawing…" : "Withdraw offer"}
        </Button>
        <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={onClose}>
          Keep it
        </Button>
      </div>
    </>
  );
}
