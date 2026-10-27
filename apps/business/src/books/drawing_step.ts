// ---------------------------------------------------------------------------
// Which step of drawing the open books this device was on (Joshua, 2026-10-27:
// the books opened, then the screen froze with nothing to say where). Each
// step notes its name before it runs; once the screen has been drawn the note
// is cleared. A note still there on the next load names the step that never
// finished, and the opening screen shows it. Only a step's name from the list
// below is ever stored: nothing from the books (docs/INVARIANTS.md, INV-10).
// ---------------------------------------------------------------------------

const DRAWING_STEP_KEY = "hewn.drawing-step";

export const DRAWING_STEPS = [
  "opening the books",
  "the menu and setup check",
  "the menu's counts",
  "moving to the right page",
  "the jobs' projects",
  "the dashboard",
  "the dashboard's figures",
  "the set-asides",
  "the backup reminder",
  "the Shield balances",
  "the Shield check",
] as const;

export type DrawingStep = (typeof DRAWING_STEPS)[number];

/** Notes the step about to run. Storage that's blocked just goes without. */
export function drawingStep(step: DrawingStep): void {
  try {
    localStorage.setItem(DRAWING_STEP_KEY, step);
  } catch {
    // Nothing to keep it in: the probe goes quiet.
  }
}

/** The screen was drawn: nothing stuck. */
export function drawn(): void {
  try {
    localStorage.removeItem(DRAWING_STEP_KEY);
  } catch {
    // As above.
  }
}

/** The step the last load never finished, if one is noted. */
export function stuckAt(): DrawingStep | null {
  try {
    const v = localStorage.getItem(DRAWING_STEP_KEY);
    return DRAWING_STEPS.find((s) => s === v) ?? null;
  } catch {
    return null;
  }
}
