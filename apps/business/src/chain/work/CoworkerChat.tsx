"use client";

// ---------------------------------------------------------------------------
// A private conversation with one coworker: the key only the two of you can
// make (chain/coworkers.ts), the shared conversation screen in coworker mode
// (its own slots, plain messages only; letters to their account, which the
// business's directory carries), the registered name the chain confirms for
// that account (chain/coworker_names.ts), and the safety code to compare in
// person as a second check.
// Nothing here logs a key or a message.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { Lock, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button } from "@pnw/ui/button";
import { FormError, errorMessage } from "@/books/AuthCard";
import { useWork } from "@/books/BooksProvider";
import type { Thread, ThreadItem } from "@/books/thread";
import { coworkersFrom } from "@/books/directory";
import { updateCoworker, workThread } from "@/books/work";
import Conversation from "../Conversation";
import { COWORKER_KINDS, coworkerAccepts, mySide, pairKey, safetyCode } from "../coworkers";
import { type ShownName, confirmedLabel, useConfirmedNames } from "../confirmed_names";

/** Their one-to-one messages, report notices and answers to invitations; group messages show in the group. */
const onlyText = (i: ThreadItem) => ["text", "report_notice", "event_key", "event_answer"].includes(i.body.type);

export type CoworkerChatProps = { businessKey: string; publicKey: string; name: string };

export default function CoworkerChat({ businessKey, publicKey, name }: CoworkerChatProps) {
  const { work, updateWork } = useWork();
  const identity = work.identities?.[businessKey];
  const [key, setKey] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const thread = work.coworkers?.[publicKey];
  // Their account, from the latest list the business passed on.
  const address = coworkersFrom(workThread(work, businessKey)).find((c) => c.publicKey === publicKey)?.address;
  const chainName = useConfirmedNames([address], "person").get(address ?? "");

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
  // Messages go as letters to their account; a directory from before accounts were listed has none.
  if (!address) return <p className="text-sm text-muted-foreground">{name}&apos;s account isn&apos;t in your copy of the directory yet. Ask the business to send the coworker directory again, then you can message them.</p>;
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
        show={onlyText}
        peer={address}
        subtitle={<WhoThisIs shown={chainName} name={name} checked={!!verified} />}
      />
      <details className="rounded-md border p-3 text-sm" open={showCode} onToggle={(e) => setShowCode(e.currentTarget.open)}>
        <summary className="min-h-11 cursor-pointer font-medium sm:min-h-0">{verified ? "Safety code (checked)" : "Check the safety code with " + name}</summary>
        <div className="mt-2 flex flex-col gap-2">
          <p className="font-mono text-lg tracking-wider">{code}</p>
          <p className="text-xs text-muted-foreground">
            Next time you&apos;re together, open this on both phones. If the numbers match, nobody, the business included, is in the middle of your conversation.
            Their confirmed name above already shows the account is theirs; this is a second check.
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

/** Under the conversation's title: whose account this is, as far as the chain confirms it. */
function WhoThisIs({ shown, name, checked }: { shown: ShownName | undefined; name: string; checked: boolean }) {
  if (shown?.status === "unexpected") {
    return (
      <p className="flex items-start gap-1 text-xs text-destructive">
        <TriangleAlert aria-hidden className="mt-0.5 size-3 shrink-0" />
        This account belongs to a business ({confirmedLabel(shown.name)}), not a person. Check with {name} in person before you send anything private.
      </p>
    );
  }
  if (shown?.status === "confirmed") {
    return (
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <ShieldCheck aria-hidden className="size-3 shrink-0" />
        {confirmedLabel(shown.name)}, confirmed on chain{checked ? " and checked in person" : ""}: only the two of you can read this
      </p>
    );
  }
  return (
    <p className="flex items-center gap-1 text-xs text-muted-foreground">
      <Lock aria-hidden className="size-3 shrink-0" />
      {shown?.status === "unconfirmed" ? "Only their account can read this. Their name isn't confirmed on chain yet" : "Only their account can read this. Checking their name on chain…"}
    </p>
  );
}
