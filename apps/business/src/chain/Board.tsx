"use client";

// ---------------------------------------------------------------------------
// The job board as anyone reads it: the newest open postings from the chain,
// featured ones first, with a search box and filters on the facts. Reads
// only public mappings and the registry's reverse resolver; nothing about
// the reader leaves the browser, and no account is needed. Loaded through a
// dynamic import from the board page.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, RefreshCw, Star } from "lucide-react";
import { Button } from "@pnw/ui/button";
import { Card, CardContent } from "@pnw/ui/card";
import { cn } from "@pnw/ui/utils";
import { inputClass } from "@/books/AuthCard";
import { EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_LABEL, PAY_TYPES, PAY_TYPE_LABEL, PLACES, PLACE_LABEL, factsLine, payLine } from "@/books/jobs";
import { BRAND } from "@/brand";
import { type BoardEntry, type BoardFilter, boardReads, filterBoard, loadBoard } from "./board";
import { featuredDaysLeft } from "./jobs";

export type BoardProps = { viewer: "visitor" | "worker" | "business" };

type Loaded = { entries: BoardEntry[]; height: number; total: number };

export default function Board({ viewer }: BoardProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState(0);
  const [filter, setFilter] = useState<BoardFilter>({ text: "", employmentType: "", place: "", payType: "" });
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    void loadBoard(boardReads())
      .then((r) => live && setLoaded(r))
      .catch(() => live && setError("The board couldn't be read right now. Try again in a moment."));
    return () => {
      live = false;
    };
  }, [run]);

  const shown = loaded ? filterBoard(loaded.entries, filter) : [];
  const filtering = !!(filter.text?.trim() || filter.employmentType || filter.place || filter.payType);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto_auto]">
        <input
          className={inputClass}
          type="search"
          placeholder="Search titles, places, businesses…"
          aria-label="Search the board"
          value={filter.text ?? ""}
          onChange={(e) => setFilter({ ...filter, text: e.target.value })}
        />
        <select className={inputClass} aria-label="Kind of work" value={filter.employmentType ?? ""} onChange={(e) => setFilter({ ...filter, employmentType: e.target.value as BoardFilter["employmentType"] })}>
          <option value="">Any kind</option>
          {EMPLOYMENT_TYPES.filter((t) => t !== "unstated").map((t) => (
            <option key={t} value={t}>
              {EMPLOYMENT_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        <select className={inputClass} aria-label="Where" value={filter.place ?? ""} onChange={(e) => setFilter({ ...filter, place: e.target.value as BoardFilter["place"] })}>
          <option value="">Anywhere</option>
          {PLACES.filter((t) => t !== "unstated").map((t) => (
            <option key={t} value={t}>
              {PLACE_LABEL[t]}
            </option>
          ))}
        </select>
        <select className={inputClass} aria-label="Pay" value={filter.payType ?? ""} onChange={(e) => setFilter({ ...filter, payType: e.target.value as BoardFilter["payType"] })}>
          <option value="">Any pay</option>
          {PAY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t === "hidden" ? "Pay not shown" : `Paid ${PAY_TYPE_LABEL[t].toLowerCase()}`}
            </option>
          ))}
        </select>
        <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={() => setRun((n) => n + 1)} disabled={loaded === null && error === null}>
          <RefreshCw aria-hidden /> Refresh
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {loaded === null && !error && <p className="text-sm text-muted-foreground">Reading the board…</p>}

      {loaded && (
        <Card>
          <CardContent className="pt-6">
            {shown.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {loaded.entries.length === 0 ? "Nothing posted yet. The first postings will show up here." : filtering ? "Nothing matches that. Clear a filter or two." : ""}
              </p>
            ) : (
              <ul className="divide-y">
                {shown.map((e) => {
                  const expanded = open === e.id;
                  const name = e.businessName ? `${e.businessName}.${BRAND.nameSuffix}` : "A business";
                  return (
                    <li key={e.id} className="py-4">
                      <button type="button" className="flex w-full items-start justify-between gap-3 text-left" onClick={() => setOpen(expanded ? null : e.id)} aria-expanded={expanded}>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2 text-sm font-medium">
                            {e.featured && <Star aria-label="Featured" className="size-4 shrink-0 text-primary" />}
                            <span className="truncate">{e.body?.title ?? "A posting this app can't read"}</span>
                          </span>
                          <span className="block text-xs text-muted-foreground">{[name, e.body?.location, payLine(e.facts), factsLine(e.facts)].filter(Boolean).join(" · ")}</span>
                        </span>
                        {expanded ? <ChevronUp aria-hidden className="size-4 shrink-0 text-muted-foreground" /> : <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
                      </button>
                      {expanded && (
                        <div className="mt-3 flex flex-col gap-3">
                          {e.body ? (
                            <p className="whitespace-pre-wrap text-sm leading-6">{e.body.description}</p>
                          ) : (
                            <p className="text-sm text-muted-foreground">This posting was written for a newer version of the app.</p>
                          )}
                          <p className={cn("text-xs text-muted-foreground")}>
                            {e.featured ? `Featured for about ${featuredDaysLeft(e.featuredUntil, loaded.height)} more ${featuredDaysLeft(e.featuredUntil, loaded.height) === 1 ? "day" : "days"}. ` : ""}
                            Posted at block {e.postedHeight.toLocaleString("en-US")}.
                          </p>
                          <Apply viewer={viewer} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
      {loaded && loaded.total > loaded.entries.length && (
        <p className="text-xs text-muted-foreground">
          Showing the newest {loaded.entries.length} open {loaded.entries.length === 1 ? "posting" : "postings"} of {loaded.total.toLocaleString("en-US")} ever posted.
        </p>
      )}
    </div>
  );
}

function Apply({ viewer }: BoardProps) {
  if (viewer === "business") return null;
  if (viewer === "visitor") {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/" className="inline-flex min-h-11 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 sm:min-h-9">
          Open {BRAND.name} to apply
        </Link>
        <span className="text-xs text-muted-foreground">Applying is private: your name, a message and your resume go only to the business.</span>
      </div>
    );
  }
  return <p className="text-xs text-muted-foreground">Applying from here comes next.</p>;
}
