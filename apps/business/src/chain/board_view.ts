// ---------------------------------------------------------------------------
// The board as people read it: the newest postings from the chain, in board
// order, with each business's name from the registry's reverse resolver, and
// the filters on the facts. Pure apart from the injected reads.
// ---------------------------------------------------------------------------

import { queryNamePlaintext } from "@pnw/records/registry/name_registry";
import type { EmploymentType, PayType, Place } from "../books/jobs";
import { type BoardPosting, type JobsRead, boardOrder, explorerJobsRead, readRecent } from "./jobs";
import { fetchLatestHeight } from "./offer";

/** How many postings a page reads at most: the newest; older ones are closed or long filled. */
export const BOARD_DEPTH = 100;

export type BoardEntry = BoardPosting & {
  /** The business's registered name, without its suffix; empty when the registry holds no plaintext for it. */
  businessName: string;
  featured: boolean;
};

export type BoardReads = {
  read: JobsRead;
  height: () => Promise<number>;
  /** A registered name's plaintext, or null. */
  name: (nameHash: string) => Promise<string | null>;
};

export const boardReads = (): BoardReads => ({ read: explorerJobsRead(), height: () => fetchLatestHeight(), name: (h) => queryNamePlaintext(h) });

/** The open postings in board order, with names; a name that can't be read is left empty, not an error. */
export async function loadBoard(reads: BoardReads, depth = BOARD_DEPTH): Promise<{ entries: BoardEntry[]; height: number; total: number }> {
  const [height, { postings, total }] = await Promise.all([reads.height(), readRecent(reads.read, depth)]);
  const names = new Map<string, string>();
  for (const hash of new Set(postings.map((p) => p.employerNameHash))) {
    let name: string | null = null;
    try {
      name = await reads.name(hash);
    } catch {
      name = null;
    }
    names.set(hash, name ?? "");
  }
  const entries = boardOrder(postings, height).map((p) => ({ ...p, businessName: names.get(p.employerNameHash) ?? "", featured: p.featuredUntil > height }));
  return { entries, height, total };
}

export type BoardFilter = {
  /** Words to look for in the title, location, description or business name; any case. */
  text?: string;
  employmentType?: EmploymentType | "";
  place?: Place | "";
  payType?: PayType | "";
};

const words = (text: string | undefined): string[] => (text ?? "").toLowerCase().split(/\s+/).filter(Boolean);

/** The entries matching every part of the filter that is set. Every word in `text` must appear somewhere. */
export function filterBoard(entries: readonly BoardEntry[], filter: BoardFilter): BoardEntry[] {
  const needles = words(filter.text);
  return entries.filter((e) => {
    if (filter.employmentType && e.facts.employmentType !== filter.employmentType) return false;
    if (filter.place && e.facts.place !== filter.place) return false;
    if (filter.payType && e.facts.payType !== filter.payType) return false;
    if (needles.length === 0) return true;
    const hay = [e.body?.title, e.body?.location, e.body?.description, e.businessName].filter(Boolean).join("\n").toLowerCase();
    return needles.every((n) => hay.includes(n));
  });
}
