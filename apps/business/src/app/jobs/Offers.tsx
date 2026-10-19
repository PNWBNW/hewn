"use client";

// Offers, under Jobs: hiring in one place. Send a job offer (to an applicant,
// to someone found on the registry, or to a team member added by hand who has
// no agreement yet), see the offers out and the acceptances, and answer a
// request for changes. Acceptances (from the agreement records in the Shield
// account), replies and requests are all read by the one check, when the tab
// opens and on "Check now" (chain/MailboxCheck.tsx).

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Plus, RefreshCw } from "lucide-react";
import { formatCents } from "@pnw/ledger";
import type { AttachmentRef } from "@pnw/sales";
import { Button } from "@pnw/ui/button";
import { Card, CardContent } from "@pnw/ui/card";
import { cn } from "@pnw/ui/utils";
import { useOpenBooks } from "@/books/BooksProvider";
import { LinkBadge } from "@/books/LinkBadge";
import { threadFor } from "@/books/mailbox";
import { type OfferItem, hasWaitingOffer, mailboxLinks, offersFeed } from "@/books/mailbox_feed";
import { ChangeList, QuotedNote } from "@/books/NegotiationView";
import { LetterSections, OfferFileList } from "@/books/OfferLetterView";
import { isExpired } from "@/books/offer_letter";
import { type Registered, linkFor, linkStatus } from "@/books/rail";
import { RegistryField } from "@/books/RegistryField";
import { isOfferStep, openCounter, proposalChanges, proposalOf } from "@/books/thread";
import { workWeekSummary } from "@/books/work_week";
import type { Terms } from "@/books/work";
import { BRAND } from "@/brand";
import { when } from "../work/shared";

const loading = () => <p className="text-sm text-muted-foreground">Loading…</p>;
// Fetched only once there is something to read; nobody without a linked team member or a waiting offer downloads it.
const MailboxCheck = dynamic(() => import("@/chain/MailboxCheck"), { ssr: false });
const OfferPanel = dynamic(() => import("@/chain/OfferPanel"), { ssr: false, loading });
const WithdrawOffer = dynamic(() => import("@/chain/WithdrawOffer"), { ssr: false, loading });
const KeepOffer = dynamic(() => import("@/chain/KeepOffer"), { ssr: false, loading });
const ReviseOffer = dynamic(() => import("@/chain/ReviseOffer"), { ssr: false, loading });

type Checking = { state: "idle" } | { state: "running"; run: number } | { state: "done"; received: number; skipped: number; accepted?: string[]; message?: string };

