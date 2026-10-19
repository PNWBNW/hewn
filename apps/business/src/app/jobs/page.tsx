"use client";

// Jobs: hiring, in one place. Postings on the public board, who applied to
// each, and what happens to a posting (change it, feature it, close it); and,
// on the Offers tab, the offers sent and the conversation around each
// (Offers.tsx). The list comes from the vault; posting, applicants and the
// rest load their sending and reading code only when used.

import { Suspense, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Plus, Star, Users } from "lucide-react";
import { Button } from "@pnw/ui/button";
import { Card, CardContent } from "@pnw/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@pnw/ui/tabs";
import { cn } from "@pnw/ui/utils";
import { useOpenBooks } from "@/books/BooksProvider";
import { type JobPosting, factsLine, listPostings, payLine } from "@/books/jobs";
import { PageHeader } from "@/shell/SectionView";
import Offers from "./Offers";

const loading = () => <p className="text-sm text-muted-foreground">Loading…</p>;
const JobPanel = dynamic(() => import("@/chain/JobPanel"), { ssr: false, loading });
const Applicants = dynamic(() => import("@/chain/Applicants"), { ssr: false, loading });

type Open = { mode: "new" } | { mode: "edit" | "feature" | "close" | "applicants"; posting: JobPosting };

export default function JobsPage() {
  return (
    <Suspense>
      <JobsScreen />
    </Suspense>
  );
}

function JobsScreen() {
  const params = useSearchParams();
  const asked = params.get("tab");
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Jobs" summary="Your postings on the public job board, who applied, and the offers you've sent." />
      <Tabs defaultValue={asked === "offers" ? "offers" : "postings"} className="flex flex-col gap-4">
        <div className="overflow-x-auto">
          <TabsList>
            <TabsTrigger value="postings" className="min-h-9">Postings</TabsTrigger>
            <TabsTrigger value="offers" className="min-h-9">Offers</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="postings">
          <Postings />
        </TabsContent>
        <TabsContent value="offers">
          <Offers />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** The board side: postings, applicants, and what happens to a posting. */
function Postings() {
  const { jobs, rail } = useOpenBooks();
  const [open, setOpen] = useState<Open | null>(null);
  const postings = listPostings(jobs ?? undefined);
  const named = !!rail?.businessNameHash;
  const close = () => setOpen(null);

  return (
    <div className="flex flex-col gap-4">
      {open === null && (
        <Button className="min-h-11 self-start sm:min-h-9" disabled={!named} onClick={() => setOpen({ mode: "new" })}>
          <Plus aria-hidden /> New posting
        </Button>
      )}
      {!named && <p className="text-sm text-muted-foreground">Register your business name in Settings first; postings go on the board under it.</p>}
      {open?.mode === "new" && <JobPanel mode="new" onClose={close} />}

      <Card>
        <CardContent className="pt-6">
          {postings.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing posted yet. A posting costs $1 and stays up until you close it. People apply with their name, a message and a resume, and each one
              shows up under the posting&apos;s applicants.
            </p>
          ) : (
            <ul className="divide-y">
              {postings.map((p) => {
                const count = p.applicants?.length ?? 0;
                return (
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
                          {count > 0 && ` · ${count} ${count === 1 ? "applicant" : "applicants"}`}
                        </div>
                      </div>
                      {open === null && (
                        <div className="flex flex-wrap gap-2">
                          <Button variant="outline" size="sm" className="min-h-11 sm:min-h-8" onClick={() => setOpen({ mode: "applicants", posting: p })}>
                            <Users aria-hidden /> Applicants
                          </Button>
                          {!p.closedAt && (
                            <>
                              <Button variant="outline" size="sm" className="min-h-11 sm:min-h-8" onClick={() => setOpen({ mode: "edit", posting: p })}>
                                Change
                              </Button>
                              <Button variant="outline" size="sm" className="min-h-11 sm:min-h-8" onClick={() => setOpen({ mode: "feature", posting: p })}>
                                <Star aria-hidden /> Feature
                              </Button>
                              <Button variant="outline" size="sm" className="min-h-11 sm:min-h-8" onClick={() => setOpen({ mode: "close", posting: p })}>
                                Close
                              </Button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                    {open !== null && open.mode === "applicants" && open.posting.id === p.id && <Applicants posting={open.posting} onClose={close} />}
                    {open !== null && open.mode !== "new" && open.mode !== "applicants" && open.posting.id === p.id && (
                      <JobPanel mode={open.mode} posting={open.posting} onClose={close} />
                    )}
                  </li>
                );
              })}
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
