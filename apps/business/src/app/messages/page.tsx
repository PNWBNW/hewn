"use client";

// Messages: one private conversation with each team member (and anyone with
// an offer waiting), sealed to the two of you. The list comes from the vault;
// a conversation loads its sending and reading code only when opened.

import { Suspense, useCallback } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Card, CardContent } from "@pnw/ui/card";
import { cn } from "@pnw/ui/utils";
import { useOpenBooks } from "@/books/BooksProvider";
import { emptyMailbox, threadFor, updateThread } from "@/books/mailbox";
import { type Thread, preview, unreadIn } from "@/books/thread";
import { PageHeader } from "@/shell/SectionView";

const Conversation = dynamic(() => import("@/chain/Conversation"), { ssr: false, loading: () => <p className="text-sm text-muted-foreground">Loading…</p> });

export default function MessagesPage() {
  return (
    <Suspense>
      <Messages />
    </Suspense>
  );
}

function Messages() {
  const { rail, payroll, mailbox, updateCompany } = useOpenBooks();
  const params = useSearchParams();
  const selected = params.get("with");
  const names = new Map(payroll.workers.map((w) => [w.id, w.name]));
  // One conversation per person with a key to seal to: linked, or with an offer out.
  const people = (rail?.links ?? [])
    .filter((l) => l.partiesKey && (l.status === "linked" || l.status === "offered"))
    .map((l) => ({ workerId: l.workerId, name: names.get(l.workerId) ?? "A team member", partiesKey: l.partiesKey!, thread: threadFor(mailbox, l.partiesKey!) }))
    .sort((a, b) => (last(b.thread) ?? "").localeCompare(last(a.thread) ?? "") || a.name.localeCompare(b.name));
  const open = people.find((p) => p.workerId === selected);

  const update = useCallback(
    async (change: (t: Thread) => Thread) => {
      if (!open) return;
      await updateCompany((c) => ({ ...c, mailbox: updateThread(c.mailbox ?? emptyMailbox(), open.partiesKey, open.workerId, change) }));
    },
    [open, updateCompany],
  );

  if (open) {
    return (
      <div className="flex flex-col gap-4">
        <Link href="/messages" className="inline-flex min-h-11 items-center gap-1 self-start text-sm font-medium sm:min-h-9">
          <ChevronLeft aria-hidden className="size-4" /> All messages
        </Link>
        <Conversation key={open.partiesKey} side="business" partiesKey={open.partiesKey} title={open.name} thread={open.thread} update={update} offersHref="/mailbox" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Messages" summary="Private conversations with your team. Only the two of you can read each one." />
      <Card>
        <CardContent className="pt-6">
          {people.length === 0 ? (
            <p className="text-sm text-muted-foreground">No one to message yet. Send someone an offer from Payroll → Team, and you can talk here.</p>
          ) : (
            <ul className="divide-y">
              {people.map((p) => {
                const unread = unreadIn(p.thread);
                return (
                  <li key={p.workerId}>
                    <Link href={`/messages?with=${encodeURIComponent(p.workerId)}`} className="flex min-h-14 items-center gap-3 py-3">
                      <span className="min-w-0 flex-1">
                        <span className={cn("block truncate text-sm", unread > 0 ? "font-semibold" : "font-medium")}>{p.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{preview(p.thread?.items.at(-1))}</span>
                      </span>
                      {unread > 0 && (
                        <span className="rounded-full bg-primary px-2 text-xs font-medium text-primary-foreground" aria-label={`${unread} unread`}>
                          {unread}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const last = (t: Thread | undefined) => t?.items.at(-1)?.sentAt;
