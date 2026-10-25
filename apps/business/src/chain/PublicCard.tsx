"use client";

// ---------------------------------------------------------------------------
// A card anyone can open, from its name (docs/HEWN_ART.md): the business's
// map or the worker's land, drawn here from public reads only
// (public_card.ts). No account and no Shield: a visitor types a name or
// arrives by a shared link (/card?name=dayco). Loaded through a dynamic
// import from the card page, so nobody who never opens one downloads it.
// Nothing here logs a name or a result.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy } from "lucide-react";
import { Button } from "@pnw/ui/button";
import { Field, FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { publicCardPath } from "@/books/card";
import { BRAND } from "@/brand";
import BusinessCardArt from "@/cards/BusinessCardArt";
import WorkerCardArt from "@/cards/WorkerCardArt";
import { bareDirectoryName } from "./directory";
import { type PublicCard as Found, lookupPublicCard } from "./public_card";

export type PublicCardProps = {
  /** The name from the address; empty when none was given. */
  name: string;
};

type State = { kind: "idle" } | { kind: "finding" } | { kind: "found"; found: Found } | { kind: "failed"; message: string };

export default function PublicCard({ name }: PublicCardProps) {
  const router = useRouter();
  const [text, setText] = useState(name);
  const [state, setState] = useState<State>({ kind: name.trim() ? "finding" : "idle" });

  useEffect(() => {
    setText(name);
    if (!name.trim()) {
      setState({ kind: "idle" });
      return;
    }
    let live = true;
    setState({ kind: "finding" });
    lookupPublicCard(name, BRAND.nameSuffix)
      .then((found) => live && setState({ kind: "found", found }))
      .catch((e) => live && setState({ kind: "failed", message: errorMessage(e) }));
    return () => {
      live = false;
    };
  }, [name]);

  function find() {
    const typed = text.trim();
    if (!typed) return;
    router.push(publicCardPath(bareDirectoryName(typed, BRAND.nameSuffix) || typed));
  }

  return (
    <div className="flex flex-col gap-6">
      <Field label="Whose card?" hint={`A registered name, like dayco.${BRAND.nameSuffix}. Exact names only: there is no list to browse.`}>
        <div className="flex gap-2">
          <input
            className={inputClass}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                find();
              }
            }}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            placeholder={`name.${BRAND.nameSuffix}`}
            aria-label="Name"
          />
          <Button type="button" variant="outline" className="min-h-11 whitespace-nowrap sm:min-h-10" disabled={!text.trim() || state.kind === "finding"} onClick={find}>
            {state.kind === "finding" ? "Finding…" : "Find"}
          </Button>
        </div>
      </Field>
      {state.kind === "finding" && (
        <p className="text-sm text-muted-foreground" role="status">
          Finding {bareDirectoryName(name, BRAND.nameSuffix) || name}.{BRAND.nameSuffix}…
        </p>
      )}
      {state.kind === "failed" && <FormError message={state.message} />}
      {state.kind === "found" && <Result found={state.found} />}
    </div>
  );
}

function Result({ found }: { found: Found }) {
  const full = `${found.name}.${BRAND.nameSuffix}`;
  if (found.state === "unregistered") {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        No one has registered {full}. Names have to match exactly; check the spelling.
      </p>
    );
  }
  if (found.state === "none") {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        {found.kind === "business" ? `${full} hasn't claimed its card yet.` : `${full} has no public card.`}
      </p>
    );
  }
  const { card, kind, name } = found;
  const since = card.since ? new Date(card.since).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : `block ${card.issuedAt.toLocaleString()}`;
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-8">
      {kind === "business" ? (
        <BusinessCardArt name={name} displayName="" card={card} className="w-full max-w-[320px]" />
      ) : (
        <WorkerCardArt name={name} card={card} view="public" className="w-full max-w-[320px]" />
      )}
      <div className="flex flex-col gap-4">
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-muted-foreground">Name</dt>
          <dd className="font-medium">{full}</dd>
          <dt className="text-muted-foreground">Kind</dt>
          <dd className="font-medium">{kind === "business" ? "Business" : "Person"}</dd>
          <dt className="text-muted-foreground">On {BRAND.name} since</dt>
          <dd className="font-medium">{since}</dd>
        </dl>
        <ShareLink name={name} />
      </div>
    </div>
  );
}

/** The card's address, to pass on; copied when the device allows. */
function ShareLink({ name }: { name: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${BRAND.appUrl}${publicCardPath(name)}`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard here: the address is on screen to copy by hand.
    }
  }
  return (
    <div className="flex flex-col gap-1 text-sm">
      <span className="text-muted-foreground">Share this card</span>
      <div className="flex flex-wrap items-center gap-2">
        <code className="break-all rounded bg-muted px-2 py-1 text-xs">{url}</code>
        <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-8" onClick={() => void copy()}>
          {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          {copied ? "Copied" : "Copy link"}
        </Button>
      </div>
    </div>
  );
}
