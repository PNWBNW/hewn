"use client";

// Who someone is on the registry, inside a form: their name.hewn and account
// once found, or the lookup to find them. Team members, customers and vendors
// are added only by their registered name (Joshua, 2026-10-15), so every
// add form starts here. The lookup itself loads only when it is shown.

import { useState } from "react";
import dynamic from "next/dynamic";
import { Button } from "@pnw/ui/button";
import { type Registered, shortAddress } from "./rail";
import { BRAND } from "@/brand";

const NameLookup = dynamic(() => import("@/chain/NameLookup"), {
  ssr: false,
  loading: () => <p className="text-xs text-muted-foreground">Loading…</p>,
});

export type RegistryKind = "worker" | "business";

export function RegistryField({
  allow,
  value,
  onChange,
  label,
  hint,
  locked,
}: {
  allow: readonly RegistryKind[];
  /** Who they are, once found. */
  value: Registered | undefined;
  onChange: (who: Registered | undefined) => void;
  label: string;
  hint?: string;
  /** An offered or linked party keeps its account: no changing it here. */
  locked?: boolean;
}) {
  const [changing, setChanging] = useState(false);

  if (value && !changing) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/40 px-3 py-2 text-sm">
        <span className="font-medium">
          {value.name}.{BRAND.nameSuffix}
        </span>
        <span className="font-mono text-xs text-muted-foreground">{shortAddress(value.address)}</span>
        {!locked && (
          <Button type="button" variant="ghost" size="sm" className="ml-auto min-h-11 sm:min-h-8" onClick={() => setChanging(true)}>
            Change
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <NameLookup
        allow={allow}
        label={label}
        hint={hint}
        onChange={(entry) => {
          if (!entry) return;
          onChange({ address: entry.address, nameHash: entry.nameHash, name: entry.name });
          setChanging(false);
        }}
      />
      {changing && value && (
        <Button type="button" variant="ghost" size="sm" className="min-h-11 self-start sm:min-h-8" onClick={() => setChanging(false)}>
          Keep {value.name}.{BRAND.nameSuffix}
        </Button>
      )}
    </div>
  );
}
