import { afterEach, describe, expect, it, vi } from "vitest";
import { DRAWING_STEPS, drawingStep, drawn, stuckAt } from "./drawing_step";

function fakeStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    keys: () => [...m.keys()],
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("the drawing probe", () => {
  it("names the step a load never finished, until the screen is drawn", () => {
    const s = fakeStorage();
    vi.stubGlobal("localStorage", s);
    expect(stuckAt()).toBeNull();
    drawingStep("the dashboard");
    expect(stuckAt()).toBe("the dashboard");
    drawn();
    expect(stuckAt()).toBeNull();
  });

  it("stores only a step's name under its one key", () => {
    const s = fakeStorage();
    vi.stubGlobal("localStorage", s);
    for (const step of DRAWING_STEPS) drawingStep(step);
    expect(s.keys()).toEqual(["hewn.drawing-step"]);
  });

  it("ignores anything else found under its key", () => {
    const s = fakeStorage();
    s.setItem("hewn.drawing-step", "someone's books");
    vi.stubGlobal("localStorage", s);
    expect(stuckAt()).toBeNull();
  });

  it("goes quiet when storage is blocked", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    });
    expect(() => drawingStep("the menu's counts")).not.toThrow();
    expect(() => drawn()).not.toThrow();
    expect(stuckAt()).toBeNull();
  });
});
