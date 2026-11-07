"use client";

// THROWAWAY TEST PAGE (2026-11-07): which ways of saving a file, or of leaving for the phone's own
// browser, work inside Shield's in-app browser. Opened by Joshua on his phone from a [preview]
// build; reverted after the test, never merged. The test file holds no data, only a timestamp.

import { useEffect, useState } from "react";

const TEST_TEXT = () => `Hewn handoff test file\nmade ${new Date().toISOString()}\nNothing private in here.\n`;
const NAME = "hewn-handoff-test.txt";

function b64url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(s: string): string {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(pad);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}
function saveBlob(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export default function HandoffTest() {
  const [log, setLog] = useState<string[]>([]);
  const [ua, setUa] = useState("");
  const [arrived, setArrived] = useState<string | null>(null);
  const [link, setLink] = useState("#");
  const note = (s: string) => setLog((l) => [`${new Date().toLocaleTimeString()} · ${s}`, ...l]);

  useEffect(() => {
    setUa(navigator.userAgent);
    setLink(`${location.origin}${location.pathname}#d=${b64url(TEST_TEXT())}`);
    // The landing half: opened with the file in the # part (never sent to any server).
    const hash = location.hash.slice(1);
    const params = new URLSearchParams(hash);
    const d = params.get("d");
    if (location.search.includes("landed=1")) setArrived("Opened from an Android intent (no file carried: intents can't carry the # part).");
    if (d) {
      const text = unb64url(d);
      history.replaceState(null, "", location.pathname + location.search); // wipe the # part
      setArrived(`A file arrived through the # part (${text.length} characters). Tap "Save it here" if it didn't download by itself.`);
      (window as unknown as { __text: string }).__text = text;
      try {
        saveBlob(text, NAME);
      } catch {
        /* the button below is the fallback */
      }
    }
  }, []);

  const base = () => `${location.origin}${location.pathname}`;
  const withFile = () => `${base()}#d=${b64url(TEST_TEXT())}`;
  const intent = (pkg?: string) =>
    `intent://${location.host}${location.pathname}?landed=1#Intent;scheme=https;action=android.intent.action.VIEW;` +
    (pkg ? `package=${pkg};` : "") +
    `S.browser_fallback_url=${encodeURIComponent(base() + "?landed=fallback")};end`;

  const tests: { n: number; label: string; run: () => void }[] = [
    { n: 1, label: "Plain download (what Hewn does today)", run: () => saveBlob(TEST_TEXT(), NAME) },
    {
      n: 2,
      label: "Download from a data: link",
      run: () => {
        const a = document.createElement("a");
        a.href = `data:text/plain;charset=utf-8,${encodeURIComponent(TEST_TEXT())}`;
        a.download = NAME;
        document.body.appendChild(a);
        a.click();
        a.remove();
      },
    },
    { n: 3, label: "Download a real file from the site", run: () => (location.href = "/handoff-test-sample.hewn") },
    { n: 4, label: "Open a new window (window.open) carrying the file", run: () => void window.open(withFile(), "_blank", "noopener") },
    { n: 6, label: "Android: open the phone's default browser", run: () => (location.href = intent()) },
    { n: 7, label: "Android: open Chrome", run: () => (location.href = intent("com.android.chrome")) },
    { n: 8, label: "Android: open Brave", run: () => (location.href = intent("com.brave.browser")) },
    { n: 9, label: "iPhone: open Safari", run: () => (location.href = withFile().replace(/^https:/, "x-safari-https:")) },
  ];

  return (
    <div className="flex flex-col gap-5 pb-24">
      <h1 className="text-2xl font-semibold">Download test (temporary)</h1>
      {arrived ? (
        <div className="rounded-lg border border-emerald-600/50 p-4">
          <p className="font-medium">Landed here.</p>
          <p className="text-sm text-muted-foreground">{arrived}</p>
          <button
            className="mt-3 min-h-11 rounded-md border px-4"
            onClick={() => saveBlob((window as unknown as { __text?: string }).__text ?? TEST_TEXT(), NAME)}
          >
            Save it here
          </button>
        </div>
      ) : null}
      <p className="text-sm text-muted-foreground">
        Tap each one, then tell Claude by number what happened: a file saved, another app or browser opened, an error, or
        nothing at all.
      </p>
      <ol className="flex flex-col gap-3">
        {tests.map((t) => (
          <li key={t.n}>
            <button
              className="min-h-11 w-full rounded-md border px-4 py-2 text-left"
              onClick={() => {
                note(`tapped ${t.n}`);
                try {
                  t.run();
                } catch (e) {
                  note(`${t.n} threw: ${String(e)}`);
                }
              }}
            >
              {t.n}. {t.label}
            </button>
          </li>
        ))}
        <li>
          <a className="flex min-h-11 w-full items-center rounded-md border px-4 py-2" href={link} target="_blank" rel="noopener noreferrer" onClick={() => note("tapped 5")}>
            5. A link that opens in a new tab, carrying the file
          </a>
        </li>
      </ol>
      <div>
        <p className="text-xs text-muted-foreground">This browser: {ua}</p>
        <ul className="mt-2 text-xs text-muted-foreground">
          {log.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
