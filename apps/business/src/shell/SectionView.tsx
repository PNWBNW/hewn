"use client";

import { Plus } from "lucide-react";
import { Button } from "@pnw/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@pnw/ui/tabs";
import { Table, TableHead, TableHeader, TableRow } from "@pnw/ui/table";
import { cn } from "@pnw/ui/utils";
import type { Section } from "./sections";

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

/** The primary action, shown but inert until its build phase lands. */
function PendingAction({ label, phase }: { label: string; phase: number }) {
  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <Button disabled className="min-h-11 sm:min-h-9">
        <Plus aria-hidden />
        {label}
      </Button>
      <span className="text-xs text-muted-foreground">Arrives in phase {phase}</span>
    </div>
  );
}

export function SectionView({ section }: { section: Section }) {
  const first = section.tabs[0];
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={section.label}
        summary={section.summary}
        action={<PendingAction label={section.primaryAction} phase={section.phase} />}
      />
      <Tabs defaultValue={first?.id ?? ""} className="flex flex-col gap-4">
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList>
            {section.tabs.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id} className="min-h-9 whitespace-nowrap">
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {section.tabs.map((tab) => (
          <TabsContent key={tab.id} value={tab.id}>
            <div className="overflow-hidden rounded-lg border bg-card">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      {tab.columns.map((col) => (
                        <TableHead
                          key={col.label}
                          className={cn("whitespace-nowrap", col.numeric && "text-right")}
                        >
                          {col.label}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                </Table>
              </div>
              {/* Outside the scrolling table so it wraps to the screen, not the columns. */}
              <p className="mx-auto max-w-md px-6 py-12 text-center text-sm text-muted-foreground">
                {tab.empty}
              </p>
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
