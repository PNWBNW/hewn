import { type Account, type BaseType, type Books, ACCOUNT_TYPES, baseOf, compareAccounts, formatCents } from "@pnw/ledger";
import { cn } from "@pnw/ui/utils";

export const BASE_LABELS: Record<BaseType, string> = {
  asset: "Assets",
  liability: "Liabilities",
  equity: "Equity",
  income: "Income",
  expense: "Expenses",
};

export const BASE_ORDER: BaseType[] = ["asset", "liability", "equity", "income", "expense"];

/** Money in a table cell: tabular, right-aligned by the caller; negatives get a sign and colour. */
export function Money({ cents, className, blankZero }: { cents: bigint; className?: string; blankZero?: boolean }) {
  if (blankZero && cents === 0n) return <span className={className} />;
  return <span className={cn("tabular-nums", cents < 0n && "text-money-negative", className)}>{formatCents(cents)}</span>;
}

/** Accounts in chart order: by statement section, then parents before their children. */
export function orderedAccounts(books: Books, filter: (a: Account) => boolean = () => true) {
  const byParent = new Map<string | undefined, Account[]>();
  for (const a of books.accounts) {
    const list = byParent.get(a.parentId) ?? [];
    list.push(a);
    byParent.set(a.parentId, list);
  }
  const out: { account: Account; depth: number }[] = [];
  const walk = (parent: string | undefined, depth: number) => {
    for (const a of (byParent.get(parent) ?? []).sort(compareAccounts)) {
      if (filter(a)) out.push({ account: a, depth });
      walk(a.id, depth + 1);
    }
  };
  walk(undefined, 0);
  return BASE_ORDER.flatMap((base) => out.filter(({ account }) => baseOf(account) === base));
}

export function accountLabel(a: Account): string {
  return a.number ? `${a.number} · ${a.name}` : a.name;
}

/** A native select of accounts grouped by statement section: accessible and phone-friendly. */
export function AccountSelect({
  books,
  value,
  onChange,
  filter,
  className,
  placeholder = "Choose an account",
  id,
  ariaLabel,
}: {
  books: Books;
  value: string;
  onChange: (id: string) => void;
  filter?: (a: Account) => boolean;
  className?: string;
  placeholder?: string;
  id?: string;
  ariaLabel?: string;
}) {
  const rows = orderedAccounts(books, filter);
  return (
    <select id={id} aria-label={ariaLabel} className={className} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {BASE_ORDER.map((base) => {
        const group = rows.filter(({ account }) => baseOf(account) === base);
        if (group.length === 0) return null;
        return (
          <optgroup key={base} label={BASE_LABELS[base]}>
            {group.map(({ account, depth }) => (
              <option key={account.id} value={account.id}>
                {"  ".repeat(depth)}
                {accountLabel(account)}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}

export const typeLabel = (a: Account) => ACCOUNT_TYPES[a.type].label;

/** Today's date in the user's own time zone, as YYYY-MM-DD. */
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
