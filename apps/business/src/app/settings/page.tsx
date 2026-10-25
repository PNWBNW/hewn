"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Check, Copy, LogOut } from "lucide-react";
import { Button } from "@pnw/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@pnw/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@pnw/ui/dialog";
import { Field, FormError, PassphraseInput, errorMessage } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import { shortAddress } from "@/books/rail";
import { BRAND } from "@/brand";
import BusinessCardArt from "@/cards/BusinessCardArt";
import { PageHeader } from "@/shell/SectionView";

// Fetched only when the user taps Connect or Import: nobody else downloads the rail code.
const RailPanel = dynamic(() => import("@/chain/RailPanel"), {
  ssr: false,
  loading: () => <p className="text-sm text-muted-foreground">Loading…</p>,
});

// A read-only check of what Shield can tell the books about past transfers; fetched only when tapped.
const HistoryProbe = dynamic(() => import("@/chain/HistoryProbe"), {
  ssr: false,
  loading: () => <p className="text-sm text-muted-foreground">Loading…</p>,
});

// One real letter to this account itself (letters on chain); fetched only when tapped.
const LetterCheck = dynamic(() => import("@/chain/LetterCheck"), {
  ssr: false,
  loading: () => <p className="text-sm text-muted-foreground">Loading…</p>,
});

// The account's card: claimed once by an account from before the cards, switched by a worker; fetched only when tapped.
const CardPanel = dynamic(() => import("@/chain/CardPanel"), {
  ssr: false,
  loading: () => <p className="text-sm text-muted-foreground">Loading…</p>,
});

// Hewn's own report inbox; shown only to the account reports go to, fetched only when tapped.
const ReportInbox = dynamic(() => import("@/chain/ReportInbox"), {
  ssr: false,
  loading: () => <p className="text-sm text-muted-foreground">Loading…</p>,
});

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default function SettingsPage() {
  const { books, role, username, lock, stayUntil } = useOpenBooks();
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
            <dt className="text-muted-foreground">Username</dt>
            <dd className="break-all font-medium">{username ?? <span className="text-muted-foreground">Created before accounts</span>}</dd>
          </dl>
          <p className="mt-4 text-xs text-muted-foreground">
            You can add the other kind later from the front page: New here? → choose the other one.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t pt-4">
            <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={lock}>
              <LogOut aria-hidden />
              Log out
            </Button>
            <span className="text-xs text-muted-foreground">
              {stayUntil
                ? `Staying logged in on this device until ${stayUntil.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}.`
                : "Logs out when the page is closed or after 15 idle minutes."}
            </span>
          </div>
        </CardContent>
      </Card>

      <YourCard />

      <RecoveryKey />

      <PrivatePayments />
    </div>
  );
}

/**
 * The account's card (docs/HEWN_ART.md): what the chain holds for the name, as the vault last saw
 * it. An account from before the cards claims its card here; a worker switches theirs between
 * shown and hidden here. A business's card is always shown.
 */
