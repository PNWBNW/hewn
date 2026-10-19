"use client";

// Applications: the jobs this person applied to on the board, and where each
// stands (what the business last said in the conversation). The list comes
// from the vault; the conversations are under Messages.

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card, CardContent } from "@pnw/ui/card";
import { cn } from "@pnw/ui/utils";
import { useWork } from "@/books/BooksProvider";
import { APPLICATION_STATUS_LABEL } from "@/books/thread";
import { applicationStatus, workThread } from "@/books/work";
import { unreadIn } from "@/books/thread";
import { BRAND } from "@/brand";
import { PageHeader } from "@/shell/SectionView";

export default function ApplicationsPage() {
  const { work } = useWork();
  const applications = work.applications ?? [];
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Applications" summary="The jobs you applied to, and where each one stands. Each is a private conversation with that business." />
      <Card>
        <CardContent className="pt-6">
          {applications.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing yet.{" "}
              <Link href="/board" className="underline underline-offset-4">
                Find work
              </Link>{" "}
              on the board; when you apply, it shows up here.
            </p>
          ) : (
            <ul className="divide-y">
              {applications.map((a) => {
                const status = applicationStatus(work, a);
                const unread = unreadIn(workThread(work, a.partiesKey));
                const done = status === "hired" || status === "not_selected" || status === "closed";
                return (
                  <li key={a.postingId}>
                    <Link href={`/work/messages?with=${a.postingId}`} className="flex min-h-14 items-center gap-3 py-3">
                      <span className="min-w-0 flex-1">
                        <span className={cn("block truncate text-sm", unread > 0 ? "font-semibold" : "font-medium")}>{a.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {a.employerName ? `${a.employerName}.${BRAND.nameSuffix}` : "A business"} · Applied {day(a.sentAt)}
                        </span>
                      </span>
                      <span className={cn("shrink-0 text-xs", done ? "text-muted-foreground" : "text-primary")}>{APPLICATION_STATUS_LABEL[status]}</span>
                      {unread > 0 && (
                        <span className="rounded-full bg-primary px-2 text-xs font-medium text-primary-foreground" aria-label={`${unread} unread`}>
                          {unread}
                        </span>
                      )}
                      <ArrowRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
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

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
