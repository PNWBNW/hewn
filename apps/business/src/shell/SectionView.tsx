"use client";

/** The title and one-line summary at the top of every screen, with its primary action on the right. */
export function PageHeader({
  title,
  summary,
  action,
}: {
  title: string;
  summary: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{summary}</p>
      </div>
      {action}
    </div>
  );
}
