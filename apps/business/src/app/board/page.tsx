"use client";

// The job board: every open posting, for anyone, with or without an account.
// The list is read straight from the public record (no server of ours); the
// code that reads it loads only here.

import dynamic from "next/dynamic";
import { useBooks } from "@/books/BooksProvider";
import { PageHeader } from "@/shell/SectionView";

const loading = () => <p className="text-sm text-muted-foreground">Loading the board…</p>;
const Board = dynamic(() => import("@/chain/Board"), { ssr: false, loading });

export default function BoardPage() {
  const { status, role } = useBooks();
  const viewer = status !== "open" ? "visitor" : role === "worker" ? "worker" : "business";
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Job board"
        summary={
          viewer === "business"
            ? "Every open posting, as people see it. Yours are under Jobs."
            : "Jobs posted by businesses here. Anyone can read them; applying is private, between you and the business."
        }
      />
      <Board viewer={viewer} />
    </div>
  );
}
