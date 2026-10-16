"use client";

// Messages, the person's side: one private conversation with each business
// they have an offer or an agreement with, sealed to the two of them. The list
// comes from the vault; a conversation loads its code only when opened.

import { Suspense, useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, Megaphone, RefreshCw, Users } from "lucide-react";
import { Button } from "@pnw/ui/button";
import { Card, CardContent } from "@pnw/ui/card";
import { cn } from "@pnw/ui/utils";
import { useWork } from "@/books/BooksProvider";
import { markPostsRead, unreadPosts } from "@/books/channels";
import { coworkerTag, coworkersFrom } from "@/books/directory";
import { type Thread, preview, unreadIn } from "@/books/thread";
import { updateWorkChannels, updateWorkThread, workThread } from "@/books/work";
import { PageHeader } from "@/shell/SectionView";
import { employerLabel } from "../shared";

const Conversation = dynamic(() => import("@/chain/Conversation"), { ssr: false, loading: () => <p className="text-sm text-muted-foreground">Loading…</p> });
const MessagesCheck = dynamic(() => import("@/chain/work/MessagesCheck"), { ssr: false });
const Directory = dynamic(() => import("@/chain/work/Directory"), { ssr: false, loading: () => <p className="text-sm text-muted-foreground">Loading…</p> });
const GroupChat = dynamic(() => import("@/chain/work/GroupChat"), { ssr: false, loading: () => <p className="text-sm text-muted-foreground">Loading…</p> });
const CoworkerChat = dynamic(() => import("@/chain/work/CoworkerChat"), { ssr: false, loading: () => <p className="text-sm text-muted-foreground">Loading…</p> });

