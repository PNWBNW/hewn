"use client";

// A customer's conversations: one with each business they're connected with,
// sealed to the two of them. The list comes from the vault; a conversation
// loads its Shield code only when opened.

import { Suspense, useCallback } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Card, CardContent } from "@pnw/ui/card";
import { cn } from "@pnw/ui/utils";
import { useCustomer } from "@/books/BooksProvider";
import { connectedIn, updateConnectionThread } from "@/books/connections";
import { type Thread, emptyThread, preview, unreadIn } from "@/books/thread";
import { BRAND } from "@/brand";
import { PageHeader } from "@/shell/SectionView";

const ClientConversation = dynamic(() => import("@/chain/clients/ClientConversation"), { ssr: false, loading: () => <p className="text-sm text-muted-foreground">Loading…</p> });

export default function CustomerMessagesPage() {
  return (
    <Suspense>
      <Messages />
    </Suspense>
  );
}

function Messages() {
  const { customer, updateCustomer } = useCustomer();
  const selected = useSearchParams().get("with");
  const businesses = connectedIn(customer.businesses);
  const open = businesses.find((b) => b.address === selected);

  const update = useCallback(
    async (change: (t: Thread) => Thread) => {
      if (!open) return;
      await updateCustomer((c) => ({ ...c, businesses: updateConnectionThread(c.businesses ?? {}, open.address, change, emptyThread) }));
    },
    [open, updateCustomer],
  );

  if (open) {
    return (
      <div className="flex flex-col gap-4">
        <Link href="/customer/messages" className="inline-flex min-h-11 items-center gap-1 self-start text-sm font-medium sm:min-h-9">
          <ChevronLeft aria-hidden className="size-4" /> All messages
        </Link>
        <ClientConversation key={open.address} side="worker" connection={open} title={`${open.name}.${BRAND.nameSuffix}`} update={update} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Messages" summary="A private conversation with each business you're connected with." />
      <Card>
        <CardContent className="pt-6">
          {businesses.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No conversations yet.{" "}
              <Link href="/customer/businesses" className="underline underline-offset-4">
                Connect with a business
              </Link>{" "}
              to start one.
            </p>
          ) : (
            <ul className="divide-y">
              {businesses.map((b) => {
                const unread = unreadIn(b.thread);
                return (
                  <li key={b.address}>
                    <Link href={`/customer/messages?with=${encodeURIComponent(b.address)}`} className="flex min-h-14 items-center gap-3 py-3">
                      <span className="min-w-0 flex-1">
                        <span className={cn("block truncate text-sm", unread > 0 ? "font-semibold" : "font-medium")}>
                          {b.name}.{BRAND.nameSuffix}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">{b.thread?.items.length ? preview(b.thread.items.at(-1)) : "Connected. Say hello."}</span>
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
