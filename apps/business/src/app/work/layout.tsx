"use client";

// The person's side of the app lives under /work and only renders on a
// worker's vault; a business's books land here only by a stale link, and
// the shell is already sending them home.

import type { ReactNode } from "react";
import { useOpenBooks } from "@/books/BooksProvider";

export default function WorkLayout({ children }: { children: ReactNode }) {
  const { role, work } = useOpenBooks();
  if (role !== "worker" || !work) return null;
  return <>{children}</>;
}
