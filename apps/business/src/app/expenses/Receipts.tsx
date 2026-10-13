"use client";

// Receipt photos and PDFs on bills. Files are sealed into the vault the
// moment they're picked; the bill keeps only a reference. Viewing decrypts
// on this device into a temporary object URL: images show inline, PDFs are
// saved with a download link (the page never frames anything).

import { useEffect, useRef, useState } from "react";
import { FileText, Paperclip, X } from "lucide-react";
import type { AttachmentRef } from "@pnw/sales";
import { Button } from "@pnw/ui/button";
import { cn } from "@pnw/ui/utils";
import { FormError, errorMessage } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A button-sized label around a hidden file input; seals each picked file and hands back its reference. */
export function AttachButton({ onAttached, label = "Attach receipt" }: { onAttached: (ref: AttachmentRef) => Promise<void> | void; label?: string }) {
  const { addAttachment, discardAttachment } = useOpenBooks();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function picked(files: FileList | null) {
    setError(null);
    setBusy(true);
    try {
      for (const file of Array.from(files ?? [])) {
        const ref = await addAttachment(file);
        try {
          await onAttached(ref);
        } catch (e) {
          await discardAttachment(ref.attachmentId);
          throw e;
        }
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label
        className={cn(
          "inline-flex min-h-11 cursor-pointer items-center gap-2 self-start rounded-md border bg-card px-4 text-sm font-medium shadow-sm hover:bg-accent focus-within:ring-2 focus-within:ring-ring sm:min-h-9",
          busy && "pointer-events-none opacity-60",
        )}
      >
        <Paperclip aria-hidden className="size-4" />
        {busy ? "Encrypting…" : label}
        <input
          ref={input}
          type="file"
          accept="image/*,application/pdf"
          capture="environment"
          className="sr-only"
          onChange={(e) => void picked(e.target.files)}
        />
      </label>
      <FormError message={error} />
    </div>
  );
}

/** The files on a bill, each viewable; optionally removable. */
export function ReceiptList({ refs, onRemove }: { refs: AttachmentRef[]; onRemove?: (ref: AttachmentRef) => void }) {
  const [viewing, setViewing] = useState<string | null>(null);
  if (refs.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2">
      {refs.map((ref) => (
        <li key={ref.attachmentId} className="rounded-md border bg-card">
          <div className="flex flex-wrap items-center gap-2 px-3 py-1">
            {ref.type === "application/pdf" ? <FileText aria-hidden className="size-4 shrink-0" /> : <Paperclip aria-hidden className="size-4 shrink-0" />}
            <span className="min-w-0 flex-1 truncate text-sm">{ref.name}</span>
            <span className="text-xs text-muted-foreground">{formatSize(ref.size)}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-11 sm:min-h-8"
              aria-expanded={viewing === ref.attachmentId}
              onClick={() => setViewing((v) => (v === ref.attachmentId ? null : ref.attachmentId))}
            >
              {viewing === ref.attachmentId ? "Hide" : "View"}
            </Button>
            {onRemove && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-h-11 text-muted-foreground sm:min-h-8"
                aria-label={`Remove ${ref.name}`}
                onClick={() => onRemove(ref)}
              >
                <X aria-hidden />
              </Button>
            )}
          </div>
          {viewing === ref.attachmentId && <ReceiptViewer fileRef={ref} />}
        </li>
      ))}
    </ul>
  );
}

/** Decrypts one file into an object URL for as long as it's on screen. */
function ReceiptViewer({ fileRef }: { fileRef: AttachmentRef }) {
  const { readAttachment } = useOpenBooks();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let made: string | null = null;
    let live = true;
    readAttachment(fileRef).then(
      (blob) => {
        made = URL.createObjectURL(blob);
        if (live) setUrl(made);
        else URL.revokeObjectURL(made);
      },
      (e) => live && setError(errorMessage(e)),
    );
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [fileRef, readAttachment]);

  return (
    <div className="border-t p-3">
      <FormError message={error} />
      {!url && !error && <p className="text-sm text-muted-foreground">Decrypting…</p>}
      {url && fileRef.type.startsWith("image/") && (
        // eslint-disable-next-line @next/next/no-img-element -- a decrypted blob, not a static asset
        <img src={url} alt={`Receipt: ${fileRef.name}`} className="mx-auto max-h-[28rem] w-auto max-w-full rounded border" />
      )}
      {url && (
        <a href={url} download={fileRef.name} className="mt-2 inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4 sm:min-h-8">
          {fileRef.type === "application/pdf" ? "Download the PDF" : "Save a copy"}
        </a>
      )}
    </div>
  );
}
