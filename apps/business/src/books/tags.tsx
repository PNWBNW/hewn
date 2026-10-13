// Project, class and location pickers for form lines, and the names behind
// the tag ids that journal lines carry. Names live only in the vault.

import { type Dimensions, type TagKind, type Tags, TAG_KINDS, tagOptions } from "@pnw/ledger";
import { cn } from "@pnw/ui/utils";
import { inputClass } from "./AuthCard";

/** id → name for every project, class and location. */
export function tagNameMap(dims: Dimensions): Map<string, string> {
  return new Map([...dims.projects, ...dims.classes, ...dims.locations].map((t) => [t.id, t.name]));
}

/** "Kitchen remodel · Residential" for a line's tags, or "" when it has none. */
export function tagSummary(tags: Tags | undefined, names: Map<string, string>): string {
  if (!tags) return "";
  return TAG_KINDS.flatMap(({ id }) => (tags[id] ? [names.get(tags[id]!) ?? tags[id]!] : [])).join(" · ");
}

/** Kinds that have something to pick, so a business with no classes never sees a class picker. */
export function usedKinds(dims: Dimensions, kinds: TagKind[] = ["project", "class", "location"]): TagKind[] {
  return kinds.filter((k) => tagOptions(dims, k).length > 0);
}

/** Drops empty picks: an untagged line stays exactly as it was before tags existed. */
export function pickedTags(tags: Tags): Tags | undefined {
  const out: Tags = {};
  for (const k of ["project", "class", "location"] as const) if (tags[k]) out[k] = tags[k];
  return Object.keys(out).length ? out : undefined;
}

/**
 * One native select per kind in use. Closed projects and inactive classes
 * stay selectable only when the line already has them.
 */
export function TagFields({
  dims,
  value,
  onChange,
  kinds,
  labelPrefix,
  className,
}: {
  dims: Dimensions;
  value: Tags;
  onChange: (tags: Tags) => void;
  kinds?: TagKind[];
  /** For screen readers when several lines share a form: "Line 2". */
  labelPrefix?: string;
  className?: string;
}) {
  const shown = usedKinds(dims, kinds);
  if (shown.length === 0) return null;
  return (
    <div className={cn("grid gap-3 sm:grid-cols-3", className)}>
      {shown.map((kind) => {
        const meta = TAG_KINDS.find((k) => k.id === kind)!;
        const options = tagOptions(dims, kind).filter((o) => o.open || o.id === value[kind]);
        return (
          <label key={kind} className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{meta.label}</span>
            <select
              className={inputClass}
              aria-label={labelPrefix ? `${labelPrefix} ${meta.label.toLowerCase()}` : meta.label}
              value={value[kind] ?? ""}
              onChange={(e) => onChange({ ...value, [kind]: e.target.value || undefined })}
            >
              <option value="">No {meta.label.toLowerCase()}</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                  {o.open ? "" : " (closed)"}
                </option>
              ))}
            </select>
          </label>
        );
      })}
    </div>
  );
}
