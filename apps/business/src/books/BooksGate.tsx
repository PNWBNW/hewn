"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useBooks } from "./BooksProvider";
import { FrontPage } from "./FrontPage";
import { RestoreScreen } from "./RestoreScreen";
import { SetupScreen } from "./SetupScreen";

type View = "front" | "setup" | "restore";

/** Nothing inside renders until the books are open. Until then: the front page, or the screen it leads to. */
export function BooksGate({ children }: { children: ReactNode }) {
  const { status } = useBooks();
  const [view, setView] = useState<View>("front");

  // Once the books are open, the next time they close (Lock, idle) the front page comes back.
  useEffect(() => {
    if (status === "open") setView("front");
  }, [status]);

  if (status === "loading") {
    return <div className="grid min-h-dvh place-items-center text-sm text-muted-foreground">Opening…</div>;
  }
  if (status === "open") return <>{children}</>;
  if (view === "setup") return <SetupScreen onBack={() => setView("front")} onRestore={() => setView("restore")} />;
  if (view === "restore") return <RestoreScreen replacing={status === "locked"} onCancel={() => setView("front")} />;
  return <FrontPage locked={status === "locked"} onNewHere={() => setView("setup")} onRestore={() => setView("restore")} />;
}
