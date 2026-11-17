"use client";

// Which conversation or bill a page shows is kept in the page's fragment (the
// part of the address after `#`), never in its query. A fragment stays in the
// browser: opening a conversation or a bill loads nothing, and the names and
// ids that choose it are part of no request (security/no_ids_in_links.test.ts).
//
// `useHashParams()` reads the fragment as search params; `setHashParams()`
// changes it as a new history entry (back and forward still move between
// conversations); `HashLink` is a link to a fragment on the same page. A link
// from another page is a plain `<Link href="/messages#client=…" prefetch={false}>`.

import { type MouseEvent, type ReactNode, createElement, useEffect, useMemo, useSyncExternalStore } from "react";
import Link from "next/link";

/** Fired when this module changes the fragment: pushState fires no event of its own. */
export const HASH_EVENT = "hewn:hash";

export type HashValues = Readonly<Record<string, string | null | undefined>>;

/** The fragment as search params: `#coworker=t1` reads as coworker "t1". */
export function parseHash(hash: string): URLSearchParams {
  return new URLSearchParams(hash.replace(/^#/, ""));
}

/** A fragment for these values (empty ones left out), with its `#`, or "" when there are none. */
export function hashFor(values: HashValues): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value != null && value !== "") params.set(key, value);
  const text = params.toString();
  return text ? `#${text}` : "";
}

export function subscribeHash(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  window.addEventListener("popstate", onChange);
  window.addEventListener(HASH_EVENT, onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(HASH_EVENT, onChange);
  };
}

export const readHash = (): string => window.location.hash;
// The server has no fragment: a page renders its list first and opens the selection in the browser.
const serverHash = (): string => "";

/** Shows these values in the fragment, keeping the path and query as they are. */
export function setHashParams(values: HashValues, { replace = false }: { replace?: boolean } = {}): void {
  const { pathname, search } = window.location;
  const url = `${pathname}${search}${hashFor(values)}`;
  if (replace) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
  window.dispatchEvent(new Event(HASH_EVENT));
}

/**
 * An old link that named its selection in the query moves it into the fragment,
 * once, in place (the history entry is replaced, so the query doesn't stay in it).
 * Returns whether anything moved.
 */
export function moveQueryToHash(keys: readonly string[]): boolean {
  const { pathname, search, hash } = window.location;
  const query = new URLSearchParams(search);
  const fragment = parseHash(hash);
  let moved = false;
  for (const key of keys) {
    const value = query.get(key);
    if (value === null) continue;
    if (!fragment.has(key)) fragment.set(key, value);
    query.delete(key);
    moved = true;
  }
  if (!moved) return false;
  const rest = query.toString();
  const text = fragment.toString();
  window.history.replaceState(null, "", `${pathname}${rest ? `?${rest}` : ""}${text ? `#${text}` : ""}`);
  window.dispatchEvent(new Event(HASH_EVENT));
  return true;
}

/**
 * The page's fragment as search params, kept current on back, forward and
 * `setHashParams`. `oldQueryKeys`: keys an older link may still carry in the
 * query, moved into the fragment when the page opens.
 */
export function useHashParams(oldQueryKeys: readonly string[] = []): URLSearchParams {
  const hash = useSyncExternalStore(subscribeHash, readHash, serverHash);
  const keys = oldQueryKeys.join(",");
  useEffect(() => {
    if (keys) moveQueryToHash(keys.split(","));
  }, [keys]);
  return useMemo(() => parseHash(hash), [hash]);
}

const plainClick = (e: MouseEvent<HTMLAnchorElement>) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

/**
 * A link to a selection on this page (`path` is the page's own). A plain click
 * changes the fragment without loading anything; opening it in a new tab or
 * copying it gives the same page with the same selection.
 */
export function HashLink({ path, values, className, children }: { path: string; values: HashValues; className?: string; children: ReactNode }) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || !plainClick(e)) return;
    e.preventDefault();
    setHashParams(values);
    window.scrollTo(0, 0);
  };
  return createElement(Link, { href: `${path}${hashFor(values)}`, prefetch: false, className, onClick }, children);
}
