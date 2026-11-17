// Which conversation or bill is open is chosen in the page's fragment (the
// part after `#`), never in its query. The fragment stays in the browser, so
// the accounts, workers' ids, coworker tags, agreement and posting ids that
// choose a conversation are part of no request (shell/hash_params.ts).
//
// This scans every link and router call in the app for a query that names one.
// `?tab=`, `?edit=`, `?id=` (local random ids) and `/card?name=` are not here.

import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = join(__dirname, "..", "..");
const SRC = join(APP_ROOT, "src");

// The keys that name a counterparty, a conversation or a bill.
const KEYS = ["client", "with", "coworker", "at", "group", "pay", "bill", "channel"] as const;
// A string or template literal carrying one of them in a query.
const IN_QUERY = new RegExp(`["'\`][^"'\`]*[?&](${KEYS.join("|")})=`);

// A payroll run just posted opens its pay panel by the run's local random id: not a counterparty.
const ALLOWED = [/["'`]\/payroll\?pay=\$\{runId\}`/];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
    return [path];
  });
}

function linksWithIds(text: string): string[] {
  return text
    .split("\n")
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    .filter(({ line }) => IN_QUERY.test(line) && !ALLOWED.some((a) => a.test(line)))
    .map(({ line, n }) => `${n}: ${line}`);
}

describe("links name no one in their query", () => {
  it("finds a query that names a conversation", () => {
    expect(linksWithIds("<Link href={`/messages?client=${encodeURIComponent(a)}`}>")).toHaveLength(1);
    expect(linksWithIds('router.push(`/work/messages?coworker=${tag}&at=${ref}`);')).toHaveLength(1);
    expect(linksWithIds('<Link href="/customer/bills?bill=x">')).toHaveLength(1);
    expect(linksWithIds("<Link href={`/messages#client=${encodeURIComponent(a)}`}>")).toEqual([]);
    expect(linksWithIds('<Link href="/jobs?tab=offers">')).toEqual([]);
    expect(linksWithIds("router.push(onRail ? `/payroll?pay=${runId}` : \"/payroll\");")).toEqual([]);
  });

  it("holds for every link and router call in the app", () => {
    const offenders = sourceFiles(SRC).flatMap((file) => linksWithIds(readFileSync(file, "utf8")).map((hit) => `${relative(APP_ROOT, file)}:${hit}`));
    expect(offenders).toEqual([]);
  });
});
