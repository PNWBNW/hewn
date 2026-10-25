"use client";

// ---------------------------------------------------------------------------
// The conversation between a business and a customer, once both hellos are
// in: the shared key is made on this device (chain/clients.ts
// `connectionKey`), then it is the same conversation screen as everywhere
// else, with its own slots and only the kinds of message the two may send,
// under the agreements between them (chain/clients/Agreements.tsx).
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import type { Connection } from "@/books/connections";
import type { Side, Thread } from "@/books/thread";
import { AleoWalletProviderWrapper } from "@pnw/wallet/wallet-provider";
import { CLIENT_KINDS, clientAccepts, connectionKey } from "../clients";
import Conversation from "../Conversation";
import { Agreements } from "./Agreements";

export default function ClientConversation({
  side,
  connection,
  title,
  update,
}: {
  side: Side;
  connection: Connection;
  title: string;
  update: (change: (t: Thread) => Thread) => Promise<void>;
}) {
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    connectionKey(connection).then(
      (k) => live && setKey(k),
      () => live && setError("This conversation's keys don't fit. Ask them to connect again."),
    );
    return () => {
      live = false;
    };
  }, [connection]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!key) return <p className="text-sm text-muted-foreground">Opening…</p>;
  return (
    <div className="flex flex-col gap-4">
      <AleoWalletProviderWrapper>
        <Agreements side={side} connection={connection} partiesKey={key} title={title} update={update} />
      </AleoWalletProviderWrapper>
      <Conversation
      side={side}
      partiesKey={key}
      title={title}
      thread={connection.thread}
      update={update}
      offersHref=""
      kinds={CLIENT_KINDS}
      accept={clientAccepts}
      peer={connection.address}
      subtitle="Sealed to the two of you"
      />
    </div>
  );
}
