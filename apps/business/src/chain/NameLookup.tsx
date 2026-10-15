"use client";

// ---------------------------------------------------------------------------
// Find someone on the registry by their name: a field, a Find button, and a
// card that says who it is (a person or a business, and its industry) and the
// account it points at. Reads
// public registry data only, so it needs no Shield. Loaded through a dynamic
// import wherever it is used, so nobody who never looks anyone up downloads it.
//
// Names are held on chain as hashes: only an exact name is found, never a
// partial one. Nothing here logs a name, an account or a result.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Button } from "@pnw/ui/button";
import { Field, FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { shortAddress } from "@/books/rail";
import { BRAND } from "@/brand";
import { type DirectoryEntry, type NameKind, entryLabel, lookup, requireKind } from "./directory";

export type NameLookupProps = {
  /** Which kinds of registered name are acceptable here. */
  allow: readonly NameKind[];
  label: string;
  hint?: string;
  /** What was found, or null as soon as the text is changed again. */
  onChange: (entry: DirectoryEntry | null) => void;
  disabled?: boolean;
};

export default function NameLookup({ allow, label, hint, onChange, disabled }: NameLookupProps) {
  const [text, setText] = useState("");
  const [found, setFound] = useState<DirectoryEntry | null>(null);
  const [finding, setFinding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function find() {
    if (!text.trim() || finding) return;
    setError(null);
    setFound(null);
    onChange(null);
    setFinding(true);
    try {
      const entry = requireKind(await lookup(text, BRAND.nameSuffix), allow, BRAND.nameSuffix);
      setFound(entry);
      onChange(entry);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setFinding(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Field label={label} hint={hint}>
        <div className="flex gap-2">
          <input
            className={inputClass}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (found) {
                setFound(null);
                onChange(null);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void find();
              }
            }}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            placeholder={`name.${BRAND.nameSuffix} or aleo1…`}
          />
          <Button type="button" variant="outline" className="min-h-11 whitespace-nowrap sm:min-h-10" disabled={disabled || finding || !text.trim()} onClick={() => void find()}>
            {finding ? "Finding…" : "Find"}
          </Button>
        </div>
      </Field>
      <FormError message={error} />
      {found && <Card entry={found} />}
    </div>
  );
}

function Card({ entry }: { entry: DirectoryEntry }) {
  const business = entry.kind === "business";
  return (
    <div className="flex flex-col gap-1 rounded-md border bg-card p-3 text-sm" role="status">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{entryLabel(entry, BRAND.nameSuffix)}</span>
        <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">{business ? "Business" : "Person"}</span>
      </div>
      {business && entry.industry && <div className="text-xs text-muted-foreground">{entry.industry}</div>}
      <div className="font-mono text-xs text-muted-foreground" title="The registry's account for this name">
        {shortAddress(entry.address)}
      </div>
    </div>
  );
}
