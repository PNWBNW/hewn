"use client";

import { apiUrl } from "../api_base";
// The traction map: a choropleth of visitors since launch by country, four
// binned steps of one green (validated ramps, light and dark), with a tooltip
// per country, totals as stat tiles, a legend and a table. Reads two
// same-origin files: the published numbers (/api/traction) and the country
// outlines (/traction/world.json, Natural Earth, projected ahead of time).

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@pnw/ui/card";
import { cn } from "@pnw/ui/utils";

type Published = {
  status?: "counting" | "off" | "unavailable";
  countries: { country: string; visitors: number; visits: number }[];
  visitors: number;
  visits: number;
  hidden: number;
  minVisitors: number;
};
type World = { width: number; height: number; sphere: string; countries: Record<string, string> };

/** Visitor bins, low to high; the lowest starts at one visitor, the publishing floor on testnet. */
export const BINS = [1, 5, 25, 100] as const;
const RAMP = {
  light: ["#79c491", "#4a9e6b", "#2a7d52", "#0f5a3c"],
  dark: ["#2a6650", "#3d8f68", "#5fb886", "#a6e3bd"],
};
const LAND = { light: "#e4e9e4", dark: "#1c2924" };
const STROKE = { light: "#ffffff", dark: "#111a17" };

export function binOf(visitors: number): number {
  let b = -1;
  for (let i = 0; i < BINS.length; i++) if (visitors >= BINS[i]!) b = i;
  return b;
}
export const binLabel = (i: number): string => (i === BINS.length - 1 ? `${BINS[i]}+` : `${BINS[i]}–${BINS[i + 1]! - 1}`);

function useDark(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-color-scheme: dark)");
    const set = () => setDark(m.matches || document.documentElement.classList.contains("dark"));
    set();
    m.addEventListener("change", set);
    return () => m.removeEventListener("change", set);
  }, []);
  return dark;
}

const names = typeof Intl !== "undefined" && "DisplayNames" in Intl ? new Intl.DisplayNames(["en"], { type: "region" }) : null;
const nameOf = (code: string) => {
  try {
    return names?.of(code) ?? code;
  } catch {
    return code;
  }
};
const n = (v: number) => v.toLocaleString("en-US");

