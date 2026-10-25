"use client";

// A customer's side of the app lives under /customer and only renders on a
// customer's vault (docs/CUSTOMERS.md, decision 17); any other account lands
// here only by a stale link, and the shell is already sending it home.

import type { ReactNode } from "react";
import { useOpenBooks } from "@/books/BooksProvider";

export default function CustomerLayout({ children }: { children: ReactNode }) {
  const { role, customer } = useOpenBooks();
  if (role !== "customer" || !customer) return null;
  return <>{children}</>;
}
