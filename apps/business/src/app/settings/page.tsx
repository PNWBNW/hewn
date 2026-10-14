"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Check, Copy } from "lucide-react";
import { Button } from "@pnw/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@pnw/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@pnw/ui/dialog";
import { FormError, errorMessage } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import { shortAddress } from "@/books/rail";
import { BRAND } from "@/brand";
import { PageHeader } from "@/shell/SectionView";

// Fetched only when the user taps Connect or Import: nobody else downloads the rail code.
const RailPanel = dynamic(() => import("@/chain/RailPanel"), {
  ssr: false,
  loading: () => <p className="text-sm text-muted-foreground">Loading…</p>,
});

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default function SettingsPage() {
  const { books, role, email } = useOpenBooks();
  const worker = role === "worker";
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Settings" summary={worker ? "You, and how you get paid." : "Your business, and how it pays."} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{worker ? "You" : "Business"}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-muted-foreground">Name</dt>
            <dd className="font-medium">{books.settings.businessName}</dd>
            {!worker && (
              <>
                <dt className="text-muted-foreground">Fiscal year starts</dt>
                <dd className="font-medium">{MONTHS[books.settings.fiscalYearStartMonth - 1] ?? "January"}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Account</dt>
            <dd className="break-all font-medium">{email ?? <span className="text-muted-foreground">Created before accounts</span>}</dd>
          </dl>
          <p className="mt-4 text-xs text-muted-foreground">
            You can add the other kind later from the front page: New here? → choose the other one.
          </p>
        </CardContent>
      </Card>

      <PrivatePayments />
    </div>
  );
}

function PrivatePayments() {
  const { rail, payroll, role, updateCompany } = useOpenBooks();
  const worker = role === "worker";
  const [panel, setPanel] = useState<"connect" | "import" | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Private payments</CardTitle>
        <p className="text-sm text-muted-foreground">
          {worker
            ? rail
              ? "Shield is linked. Offers and pay reach this account directly."
              : "Connect Shield to receive offers and get paid directly, with no bank in the middle. Your hours and paystubs stay on this device either way."
            : rail
              ? "Shield is linked. Payments to your team and vendors can go straight from this account."
              : "Connect Shield to pay your team and vendors directly, with no bank in the middle. Your books stay on this device either way."}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {rail && <LinkedAccount />}

        {panel ? (
          <RailPanel mode={panel} onClose={() => setPanel(null)} />
        ) : rail ? (
          <div className="flex flex-wrap gap-3">
            {!worker && (
              <Button className="min-h-11 sm:min-h-9" onClick={() => setPanel("import")}>
                Import team
              </Button>
            )}
            <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={() => setConfirmUnlink(true)}>
              Unlink
            </Button>
          </div>
        ) : (
          <Button className="min-h-11 self-start sm:min-h-9" onClick={() => setPanel("connect")}>
            Connect Shield
          </Button>
        )}

        <FormError message={error} />

        <Dialog open={confirmUnlink} onOpenChange={setConfirmUnlink}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Unlink this account?</DialogTitle>
              <DialogDescription>
                {worker
                  ? "The account comes off this device. Your agreements, hours and paystubs stay, and you can connect it again later."
                  : `The account and the ${payroll.workers.length === 1 ? "link" : "links"} to your team come off your books. Nothing happens to the account itself, and you can connect it again later.`}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="mt-4 gap-2">
              <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={() => setConfirmUnlink(false)}>
                Keep it
              </Button>
              <Button
                variant="destructive"
                className="min-h-11 sm:min-h-9"
                onClick={async () => {
                  setError(null);
                  try {
                    await updateCompany(({ rail: _dropped, ...rest }) => rest);
                    setConfirmUnlink(false);
                  } catch (e) {
                    setError(errorMessage(e));
                  }
                }}
              >
                Unlink
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

function LinkedAccount() {
  const { rail, payroll, role, work } = useOpenBooks();
  const [copied, setCopied] = useState(false);
  if (!rail) return null;
  const worker = role === "worker";
  const names = new Map(payroll.workers.map((w) => [w.id, w.name]));
  const linked = rail.links.filter((l) => names.has(l.workerId) && l.status === "linked").length;
  const offered = rail.links.filter((l) => names.has(l.workerId) && l.status === "offered").length;
  const linkedOn = new Date(rail.linkedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  const registered = worker ? work?.profile?.name : rail.businessName;

  return (
    <dl className="grid gap-x-6 gap-y-3 rounded-md border border-dashed p-3 text-sm sm:grid-cols-[auto_1fr]">
      <dt className="text-muted-foreground">Account</dt>
      <dd className="flex items-center gap-2 font-medium">
        <span className="font-mono text-xs sm:text-sm" title="The full account is in your books">{shortAddress(rail.address)}</span>
        <button
          type="button"
          className="grid size-8 place-items-center rounded-md hover:bg-accent"
          aria-label={copied ? "Copied" : "Copy the full account"}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(rail.address);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              // Clipboard refused (not secure context); nothing else to do.
            }
          }}
        >
          {copied ? <Check aria-hidden className="size-4 text-money-positive" /> : <Copy aria-hidden className="size-4" />}
        </button>
      </dd>
      <dt className="text-muted-foreground">Registered name</dt>
      <dd className="font-medium">{registered ? `${registered}.${BRAND.nameSuffix}` : <span className="text-muted-foreground">None yet</span>}</dd>
      <dt className="text-muted-foreground">Linked</dt>
      <dd className="font-medium">{linkedOn}</dd>
      {!worker && (
        <>
          <dt className="text-muted-foreground">Team</dt>
          <dd className="font-medium">
            {linked} {linked === 1 ? "team member" : "team members"} linked
            {offered > 0 && ` · ${offered} ${offered === 1 ? "offer" : "offers"} sent`}
          </dd>
        </>
      )}
    </dl>
  );
}
