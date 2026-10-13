// ---------------------------------------------------------------------------
// Dimensions: projects (jobs), classes and locations, all unlimited.
//
// A journal line carries only tag ids (`Line.tags`), and those ids are part
// of the entry hash. The names behind them, and which customer a project is
// for, live here, inside the encrypted vault next to the books, so the books
// themselves never hold a project or class name.
//
// Reports by tag are ordinary statements over the lines that carry the tag:
// an invoice line, a bill line or a paycheck's wage and employer-tax lines
// tagged with a project all land in that project's profit and loss. A void
// reverses the same tagged lines, so it nets out of the project too.
// ---------------------------------------------------------------------------

import { baseOf } from "./accounts";
import type { Books, Entry, Tags } from "./books";
import type { Cents } from "./money";
import { assertDate } from "./periods";
import { type DateRange, type ProfitAndLoss, profitAndLoss } from "./statements";

// ---- Types -----------------------------------------------------------------

export type TagKind = keyof Tags;

export const TAG_KINDS: { id: TagKind; label: string; plural: string }[] = [
  { id: "project", label: "Project", plural: "Projects" },
  { id: "class", label: "Class", plural: "Classes" },
  { id: "location", label: "Location", plural: "Locations" },
];

export type ProjectStatus = "active" | "closed";

export type Project = { id: string; name: string; customerId?: string; status: ProjectStatus };

/** A class or a location. */
export type Tag = { id: string; name: string; active: boolean };

export type Dimensions = {
  version: 1;
  projects: Project[];
  classes: Tag[];
  locations: Tag[];
  nextProject: number;
  nextClass: number;
  nextLocation: number;
};

export const emptyDimensions = (): Dimensions => ({
  version: 1,
  projects: [],
  classes: [],
  locations: [],
  nextProject: 1,
  nextClass: 1,
  nextLocation: 1,
});

export class DimensionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DimensionError";
  }
}

const fail = (message: string): never => {
  throw new DimensionError(message);
};

// ---- Lists -----------------------------------------------------------------

function cleanName(name: string, others: { id: string; name: string }[], what: string, selfId?: string): string {
  const n = name.trim();
  if (!n) fail(`Every ${what} needs a name`);
  if (others.some((o) => o.id !== selfId && o.name.toLowerCase() === n.toLowerCase())) fail(`"${n}" is already on your list`);
  return n;
}

export function addProject(dims: Dimensions, input: { name: string; customerId?: string }): { dims: Dimensions; project: Project } {
  const project: Project = {
    id: `proj-${dims.nextProject}`,
    name: cleanName(input.name, dims.projects, "project"),
    ...(input.customerId ? { customerId: input.customerId } : {}),
    status: "active",
  };
  return { dims: { ...dims, projects: [...dims.projects, project], nextProject: dims.nextProject + 1 }, project };
}

/** `customerId: null` takes the customer off the project. */
export function updateProject(
  dims: Dimensions,
  id: string,
  changes: { name?: string; customerId?: string | null; status?: ProjectStatus },
): Dimensions {
  const current = dims.projects.find((p) => p.id === id) ?? fail("Project not found");
  if (changes.status && changes.status !== "active" && changes.status !== "closed") fail("A project is active or closed");
  const customerId = changes.customerId === undefined ? current.customerId : changes.customerId ?? undefined;
  const next: Project = {
    id,
    name: changes.name === undefined ? current.name : cleanName(changes.name, dims.projects, "project", id),
    ...(customerId ? { customerId } : {}),
    status: changes.status ?? current.status,
  };
  return { ...dims, projects: dims.projects.map((p) => (p.id === id ? next : p)) };
}

type ListKind = "class" | "location";
const LIST = { class: ["classes", "nextClass", "class"], location: ["locations", "nextLocation", "loc"] } as const;

export function addTag(dims: Dimensions, kind: ListKind, input: { name: string }): { dims: Dimensions; tag: Tag } {
  const [list, counter, prefix] = LIST[kind];
  const tag: Tag = { id: `${prefix}-${dims[counter]}`, name: cleanName(input.name, dims[list], kind), active: true };
  return { dims: { ...dims, [list]: [...dims[list], tag], [counter]: dims[counter] + 1 }, tag };
}

export function updateTag(dims: Dimensions, kind: ListKind, id: string, changes: { name?: string; active?: boolean }): Dimensions {
  const [list] = LIST[kind];
  const current = dims[list].find((t) => t.id === id) ?? fail(`That ${kind} wasn't found`);
  const next: Tag = {
    id,
    name: changes.name === undefined ? current.name : cleanName(changes.name, dims[list], kind, id),
    active: changes.active ?? current.active,
  };
  return { ...dims, [list]: dims[list].map((t) => (t.id === id ? next : t)) };
}

/** Everything of one kind, as {id, name, open}: open means it can be picked for new postings. */
export function tagOptions(dims: Dimensions, kind: TagKind): { id: string; name: string; open: boolean }[] {
  if (kind === "project") return dims.projects.map((p) => ({ id: p.id, name: p.name, open: p.status === "active" }));
  return dims[LIST[kind][0]].map((t) => ({ id: t.id, name: t.name, open: t.active }));
}