export default function Offers() {
  const { rail, payroll, mailbox } = useOpenBooks();
  const canCheck = mailboxLinks(rail).length > 0 || hasWaitingOffer(rail);
  const [check, setCheck] = useState<Checking>(canCheck ? { state: "running", run: 0 } : { state: "idle" });
  const [hiring, setHiring] = useState(false);
  const [hiringWho, setHiringWho] = useState<Registered | undefined>(undefined);
  const [offering, setOffering] = useState<string | null>(null);
  const feed = useMemo(() => offersFeed({ rail, payroll, mailbox }), [rail, payroll, mailbox]);
  // Added by hand, no agreement yet: an offer links them.
  const unlinked = payroll.workers.filter((w) => w.active && linkStatus(rail, "worker", w.id) === "typed");

  const finished = useCallback((o: { received: number; skipped: number; accepted?: string[]; message?: string }) => setCheck({ state: "done", ...o }), []);
  useEffect(() => {
    if (canCheck) setCheck((c) => (c.state === "idle" ? { state: "running", run: 0 } : c));
  }, [canCheck]);

  const status =
    check.state === "running"
      ? "Checking for replies…"
      : check.state === "done"
        ? [
            ...(check.accepted?.length ? [`${acceptedLine(check.accepted)} accepted your offer.`] : []),
            check.message ?? (check.accepted?.length ? "" : "Up to date."),
            ...(check.skipped > 0 ? [`${check.skipped} couldn't be read and ${check.skipped === 1 ? "was" : "were"} skipped.`] : []),
          ]
            .filter(Boolean)
            .join(" ")
        : null;

  return (
    <div className="flex flex-col gap-4">
      {!hiring && offering === null && (
        <div className="flex flex-wrap items-center gap-3">
          <Button className="min-h-11 sm:min-h-9" onClick={() => setHiring(true)}>
            <Plus aria-hidden />
            Send a job offer
          </Button>
          {canCheck && check.state === "done" && (
            <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={() => setCheck({ state: "running", run: Date.now() })}>
              <RefreshCw aria-hidden />
              Check now
            </Button>
          )}
        </div>
      )}
      {check.state === "running" && <MailboxCheck key={check.run} onFinished={finished} />}
      {status && (
        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
          {status}
        </p>
      )}

      {hiring && (
        <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
          {!hiringWho ? (
            <>
              <RegistryField
                allow={["worker"]}
                value={undefined}
                onChange={setHiringWho}
                label="Who's the offer for?"
                hint={`Their registered name, like ana.${BRAND.nameSuffix}, or their account. They join your team when they accept the offer.`}
              />
              <Button variant="outline" className="min-h-11 self-start sm:min-h-9" onClick={() => setHiring(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <OfferPanel
              hire={hiringWho}
              onClose={() => {
                setHiring(false);
                setHiringWho(undefined);
              }}
            />
          )}
        </div>
      )}

      {unlinked.length > 0 && (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-6">
            <p className="text-sm">On the team without an agreement yet. An offer they accept links them, so they can be paid on the rail and get paystubs.</p>
            <ul className="divide-y">
              {unlinked.map((w) => (
                <li key={w.id} className="flex flex-col gap-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {w.name}
                      <LinkBadge status="typed" />
                    </span>
                    {offering !== w.id && !hiring && (
                      <Button variant="outline" size="sm" className="min-h-11 sm:min-h-8" onClick={() => setOffering(w.id)}>
                        Send offer
                      </Button>
                    )}
                  </div>
                  {offering === w.id && <OfferPanel workerId={w.id} onClose={() => setOffering(null)} />}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          {feed.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No offers yet. Send one to an applicant from a posting, or to anyone by their registered name. They join the team when they accept.
            </p>
          ) : (
            <ul className="divide-y">
              {feed.map((item) => (
                <li key={item.key} className="py-3 text-sm">
                  <Row item={item} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** "Ana Ruiz", "Ana Ruiz and Bo", "Ana Ruiz, Bo and Cy". */
function acceptedLine(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Where a waiting offer stands, from its receipt and its expiry. */
function offerDetail(item: Extract<OfferItem, { kind: "offer" }>): string {
  const expired = item.expiresAt !== undefined && isExpired(item.expiresAt);
  if (item.receivedAt) return `Opened ${when(item.receivedAt)}. ${expired ? "It expired without an answer." : "Waiting for them to accept; Check now looks for their answer."}`;
  return expired ? "It expired before they opened it." : "Not opened yet. Waiting for them to accept; Check now looks for their answer.";
}

function Row({ item }: { item: OfferItem }) {
  const { rail } = useOpenBooks();
  const [shown, setShown] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  if (item.kind === "thread") return <ThreadRow item={item} />;
  const link = rail ? linkFor(rail, item.workerId) : undefined;
  const terms = link?.terms;
  const text =
    item.kind === "offer"
      ? { title: `Offer sent to ${item.workerName}`, detail: offerDetail(item) }
      : { title: `${item.workerName} accepted your offer`, detail: "They're linked: you can pay them on the rail and send paystubs." };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="min-w-0">
          <span className="font-medium">{text.title}</span>
          <div className="text-xs text-muted-foreground">{text.detail}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {terms && (
            <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-8" aria-expanded={shown} onClick={() => setShown((s) => !s)}>
              {shown ? "Hide offer" : "View offer"}
            </Button>
          )}
          {item.kind === "offer" && !withdrawing && (
            <Button
              variant={item.expiresAt && isExpired(item.expiresAt) ? "outline" : "ghost"}
              size="sm"
              className="min-h-11 sm:min-h-8"
              onClick={() => setWithdrawing(true)}
            >
              Withdraw offer
            </Button>
          )}
          <span className="shrink-0 text-xs text-muted-foreground">{when(item.at)}</span>
        </div>
      </div>
      {withdrawing && (
        <div className="rounded-md border p-3">
          <WithdrawOffer workerId={item.workerId} onClose={() => setWithdrawing(false)} />
        </div>
      )}
      {terms && shown && (
        <div className="rounded-md border p-3">
          <SentOffer terms={terms} files={link?.offerFiles} />
        </div>
      )}
    </div>
  );
}

type Answering = "keep" | "accept" | "counter" | null;

/** One message in the conversation around an offer: their request for changes, or this business's answer. */
function ThreadRow({ item: feed }: { item: Extract<OfferItem, { kind: "thread" }> }) {
  const { rail, mailbox } = useOpenBooks();
  const [answering, setAnswering] = useState<Answering>(null);
  const { item, workerName, workerId, partiesKey } = feed;
  const body = item.body;
  if (!isOfferStep(body)) return null; // everything else lives in Messages
  const link = rail ? linkFor(rail, workerId) : undefined;
  const title =
    body.type === "counter"
      ? `${workerName} asked for changes to your offer`
      : body.type === "stands"
        ? `You kept the offer to ${workerName} as it is`
        : `You sent ${workerName} a revised offer`;

  // A request is answerable while it's the latest one on the offer that is still waiting.
  const current = link?.status === "offered" && link.agreementId === body.agreementId && link.terms ? link.terms : null;
  const open = body.type === "counter" && current && openCounter(threadFor(mailbox, partiesKey), body.agreementId)?.id === item.id;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className={cn("font-medium", open && "text-primary")}>{title}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{when(item.sentAt)}</span>
      </div>
      {body.type === "counter" &&
        (current ? (
          <ChangeList changes={proposalChanges(proposalOf(current), body.proposal)} />
        ) : (
          <p className="text-xs text-muted-foreground">On an earlier offer.</p>
        ))}
      <QuotedNote who={item.mine ? "You" : workerName} text={body.note} />
      {open && body.type === "counter" && answering === null && (
        <div className="flex flex-wrap gap-2">
          <Button className="min-h-11 sm:min-h-9" onClick={() => setAnswering("accept")}>
            Accept their changes
          </Button>
          <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={() => setAnswering("counter")}>
            Counter back
          </Button>
          <Button variant="ghost" className="min-h-11 sm:min-h-9" onClick={() => setAnswering("keep")}>
            Keep the offer as it is
          </Button>
        </div>
      )}
      {open && body.type === "counter" && answering === "keep" && (
        <KeepOffer workerId={workerId} workerName={workerName} partiesKey={partiesKey} agreementId={body.agreementId} onClose={() => setAnswering(null)} />
      )}
      {open && body.type === "counter" && (answering === "accept" || answering === "counter") && (
        <ReviseOffer workerId={workerId} proposal={body.proposal} mode={answering} onClose={() => setAnswering(null)} />
      )}
    </div>
  );
}

const FREQUENCY_LABEL: Record<Terms["frequency"], string> = {
  weekly: "every week",
  biweekly: "every two weeks",
  semimonthly: "twice a month",
  monthly: "every month",
};

/** The offer this business sent, as the person received it: the books' own copy, files included. */
function SentOffer({ terms, files }: { terms: Terms; files: AttachmentRef[] | undefined }) {
  const { readAttachment } = useOpenBooks();
  const rate = formatCents(BigInt(terms.rate));
  const offered = terms.version === 2 ? terms.files : [];
  const saved = new Map((files ?? []).map((f) => [f.sha256, f]));
  const allSaved = offered.length > 0 && offered.every((f) => saved.has(f.sha256));
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="text-xs text-muted-foreground">
        Sent {terms.offeredAt.slice(0, 10)} · {terms.payType === "hourly" ? `${rate} an hour` : `${rate} a year`}, paid {FREQUENCY_LABEL[terms.frequency]} · starts{" "}
        {terms.startDate}
      </div>
      {terms.version === 2 && <div className="text-xs text-muted-foreground">Open until {terms.expiresAt.slice(0, 10)}</div>}
      {terms.version === 2 && terms.workWeek && <div className="text-xs text-muted-foreground">Work week: {workWeekSummary(terms.workWeek)}</div>}
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md border bg-background p-3 font-sans text-sm">{terms.termsText}</pre>
      {terms.version === 2 && <LetterSections letter={terms.letter} />}
      <OfferFileList
        files={offered}
        {...(allSaved ? { read: (i: number) => readAttachment(saved.get(offered[i]!.sha256)!) } : {})}
        missing="The files aren't saved on this device."
      />
    </div>
  );
}