export function TractionMap() {
  const [data, setData] = useState<Published | null>(null);
  const [world, setWorld] = useState<World | null>(null);
  const [failed, setFailed] = useState(false);
  const [hover, setHover] = useState<{ code: string; x: number; y: number } | null>(null);
  const dark = useDark();
  const mode = dark ? "dark" : "light";

  useEffect(() => {
    let live = true;
    Promise.all([fetch(apiUrl("/api/traction")).then((r) => r.json() as Promise<Published>), fetch("/traction/world.json").then((r) => r.json() as Promise<World>)])
      .then(([d, w]) => {
        if (!live) return;
        setData(d);
        setWorld(w);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  const byCode = useMemo(() => new Map((data?.countries ?? []).map((c) => [c.country, c])), [data]);

  if (failed) return <p className="text-sm text-muted-foreground">The numbers couldn&apos;t be read right now. Try again in a moment.</p>;
  if (!data || !world) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const shown = data.countries.length;
  const hovered = hover ? byCode.get(hover.code) : undefined;

  return (
    <div className="flex flex-col gap-6">
      {data.status === "off" && <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">Counting hasn&apos;t been switched on yet, so nothing has been counted.</p>}
      {data.status === "unavailable" && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">The counts couldn&apos;t be read just now; these aren&apos;t the real numbers. Try again in a moment.</p>
      )}
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Visitors since launch" value={n(data.visitors)} />
        <Stat label="Visits since launch" value={n(data.visits)} />
        <Stat label="Countries on the map" value={n(shown)} note={data.hidden > 0 ? `${data.hidden} more with fewer than ${data.minVisitors} visitors` : undefined} />
      </dl>

      <Card>
        <CardContent className="pt-6">
          <div className="relative" onMouseLeave={() => setHover(null)}>
            <svg viewBox={`0 0 ${world.width} ${world.height}`} className="h-auto w-full" role="img" aria-label={`Map of visitors by country: ${shown} countries shown`}>
              <path d={world.sphere} fill="none" stroke={dark ? "#22302a" : "#dde3dd"} strokeWidth={1} />
              {Object.entries(world.countries).map(([code, d]) => {
                const c = byCode.get(code);
                const b = c ? binOf(c.visitors) : -1;
                return (
                  <path
                    key={code}
                    d={d}
                    fill={b >= 0 ? RAMP[mode][b] : LAND[mode]}
                    stroke={STROKE[mode]}
                    strokeWidth={0.6}
                    className={cn(c && "cursor-pointer")}
                    onMouseMove={(e) => {
                      const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                      setHover({ code, x: e.clientX - box.left, y: e.clientY - box.top });
                    }}
                    onClick={(e) => {
                      const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                      setHover({ code, x: e.clientX - box.left, y: e.clientY - box.top });
                    }}
                  />
                );
              })}
            </svg>
            {hover && (
              <div
                className="pointer-events-none absolute z-10 min-w-40 -translate-x-1/2 -translate-y-[calc(100%+12px)] rounded-md border bg-card px-3 py-2 text-xs shadow-lg"
                ref={(el) => {
                  if (el) {
                    el.style.left = `${hover.x}px`;
                    el.style.top = `${hover.y}px`;
                  }
                }}
              >
                <div className="font-medium text-card-foreground">{nameOf(hover.code)}</div>
                {hovered ? (
                  <div className="mt-1 tabular-nums text-muted-foreground">
                    {n(hovered.visitors)} visitors · {n(hovered.visits)} visits
                  </div>
                ) : (
                  <div className="mt-1 text-muted-foreground">{data.minVisitors > 1 ? `Fewer than ${data.minVisitors} visitors, or none yet` : "No visitors yet"}</div>
                )}
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground" aria-label="Legend: visitors since launch">
            <span>Visitors since launch</span>
            {BINS.map((_, i) => (
              <span key={i} className="flex items-center gap-1.5">
                <svg width="14" height="10" aria-hidden>
                  <rect width="14" height="10" rx="2" fill={RAMP[mode][i]} />
                </svg>
                {binLabel(i)}
              </span>
            ))}
            <span className="flex items-center gap-1.5">
              <svg width="14" height="10" aria-hidden>
                <rect width="14" height="10" rx="2" fill={LAND[mode]} />
              </svg>
              {data.minVisitors > 1 ? `Under ${data.minVisitors}, or none yet` : "None yet"}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {shown === 0 ? (
            <p className="text-sm text-muted-foreground">
              {data.minVisitors > 1
                ? `No country has ${data.minVisitors} visitors yet. Countries appear once they do, so a place with one or two people never points at them.`
                : "No visitors yet."}
            </p>
          ) : (
            <table className="w-full text-sm">
              <caption className="sr-only">Visitors and visits by country, since launch</caption>
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 font-medium">Country</th>
                  <th className="py-2 text-right font-medium">Visitors</th>
                  <th className="py-2 text-right font-medium">Visits</th>
                </tr>
              </thead>
              <tbody>
                {data.countries.map((c) => (
                  <tr key={c.country} className="border-b last:border-0">
                    <td className="py-2">{nameOf(c.country)}</td>
                    <td className="py-2 text-right tabular-nums">{n(c.visitors)}</td>
                    <td className="py-2 text-right tabular-nums">{n(c.visits)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <p className="text-xs leading-relaxed text-muted-foreground">
        A visit is one browser session; a visitor is a device&apos;s first visit. Each device decides that for itself and sends only yes or no, so nobody is
        recognised. We keep two totals per country and nothing else: no dates, no addresses, no ids.{" "}
        {data.minVisitors > 1 ? `A country shows once it has ${data.minVisitors} visitors, and these` : "Every country with a visitor shows while on testnet, and these"} numbers refresh
        once a day. Counted while Hewn is on testnet.
      </p>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums text-card-foreground">{value}</dd>
      {note && <dd className="mt-1 text-xs text-muted-foreground">{note}</dd>}
    </div>
  );
}
