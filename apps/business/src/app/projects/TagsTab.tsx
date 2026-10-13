"use client";

// Classes and locations: unlimited lists of other ways to slice the books
// (departments, lines of business, sites). Rename or deactivate; a tag is
// never deleted, because posted lines still carry its id.

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { type Books, type Tag, addTag, updateTag } from "@pnw/ledger";
import { Button } from "@pnw/ui/button";
import { cn } from "@pnw/ui/utils";
import { FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";

type Kind = "class" | "location";

/** How many entries carry each tag id (any kind). */
function entryCounts(books: Books): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of books.entries) {
    const ids = new Set(e.lines.flatMap((l) => [l.tags?.class, l.tags?.location].filter((t): t is string => !!t)));
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

export function TagsTab() {
  const { books, dimensions } = useOpenBooks();
  const counts = useMemo(() => entryCounts(books), [books]);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <TagList kind="class" title="Classes" hint="Departments or lines of business, like Residential and Commercial." items={dimensions.classes} counts={counts} />
      <TagList kind="location" title="Locations" hint="Shops, sites or regions." items={dimensions.locations} counts={counts} />
    </div>
  );
}

function TagList({ kind, title, hint, items, counts }: { kind: Kind; title: string; hint: string; items: Tag[]; counts: Map<string, number> }) {
  const { updateCompany } = useOpenBooks();
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(op: Parameters<typeof updateCompany>[0]) {
    setError(null);
    try {
      await updateCompany(op);
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    }
  }

  return (
    <section aria-labelledby={`${kind}-heading`} className="flex flex-col gap-3">
      <div>
        <h2 id={`${kind}-heading`} className="text-base font-semibold">
          {title}
        </h2>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run((c) => ({ ...c, dimensions: addTag(c.dimensions, kind, { name }).dims }))) setName("");
        }}
      >
        <input
          className={inputClass}
          placeholder={`New ${kind}`}
          aria-label={`New ${kind} name`}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" variant="outline" className="h-11 shrink-0 sm:h-10" disabled={!name.trim()}>
          <Plus aria-hidden />
          Add
        </Button>
      </form>
      <FormError message={error} />
      {items.length === 0 ? (
        <p className="rounded-lg border bg-card px-4 py-6 text-center text-sm text-muted-foreground">None yet.</p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border bg-card">
          {items.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
              {renaming?.id === t.id ? (
                <form
                  className="flex flex-1 gap-2"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (await run((c) => ({ ...c, dimensions: updateTag(c.dimensions, kind, t.id, { name: renaming.name }) }))) setRenaming(null);
                  }}
                >
                  <input
                    className={inputClass}
                    aria-label={`Rename ${t.name}`}
                    value={renaming.name}
                    onChange={(e) => setRenaming({ id: t.id, name: e.target.value })}
                    autoFocus
                  />
                  <Button type="submit" size="sm" className="min-h-11 sm:min-h-9">
                    Save
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="min-h-11 sm:min-h-9" onClick={() => setRenaming(null)}>
                    Cancel
                  </Button>
                </form>
              ) : (
                <>
                  <span className={cn("min-w-0 flex-1 text-sm", !t.active && "text-muted-foreground line-through")}>{t.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {counts.get(t.id) ?? 0} {(counts.get(t.id) ?? 0) === 1 ? "entry" : "entries"}
                  </span>
                  <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-8" onClick={() => setRenaming({ id: t.id, name: t.name })}>
                    Rename
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="min-h-11 text-muted-foreground sm:min-h-8"
                    onClick={() => run((c) => ({ ...c, dimensions: updateTag(c.dimensions, kind, t.id, { active: !t.active }) }))}
                  >
                    {t.active ? "Deactivate" : "Reactivate"}
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
