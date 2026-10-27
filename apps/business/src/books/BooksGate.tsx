"use client";

import { useEffect, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useBooks } from "./BooksProvider";
import { canonicalPath, isPublicPath } from "@/shell/AppShell";
import { FrontPage } from "./FrontPage";
import { type RestoreStart, RestoreScreen } from "./RestoreScreen";
import { SetupScreen } from "./SetupScreen";

type View = "front" | "setup" | "restore";

// Finding the backup kept with the account needs Shield: loaded only when the restore screen shows.
const ChainRestore = dynamic(() => import("@/chain/ChainRestore"), { ssr: false });

/** Nothing inside renders until the books are open, apart from public pages. Until then: the front page, or the screen it leads to. */
export function BooksGate({ children }: { children: ReactNode }) {
  const { status, opening } = useBooks();
  const pathname = canonicalPath(usePathname());
  const [view, setView] = useState<View>("front");
  const [start, setStart] = useState<RestoreStart>({ from: "file" });
  const restoreFrom = (s: RestoreStart = { from: "file" }) => {
    setStart(s);
    setView("restore");
  };

  // Once the books are open, the next time they close (Lock, idle) the front page comes back.
  useEffect(() => {
    if (status === "open") setView("front");
  }, [status]);

  // The job board is public: it renders without the books (the shell shows a way in instead of the rail).
  if (status !== "open" && isPublicPath(pathname)) return <>{children}</>;
  if (status === "loading") {
    // The step and the build: a screen that sticks says where, and which version it is.
    return (
      <div className="grid min-h-dvh place-items-center text-center text-sm text-muted-foreground">
        <div className="flex flex-col gap-1">
          <p>Opening…</p>
          <p className="text-xs opacity-70">
            {opening}
            {process.env.NEXT_PUBLIC_HEWN_BUILD ? ` · ${process.env.NEXT_PUBLIC_HEWN_BUILD}` : ""}
          </p>
        </div>
      </div>
    );
  }
  if (status === "open") return <>{children}</>;
  if (view === "setup") return <SetupScreen onBack={() => setView("front")} onRestore={() => restoreFrom()} />;
  if (view === "restore") {
    const replacing = status === "locked";
    const back = () => setView("front");
    return (
      <RestoreScreen
        replacing={replacing}
        onCancel={back}
        start={start}
        fromAccount={<ChainRestore username={start.username} replacing={replacing} onCancel={back} />}
      />
    );
  }
  return <FrontPage locked={status === "locked"} onNewHere={() => setView("setup")} onRestore={restoreFrom} />;
}
