// ---------------------------------------------------------------------------
// A transaction id as a link to the public explorer, so anyone can see that
// it went through on chain (Joshua, 2026-10-26). Only a network id (`at1…`)
// links; anything else (a wallet's own id while it's still on its way) shows
// as plain text. The explorer opens in a new tab and learns nothing but the
// id, which is public already.
// ---------------------------------------------------------------------------

const ON_CHAIN = /^at1[02-9ac-hj-np-z]{58}$/;

/** The explorer's page for a transaction, on `network` (testnet unless it says mainnet); null for an id that isn't one. */
export function transactionUrl(id: string, network = "testnet"): string | null {
  if (!ON_CHAIN.test(id)) return null;
  return `https://${network === "mainnet" ? "" : "testnet."}explorer.provable.com/transaction/${id}`;
}

export function TxLink({ id, network, className }: { id: string; network?: string; className?: string }) {
  const url = transactionUrl(id, network);
  const style = `break-all font-mono text-xs text-muted-foreground ${className ?? ""}`;
  if (!url) return <span className={style}>{id}</span>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={`${style} underline underline-offset-4`} title="See it on the explorer">
      {id}
    </a>
  );
}
