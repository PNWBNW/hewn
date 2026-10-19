"use client";

// Jobs: the business's postings on the public board, and what happens to
// each (change it, feature it, close it). The list comes from the vault;
// posting and the rest load their sending code only when used.

import { useState } from "react";
import dynamic from "next/dynamic";
import { Plus, Star } from "lucide-react";
import { Button } from "@pnw/ui/button";
import { Card, CardContent } from "@pnw/ui/card";
import { cn } from "@pnw/ui/utils";
import { useOpenBooks } from "@/books/BooksProvider";
import { type JobPosting, factsLine, listPostings, payLine } from "@/books/jobs";
import { PageHeader } from "@/shell/SectionView";

const loading = () => <p className="text-sm text-muted-foreground">Loading…</p>;
const JobPanel = dynamic(() => import("@/chain/JobPanel"), { ssr: false, loading });

type Open = { mode: "new" } | { mode: "edit" | "feature" | "close"; posting: JobPosting };

export default function JobsPage() {
  const { jobs, rail } = useOpenBooks();
  const [open, setOpen] = useState<Open | null>(null);
  const postings = listPostings(jobs ?? undefined);
  const named = !!rail?.businessNameHash;
  const close = () => setOpen(null);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Jobs"
        summary="Your postings on the public job board. Anyone can read them; applications come to you privately."
        action={
          open === null ? (
            <Button className="min-h-11 sm:min-h-9" disabled={!named} onClick={() => setOpen({ mode: "new" })}>
              <Plus aria-hidden /> New posting
            </Button>
          ) : undefined
        }
      />
      {!named && <p className="text-sm text-muted-foreground">Register your business name in Settings first; postings go on the board under it.</p>}
      {open?.mode === "new" && <JobPanel mode="new" onClose={close} />}

      <Card>
        <CardContent className="pt-6">
          {postings.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing posted yet. A posting costs $1 and stays up until you close it. People apply with their name, a message and a resume, and each one
              shows up in Messages.
            </p>
          ) : (
            <ul className="divide-y">
              {postings.map((p) => (
                <li key={p.id} className="flex flex-col gap-3 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className={cn("flex items-center gap-2 text-sm font-medium", p.closedAt && "text-muted-foreground")}>
                        {p.featuredUntil && !p.closedAt ? <Star aria-label="Featured" className="size-4 text-primary" /> : null}
                        <span className="truncate">{p.title}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">{[p.location, payLine(p.facts), factsLine(p.facts)].filter(Boolean).join(" · ")}</div>
                      <div className="text-xs text-muted-foreground">
                        {p.closedAt ? `Closed ${day(p.closedAt)}` : `Posted ${day(p.postedAt)}${p.updatedAt ? `, changed ${day(p.updatedAt)}` : ""}`}
                      </div>
                    </div>
                    {!p.closedAt && open === null && (
                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" className="min-h-11 sm:min-h-8" onClick={() => setOpen({ mode: "edit", posting: p })}>
                          Change
                        </Button>
                        <Button variant="outline" size="sm" className="min-h-11 sm:min-h-8" onClick={() => setOpen({ mode: "feature", posting: p })}>
                          <Star aria-hidden /> Feature
                        </Button>
                        <Button variant="outline" size="sm" className="min-h-11 sm:min-h-8" onClick={() => setOpen({ mode: "close", posting: p })}>
                          Close
                        </Button>
                      </div>
                    )}
                  </div>
                  {open !== null && open.mode !== "new" && open.posting.id === p.id && <JobPanel mode={open.mode} posting={open.posting} onClose={close} />}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        The board shows featured postings first, then the newest. Featuring costs $5 a day, up to 30 days ahead; changing or closing a posting is free.
      </p>
    </div>
  );
}

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
