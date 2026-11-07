"use client";

// THROWAWAY TEST PAGE (2026-11-07): can a file made on the phone be saved inside Shield's
// browser through a service worker, with no server? Reverted after the test, never merged.

import { useEffect, useState } from "react";

const CACHE = "hewn-save-test";

export default function SwTest() {
  const [log, setLog] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const note = (s: string) => setLog((l) => [`${new Date().toLocaleTimeString()} · ${s}`, ...l]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      note("This browser has no service workers.");
      return;
    }
    navigator.serviceWorker
      .register("/sw-save.js", { scope: "/verify/sw-test" })
      .then(() => navigator.serviceWorker.ready)
      .then(() => {
        setReady(true);
        note("Helper is ready.");
      })
      .catch((e) => note(`Helper failed to start: ${String(e)}`));
  }, []);

  async function save(name: string, type: string, text: string) {
    const id = crypto.randomUUID();
    const path = `/verify/sw-test/file/${id}/${encodeURIComponent(name)}`;
    const cache = await caches.open(CACHE);
    await cache.put(
      path,
      new Response(new Blob([text], { type }), {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${name}"`,
        },
      }),
    );
    note(`File ready at a private address; asking the browser to save ${name}…`);
    location.href = path;
  }

  return (
    <div className="flex flex-col gap-5 pb-24">
      <h1 className="text-2xl font-semibold">Save test, round 2 (temporary)</h1>
      <p className="text-sm text-muted-foreground">
        {ready ? "The helper is running." : "Starting the helper…"} Tap a button, then check your notifications and
        Files → Downloads. Tell Claude: saved, an error, or nothing.
      </p>
      <button
        disabled={!ready}
        className="min-h-11 rounded-md border px-4 py-2 text-left disabled:opacity-50"
        onClick={() => save("hewn-sw-test.hewn", "application/json", `{"test":"made on this phone at ${new Date().toISOString()}"}\n`)}
      >
        A. Save a test backup (.hewn) made on this phone
      </button>
      <button
        disabled={!ready}
        className="min-h-11 rounded-md border px-4 py-2 text-left disabled:opacity-50"
        onClick={() => save("hewn-sw-test.json", "application/json", `{"test":"made on this phone at ${new Date().toISOString()}"}\n`)}
      >
        B. Save a test proof (.json) made on this phone
      </button>
      <p className="text-sm text-muted-foreground">
        Then the picker: go to the front page (logged out) → Restore from a backup file, or to Check a proof, and see
        whether the .hewn files in Downloads can be selected now.
      </p>
      <ul className="text-xs text-muted-foreground">
        {log.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
    </div>
  );
}
