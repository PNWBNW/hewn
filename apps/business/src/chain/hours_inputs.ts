// A datetime-local input's value ("2026-10-14T09:30", this device's time) from an instant, and back.

export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const fromLocalInput = (v: string): string => new Date(v).toISOString();

/** The instant an input means: the original one, to the second, when the input still shows it. */
export function pick(input: string, original: string): string {
  if (!input) throw new Error("Set both times");
  return input === toLocalInput(original) ? original : fromLocalInput(input);
}
