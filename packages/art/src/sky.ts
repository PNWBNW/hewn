// ---------------------------------------------------------------------------
// The live sky (docs/HEWN_ART.md): the sky's two colours by the hour of the
// day, and whether it is night. Dawn and dusk warm, midday blue, night ink.
// ---------------------------------------------------------------------------

import { mix } from "./seed";

export type Season = "spring" | "summer" | "autumn" | "winter";
export const SEASONS: readonly Season[] = ["spring", "summer", "autumn", "winter"];

/** Hour of the day (0 to 24) → the sky's top and horizon colours. */
const KEYS: readonly (readonly [number, string, string])[] = [
  [0, "#060f1a", "#14273c"],
  [5, "#0b1a2b", "#22395a"],
  [6.5, "#7fa4c0", "#f6c886"],
  [8.5, "#5aa6c2", "#cfe7e6"],
  [16, "#5aa6c2", "#d6ece6"],
  [18.5, "#3a557a", "#f2a46b"],
  [20, "#0e1e33", "#2a4060"],
  [24, "#060f1a", "#14273c"],
];

export const SUNRISE = 5.8;
export const SUNSET = 19.6;

export const isNight = (hour: number): boolean => hour < SUNRISE || hour > SUNSET;
/** The warm hours around sunrise and sunset. */
export const isWarm = (hour: number): boolean => hour < 8 || hour > 17.5;

/** The sky at an hour: `[top, horizon]`, both `#rrggbb`. */
export function skyAt(hour: number): [string, string] {
  const h = Math.max(0, Math.min(24, hour));
  for (let i = 0; i < KEYS.length - 1; i++) {
    const [a, a1, a2] = KEYS[i]!;
    const [b, b1, b2] = KEYS[i + 1]!;
    if (h >= a && h <= b) {
      const t = (h - a) / (b - a);
      return [mix(a1, b1, t), mix(a2, b2, t)];
    }
  }
  return [KEYS[0]![1], KEYS[0]![2]];
}

/** The season of a date, by month, for the land north of the equator where Hewn starts. */
export function seasonOf(date: Date): Season {
  const m = date.getMonth();
  return m >= 2 && m <= 4 ? "spring" : m >= 5 && m <= 7 ? "summer" : m >= 8 && m <= 10 ? "autumn" : "winter";
}

/** The hour of a date with its minutes, as the sky wants it. */
export function hourOf(date: Date): number {
  return date.getHours() + date.getMinutes() / 60;
}
