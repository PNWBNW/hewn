"use client";

import { useState, type ReactNode } from "react";
import { useBooks } from "./BooksProvider";
import { RestoreScreen } from "./RestoreScreen";
import { SetupScreen } from "./SetupScreen";
import { UnlockScreen } from "./UnlockScreen";

/** Nothing inside renders until the books are open. */
export function BooksGate({ children }: { children: ReactNode }) {
  const { status } = useBooks();
  const [restoring, setRestoring] = useState(false);

  if (status === "loading") {
    return <div className="grid min-h-dvh place-items-center text-sm text-muted-foreground">Opening…</div>;
  }
  if (status !== "open" && restoring) {
    return <RestoreScreen replacing={status === "locked"} onCancel={() => setRestoring(false)} />;
  }
  if (status === "new") return <SetupScreen onRestore={() => setRestoring(true)} />;
  if (status === "locked") return <UnlockScreen onRestore={() => setRestoring(true)} />;
  return <>{children}</>;
}
