"use client";

// Messages, the person's side: one private conversation with each business
// they have an offer or an agreement with, sealed to the two of them. The list
// comes from the vault; a conversation loads its code only when opened.

import { Suspense, useCallback } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Card, CardContent } from "@pnw/ui/card";
import { cn } from "@pnw/ui/utils";
import { useWork } from "@/books/BooksProvider";
import { type Thread, preview, unreadIn } from "@/books/thread";
import { updateWorkThread, workThread } from "@/books/work";
import { PageHeader } from "@/shell/SectionView";
import { employerLabel } from "../shared";

const Conversation = dynamic(() => import("@/chain/Conversation"), { ssr: false, loading: () => <p className="text-sm text-muted-foreground">Loading…</p> });

export default function WorkMessagesPage() {
  return (
    <Suspense>
      <Messages />
    </Suspense>
  );
}

function Messages() {
  const { work, updateWork } = useWork();
  const params = useSearchParams();
  const selected = params.get("with");
  // One conversation per business: its agreements share a key. Offers withdrawn before acceptance don't count.
  // The address bar names a conversation by one of its agreement ids, never by its key.
  const byKey = new Map<string, { partiesKey: string; name: string; ref: string }>();
  for (const a of work.agreements) {
    if (a.status === "terminated" && !a.acceptedAt) continue;
    if (!byKey.has(a.partiesKey)) byKey.set(a.partiesKey, { partiesKey: a.partiesKey, name: employerLabel(a), ref: a.agreementId });
  }
  const people = [...byKey.values()]
    .map((p) => ({ ...p, thread: workThread(work, p.partiesKey) }))
    .sort((a, b) => (last(b.thread) ?? "").localeCompare(last(a.thread) ?? "") || a.name.localeCompare(b.name));
  const open = people.find((p) => p.ref === selected);

  const update = useCallback(
    async (change: (t: Thread) => Thread) => {
      if (!open) return;
      await updateWork((w) => updateWorkThread(w, open.partiesKey, change));
    },
    [open, updateWork],
  );

  if (open) {
    return (
      <div className="flex flex-col gap-4">
        <Link href="/work/messages" className="inline-flex min-h-11 items-center gap-1 self-start text-sm font-medium sm:min-h-9">
          <ChevronLeft aria-hidden className="size-4" /> All messages
        </Link>
        <Conversation key={open.partiesKey} side="worker" partiesKey={open.partiesKey} title={open.name} thread={open.thread} update={update} offersHref="/work/offers" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Messages" summary="Private conversations with the businesses you work with. Only the two of you can read each one." />
      <Card>
        <CardContent className="pt-6">
          {people.length === 0 ? (
            <p className="text-sm text-muted-foreground">No one to message yet. Once a business sends you an offer (Offers → Check for offers), you can talk here.</p>
          ) : (
            <ul className="divide-y">
              {people.map((p) => {
                const unread = unreadIn(p.thread);
                return (
                  <li key={p.partiesKey}>
                    <Link href={`/work/messages?with=${p.ref}`} className="flex min-h-14 items-center gap-3 py-3">
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
