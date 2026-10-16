"use client";

// ---------------------------------------------------------------------------
// The offer letter on screen, the same on every page that shows one: the
// business's review before sending, its saved copy on the team list, and the
// person's offer and agreement. A letter written in the single box shows as
// "Offer letter"; an older one shows each section it has under its heading.
// Files (only on offers sent before files were dropped) are opened on this
// device only: the bytes come from the vault into a temporary link that
// saves the file; nothing is framed or uploaded.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { FileText } from "lucide-react";
import { Button } from "@pnw/ui/button";
import { FormError, errorMessage } from "./AuthCard";
import { LETTER_LABEL, LETTER_SECTIONS, type Letter, type OfferFile, fileLabel } from "./offer_letter";

/** The letter the business wrote: the single box as "Offer letter", or an older letter's sections, each under its heading. */
export function LetterSections({ letter }: { letter: Letter | undefined }) {
  if (!letter) return null;
  const written = LETTER_SECTIONS.filter((s) => letter[s.key].trim() !== "");
  if (written.length === 0) return null;
  const single = written.length === 1 && written[0]!.key === "description";
  return (
    <div className="flex flex-col gap-3">
      {written.map((s) => (
        <section key={s.key} className="flex flex-col gap-1">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{single ? LETTER_LABEL : s.label}</h4>
          <p className="whitespace-pre-wrap text-sm">{letter[s.key]}</p>
        </section>
      ))}
    </div>
  );
}

/** Saves bytes to the device under `name`, through a link that's gone a moment later. */
function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * The offer's files, each with a Save button. `read(i)` gives file i's bytes
 * (from the vault, or the picked file before sending); leave it out when the
 * files aren't on this device, and the list says so.
 */
export function OfferFileList({ files, read, missing }: { files: readonly OfferFile[]; read?: (index: number) => Promise<Blob>; missing?: string }) {
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (files.length === 0) return null;

  async function save(i: number) {
    if (!read) return;
    setBusy(i);
    setError(null);
    try {
      saveBlob(await read(i), files[i]!.name);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Attached files</h4>
      <ul className="flex flex-col divide-y rounded-md border bg-background text-sm">
        {files.map((f, i) => (
          <li key={f.sha256} className="flex items-center gap-3 px-3 py-2">
            <FileText aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{fileLabel(f)}</span>
            {read && (
              <Button type="button" variant="ghost" size="sm" className="min-h-11 sm:min-h-8" disabled={busy !== null} onClick={() => void save(i)}>
                {busy === i ? "Opening…" : "Save"}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {!read && missing && <p className="text-xs text-muted-foreground">{missing}</p>}
      <FormError message={error} />
    </div>
  );
}