/** Drops blank tags; undefined when nothing is left, so untagged lines hash exactly as before. */
export function cleanTags(tags: Tags | undefined): Tags | undefined {
  if (!tags) return undefined;
  const out: Tags = {};
  for (const k of ["class", "location", "project"] as const) {
    const v = tags[k];
    if (v === undefined || v === "") continue;
    if (typeof v !== "string" || v.trim() !== v) fail(`That ${k} tag isn't valid`);
    out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

// ---- Reports by tag ------------------------------------------------------------

/**
 * The books with every line that doesn't carry the tag taken out. Entries
 * stop balancing, which is fine for income and expense totals; it's a view
 * for reports, never something to post to or save.
 */
export function linesTagged(books: Books, kind: TagKind, id: string): Books {
  const entries: Entry[] = [];
  for (const e of books.entries) {
    const lines = e.lines.filter((l) => l.tags?.[kind] === id);
    if (lines.length) entries.push({ ...e, lines });
  }
  return { ...books, entries };
}

/** A profit and loss of only the lines tagged `id` (a project, class or location). */
export function profitAndLossForTag(books: Books, kind: TagKind, id: string, range: DateRange, compare?: DateRange): ProfitAndLoss {
  return profitAndLoss(linesTagged(books, kind, id), range, compare);
}

export type TagProfit = {
  tagId: string;
  /** Income plus other income. */
  income: Cents;
  costOfGoodsSold: Cents;
  /** Expenses plus other expenses, including payroll wages and employer taxes. */
  expenses: Cents;
  profit: Cents;
  /** Profit as a share of income, in basis points (2550 = 25.5%); null with no income. */
  marginBp: number | null;
};

/** Profit ÷ income in basis points, rounded half away from zero. */
export function marginBp(profit: Cents, income: Cents): number | null {
  if (income === 0n) return null;
  const scaled = profit * 10000n;
  const q = scaled / income;
  const r = scaled % income;
  const neg = (scaled < 0n) !== (income < 0n);
  const abs = (x: bigint) => (x < 0n ? -x : x);
  return Number(abs(r) * 2n >= abs(income) ? q + (neg ? -1n : 1n) : q);
}

/**
 * One summary row per tag of `kind` with anything in the range, plus the
 * total of all of them. Untagged lines aren't counted. Rows come back in
 * first-posted order; `ids` adds rows (at zero) for tags with no activity.
 */
export function profitByTag(
  books: Books,
  kind: TagKind,
  range: DateRange,
  ids: string[] = [],
): { rows: TagProfit[]; total: TagProfit } {
  const from = assertDate(range.from);
  const to = assertDate(range.to);
  const accounts = new Map(books.accounts.map((a) => [a.id, a]));
  const sums = new Map<string, { income: Cents; cogs: Cents; expenses: Cents }>();
  const row = (id: string) => {
    let s = sums.get(id);
    if (!s) sums.set(id, (s = { income: 0n, cogs: 0n, expenses: 0n }));
    return s;
  };
  for (const id of ids) row(id);
  for (const e of books.entries) {
    if (e.date < from || e.date > to) continue;
    for (const l of e.lines) {
      const id = l.tags?.[kind];
      const acct = accounts.get(l.accountId);
      if (!id || !acct) continue;
      const base = baseOf(acct);
      if (base === "income") row(id).income += l.credit - l.debit;
      else if (acct.type === "cost_of_goods_sold") row(id).cogs += l.debit - l.credit;
      else if (base === "expense") row(id).expenses += l.debit - l.credit;
    }
  }
  const summary = (tagId: string, income: Cents, costOfGoodsSold: Cents, expenses: Cents): TagProfit => {
    const profit = income - costOfGoodsSold - expenses;
    return { tagId, income, costOfGoodsSold, expenses, profit, marginBp: marginBp(profit, income) };
  };
  const rows = [...sums].map(([id, s]) => summary(id, s.income, s.cogs, s.expenses));
  const add = (f: (r: TagProfit) => Cents) => rows.reduce((t, r) => t + f(r), 0n);
  return {
    rows,
    total: summary(
      "",
      add((r) => r.income),
      add((r) => r.costOfGoodsSold),
      add((r) => r.expenses),
    ),
  };
}

// ---- Saving --------------------------------------------------------------------

const FORMAT = "pnw-dimensions";

export function dimensionsToJson(dims: Dimensions): string {
  return JSON.stringify({ format: FORMAT, dimensions: dims });
}

export function dimensionsFromJson(text: string): Dimensions {
  const doc = JSON.parse(text) as { format?: string; dimensions?: Dimensions };
  if (doc?.format !== FORMAT || doc.dimensions?.version !== 1) throw new DimensionError("Not project and class data from this app, or a newer version");
  return doc.dimensions;
}