const stamp = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

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
  const channelId = params.get("channel");
  const coworker = params.get("coworker");
  const groupId = params.get("group");
  const at = params.get("at");
  const [check, setCheck] = useState<{ run: number } | { done: string | null }>({ run: 0 });
  const finished = useCallback((message: string | null) => setCheck({ done: message }), []);
  // One conversation per business: its agreements share a key. Offers withdrawn before acceptance don't count.
  // The address bar names a conversation by one of its agreement ids, never by its key.
  const byKey = new Map<string, { partiesKey: string; name: string; ref: string; address: string }>();
  for (const a of work.agreements) {
    if (a.status === "terminated" && !a.acceptedAt) continue;
    if (!byKey.has(a.partiesKey)) byKey.set(a.partiesKey, { partiesKey: a.partiesKey, name: employerLabel(a), ref: a.agreementId, address: a.employerAddress });
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

  const channels = work.channels ?? [];
  // The directory is for people who work there: an accepted agreement, not just an offer.
  const working = people.filter((p) => work.agreements.some((a) => a.partiesKey === p.partiesKey && (a.status === "active" || a.status === "paused")));
  const channel = channels.find((c) => c.id === channelId);
  // Opening a channel marks its posts read.
  useEffect(() => {
    if (!channel || !channel.posts.some((p) => !p.read)) return;
    void updateWork((w) => updateWorkChannels(w, (all) => all.map((c) => (c === channel || (c.id === channel.id && c.partiesKey === channel.partiesKey) ? markPostsRead(c) : c))));
  }, [channel, updateWork]);

  // A coworker conversation: named by the coworker's tag and the agreement it's under, never by a key.
  const atBusiness = people.find((p) => p.ref === at);
  const mate = atBusiness && coworker ? coworkersFrom(workThread(work, atBusiness.partiesKey)).find((c) => coworkerTag(c.publicKey) === coworker) : undefined;
  if (atBusiness && groupId) {
    return (
      <div className="flex flex-col gap-4">
        <Link href="/work/messages" className="inline-flex min-h-11 items-center gap-1 self-start text-sm font-medium sm:min-h-9">
          <ChevronLeft aria-hidden className="size-4" /> All messages
        </Link>
        <GroupChat key={groupId} businessKey={atBusiness.partiesKey} groupId={groupId} />
      </div>
    );
  }

  if (atBusiness && mate) {
    return (
      <div className="flex flex-col gap-4">
        <Link href="/work/messages" className="inline-flex min-h-11 items-center gap-1 self-start text-sm font-medium sm:min-h-9">
          <ChevronLeft aria-hidden className="size-4" /> All messages
        </Link>
        <CoworkerChat key={mate.publicKey} businessKey={atBusiness.partiesKey} publicKey={mate.publicKey} name={mate.name} />
      </div>
    );
  }

  if (channel) {
    const from = people.find((p) => p.partiesKey === channel.partiesKey);
    return (
      <div className="flex flex-col gap-4">
        <Link href="/work/messages" className="inline-flex min-h-11 items-center gap-1 self-start text-sm font-medium sm:min-h-9">
          <ChevronLeft aria-hidden className="size-4" /> All messages
        </Link>
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Megaphone aria-hidden className="size-4" /> {channel.name}
          </h2>
          <p className="text-xs text-muted-foreground">Announcements from {from?.name ?? "the business"}</p>
        </div>
        {channel.left && <p className="text-xs text-muted-foreground">You&apos;re no longer in this channel; what&apos;s here stays on your device.</p>}
        <ol className="flex flex-col gap-3">
          {channel.posts.length === 0 && <li className="text-sm text-muted-foreground">Nothing posted yet. Tap Check on Messages to look for new posts.</li>}
          {[...channel.posts].reverse().map((p) => (
            <li key={p.id} className="flex flex-col gap-1 rounded-md border bg-card p-3">
              <p className="whitespace-pre-wrap text-sm">{p.text}</p>
              <span className="text-xs text-muted-foreground">{stamp(p.sentAt)}</span>
            </li>
          ))}
        </ol>
        {from && (
          <Link href={`/work/messages?with=${from.ref}`} className="text-sm font-medium text-primary underline underline-offset-4">
            Reply privately to {from.name}
          </Link>
        )}
      </div>
    );
  }

  if (open) {
    return (
      <div className="flex flex-col gap-4">
        <Link href="/work/messages" className="inline-flex min-h-11 items-center gap-1 self-start text-sm font-medium sm:min-h-9">
          <ChevronLeft aria-hidden className="size-4" /> All messages
        </Link>
        <Conversation key={open.partiesKey} side="worker" partiesKey={open.partiesKey} title={open.name} thread={open.thread} update={update} offersHref="/work/offers" peer={open.address} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Messages"
        summary="Announcements and private conversations with the businesses you work with."
        action={
          "done" in check ? (
            <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={() => setCheck({ run: Date.now() })}>
              <RefreshCw aria-hidden /> Check
            </Button>
          ) : undefined
        }
      />
      {"run" in check && people.length > 0 && <MessagesCheck key={check.run} onFinished={finished} />}
      {"run" in check && people.length > 0 && <p className="text-xs text-muted-foreground">Checking for new messages…</p>}
      {"done" in check && check.done && <p className="text-xs text-muted-foreground">{check.done}</p>}

      {channels.length > 0 && (
        <Card>
          <CardContent className="flex flex-col gap-2 pt-6">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Megaphone aria-hidden className="size-4" /> Announcements
            </h2>
            <ul className="divide-y">
              {channels.map((c) => {
                const unread = unreadPosts(c);
                return (
                  <li key={`${c.partiesKey.slice(0, 8)}:${c.id}`}>
                    <Link href={`/work/messages?channel=${c.id}`} className="flex min-h-14 items-center gap-3 py-3">
                      <span className="min-w-0 flex-1">
                        <span className={cn("block truncate text-sm", unread > 0 ? "font-semibold" : "font-medium")}>{c.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{c.posts.at(-1)?.text ?? (c.left ? "You left this channel" : "Nothing posted yet")}</span>
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
          </CardContent>
        </Card>
      )}

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
      {working.length > 0 && (
        <Card>
          <CardContent className="flex flex-col gap-4 pt-6">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Users aria-hidden className="size-4" /> Coworkers
            </h2>
            {working.map((b) => (
              <section key={b.partiesKey} className="flex flex-col gap-2">
                {working.length > 1 && <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{b.name}</h3>}
                <Directory businessKey={b.partiesKey} businessName={b.name} agreementRef={b.ref} />
              </section>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

const last = (t: Thread | undefined) => t?.items.at(-1)?.sentAt;