function YourCard() {
  const { books, role, rail, work } = useOpenBooks();
  const worker = role === "worker";
  const name = worker ? work?.profile?.name : rail?.businessName;
  const card = worker ? work?.profile?.card : rail?.card;
  const [open, setOpen] = useState(false);
  if (!rail || !name) return null;
  const since = card?.since ? new Date(card.since).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{worker ? "Your card" : "Your business's card"}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {worker
            ? `Your land, drawn from your name, with a pine that grows with your time on ${BRAND.name}. It shows your name and your time here, nothing else.`
            : `Your land as a map, drawn from your name, with your time on ${BRAND.name}. Public, like your name, and bound to it.`}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {card && !worker && <BusinessCardArt name={name} displayName={books.settings.businessName} card={card} className="w-full max-w-[280px]" />}
        {card && (
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-muted-foreground">Name</dt>
            <dd className="font-medium">
              {name}.{BRAND.nameSuffix}
            </dd>
            <dt className="text-muted-foreground">On {BRAND.name} since</dt>
            <dd className="font-medium">{since ?? `block ${card.issuedAt.toLocaleString()}`}</dd>
            {worker && (
              <>
                <dt className="text-muted-foreground">Visibility</dt>
                <dd className="font-medium">{card.shown ? "Shown publicly" : "Hidden"}</dd>
              </>
            )}
          </dl>
        )}
        {open ? (
          <CardPanel onClose={() => setOpen(false)} />
        ) : card && !worker ? null : (
          <Button className="min-h-11 self-start sm:min-h-9" variant={card ? "outline" : "default"} onClick={() => setOpen(true)}>
            {card ? (card.shown ? "Hide it" : "Show it") : "Claim your card"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The recovery key (@pnw/vault `addRecovery`): a code that sets a new passphrase if this one is
 * forgotten. Making or removing one takes the passphrase. The code shows once, here, and is never
 * stored; it lives in backups downloaded after it was made.
 */
function RecoveryKey() {
  const { recoveryMadeAt, makeRecoveryKey, removeRecoveryKey } = useOpenBooks();
  const [action, setAction] = useState<"make" | "remove" | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const [kept, setKept] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => {
    setAction(null);
    setPassphrase("");
    setError(null);
    setBusy(false);
  };

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      if (action === "make") {
        setCode(await makeRecoveryKey(passphrase));
        setKept(false);
        setCopied(false);
      } else await removeRecoveryKey(passphrase);
      close();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Recovery key</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {code ? (
          <>
            <p>Write this down now, on paper. It won&apos;t be shown again.</p>
            <p className="select-all break-all rounded-md border bg-muted px-3 py-3 text-center font-mono text-base tracking-wider sm:text-lg">{code}</p>
            <Button
              variant="outline"
              className="min-h-11 self-start sm:min-h-9"
              onClick={async () => {
                await navigator.clipboard.writeText(code).then(
                  () => setCopied(true),
                  () => setCopied(false),
                );
              }}
            >
              {copied ? <Check aria-hidden className="text-money-positive" /> : <Copy aria-hidden />}
              {copied ? "Copied" : "Copy"}
            </Button>
            <p className="text-muted-foreground">
              With it and your username, you can set a new passphrase on this device or on a backup downloaded from now on. Anyone who has it, your
              username and these books (this device or a backup) can open them, so keep it away from both. Download a new backup now: older ones
              don&apos;t have this key.
            </p>
            <label className="flex min-h-11 items-center gap-3">
              <input type="checkbox" className="size-5 shrink-0 accent-primary" checked={kept} onChange={(e) => setKept(e.target.checked)} />
              <span>I&apos;ve written it down somewhere safe</span>
            </label>
            <Button className="min-h-11 self-start sm:min-h-9" disabled={!kept} onClick={() => setCode(null)}>
              Done
            </Button>
          </>
        ) : (
          <>
            <p className={recoveryMadeAt ? "" : "text-warning"}>
              {recoveryMadeAt
                ? `Made ${new Date(recoveryMadeAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}. If you forget your passphrase, it sets a new one: Log in → Forgot your passphrase?`
                : "None yet. There is no password reset: without a recovery key, a forgotten passphrase means these books can't be opened."}
            </p>
            {action ? (
              <form
                className="flex flex-col gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!busy && passphrase) void confirm();
                }}
              >
                <Field label="Your passphrase" hint={action === "make" && recoveryMadeAt ? "A new key replaces the old one, which stops working." : undefined}>
                  <PassphraseInput value={passphrase} onChange={setPassphrase} />
                </Field>
                <FormError message={error} />
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" variant={action === "remove" ? "destructive" : "default"} className="min-h-11 sm:min-h-9" disabled={busy || !passphrase}>
                    {busy ? "Working…" : action === "make" ? "Make the recovery key" : "Remove the recovery key"}
                  </Button>
                  <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={close}>
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button className="min-h-11 sm:min-h-9" variant={recoveryMadeAt ? "outline" : "default"} onClick={() => setAction("make")}>
                  {recoveryMadeAt ? "Make a new one" : "Make a recovery key"}
                </Button>
                {recoveryMadeAt && (
                  <Button className="min-h-11 sm:min-h-9" variant="outline" onClick={() => setAction("remove")}>
                    Remove it
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function PrivatePayments() {
  const { rail, payroll, role, updateCompany } = useOpenBooks();
  const worker = role === "worker";
  const [panel, setPanel] = useState<"connect" | "import" | "register" | "history" | "letter" | "reports" | null>(null);
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

        {panel === "history" ? (
          <HistoryProbe onClose={() => setPanel(null)} />
        ) : panel === "letter" ? (
          <LetterCheck onClose={() => setPanel(null)} />
        ) : panel === "reports" ? (
          <ReportInbox onClose={() => setPanel(null)} />
        ) : panel ? (
          <RailPanel mode={panel} onClose={() => setPanel(null)} />
        ) : rail ? (
          <div className="flex flex-wrap gap-3">
            {!worker && (
              <Button className="min-h-11 sm:min-h-9" onClick={() => setPanel("import")}>
                Import team
              </Button>
            )}
            {!worker && !rail.businessNameHash && (
              <Button className="min-h-11 sm:min-h-9" onClick={() => setPanel("register")}>
                Register business name
              </Button>
            )}
            {!worker && (
              <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={() => setPanel("history")}>
                Check Shield history
              </Button>
            )}
            <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={() => setPanel("letter")}>
              Send a test letter
            </Button>
            {rail.address === BRAND.reportsAccount && (
              <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={() => setPanel("reports")}>
                Reports
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
