"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@pnw/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@pnw/ui/tabs";
import { PageHeader } from "@/shell/SectionView";
import { ProjectsTab } from "./ProjectsTab";
import { TagsTab } from "./TagsTab";

export default function ProjectsPage() {
  const [tab, setTab] = useState("projects");
  const [adding, setAdding] = useState(false);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Projects"
        summary="Income and costs for each job, so you know which ones pay."
        action={
          <Button
            className="min-h-11 sm:min-h-9"
            onClick={() => {
              setTab("projects");
              setAdding(true);
            }}
          >
            <Plus aria-hidden />
            New project
          </Button>
        }
      />
      <Tabs value={tab} onValueChange={setTab} className="flex flex-col gap-4">
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList className="h-auto sm:h-9">
            <TabsTrigger value="projects" className="min-h-11 sm:min-h-7">Projects</TabsTrigger>
            <TabsTrigger value="tags" className="min-h-11 whitespace-nowrap sm:min-h-7">Classes &amp; locations</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="projects">
          <ProjectsTab adding={adding} setAdding={setAdding} />
        </TabsContent>
        <TabsContent value="tags">
          <TagsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
