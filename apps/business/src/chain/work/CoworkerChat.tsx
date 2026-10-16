"use client";

// ---------------------------------------------------------------------------
// A private conversation with one coworker: the key only the two of you can
// make (chain/coworkers.ts), the shared conversation screen in coworker mode
// (its own slots, plain messages only), and the safety code to compare in
// person. Nothing here logs a key or a message.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { Lock, ShieldCheck } from "lucide-react";
import { Button } from "@pnw/ui/button";
import { FormError, errorMessage } from "@/books/AuthCard";
import { useWork } from "@/books/BooksProvider";
import type { Thread } from "@/books/thread";
import { updateCoworker } from "@/books/work";
import Conversation from "../Conversation";
import { COWORKER_KINDS, coworkerAccepts, mySide, pairKey, safetyCode } from "../coworkers";

export type CoworkerChatProps = { businessKey: string; publicKey: string; name: string };

export default function CoworkerChat({ businessKey, publicKey, name }: CoworkerChatProps) {
  const { work, updateWork } = useWork();
  const identity = work.identities?.[businessKey];
  const [key, setKey] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const thread = work.coworkers?.[publicKey];

  useEffect(() => {
    if (!identity) return;
    let live = true;
    Promise.all([pairKey(identity, publicKey), safetyCode(identity.publicKey, publicKey)]).then(
      ([k, c]) => live && (setKey(k), setCode(c)),
      (e: unknown) => live && setError(errorMessage(e)),
    );
    return () => {
      live = false;
    };
  }, [identity, publicKey]);

  const update = useCallback(
    async (change: (t: Thread) => Thread) => {
      await updateWork((w) => updateCoworker(w, publicKey, { businessKey, name }, (t) => ({ ...t, ...change(t) })));
    },
    [updateWork, publicKey, businessKey, name],
  );

  if (!identity) return <FormError message="Join the coworker directory first." />;
  if (error) return <FormError message={error} />;
  if (!key) return <p className="text-sm text-muted-foreground">Opening…</p>;

  const verified = thread?.verifiedAt;
  return (
    <div className="flex flex-col gap-3">
      <Conversation
        side={mySide(identity.publicKey, publicKey)}
        partiesKey={key}
        title={name}
        thread={thread}
        update={update}
        offersHref="/work/offers"
        kinds={COWORKER_KINDS}
        accept={coworkerAccepts}
        subtitle={
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            {verified ? <ShieldCheck aria-hidden className="size-3" /> : <Lock aria-hidden className="size-3" />}
            {verified ? "Checked in person: only the two of you can read this" : "Only the two of you can read this"}
          </p>
        }
      />
      <details className="rounded-md border p-3 text-sm" open={showCode} onToggle={(e) => setShowCode(e.currentTarget.open)}>
        <summary className="min-h-11 cursor-pointer font-medium sm:min-h-0">{verified ? "Safety code (checked)" : "Check the safety code with " + name}</summary>
        <div className="mt-2 flex flex-col gap-2">
          <p className="font-mono text-lg tracking-wider">{code}</p>
          <p className="text-xs text-muted-foreground">
            Next time you&apos;re together, open this on both phones. If the numbers match, nobody, the business included, is in the middle of your conversation.
          </p>
          {!verified && (
            <Button
              variant="outline"
              className="min-h-11 self-start sm:min-h-9"
              onClick={() => void updateWork((w) => updateCoworker(w, publicKey, { businessKey, name }, (t) => ({ ...t, verifiedAt: new Date().toISOString() })))}
            >
              The numbers match
            </Button>
          )}
        </div>
      </details>
    </div>
  );
}
