import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { guardTopPage, isTopPage, TOP_PAGE_ATTRIBUTE, TOP_PAGE_MARK, type GuardElement, type GuardWindow } from "./frame_guard";

/** `<html>` as the guard sees it: its attributes, and whoever watches them. */
function fakeRoot() {
  const attributes = new Map<string, string>();
  const watchers: Array<() => void> = [];
  const root: GuardElement & { remove(name: string): void; attributes: Map<string, string> } = {
    attributes,
    hasAttribute: (name) => attributes.has(name),
    setAttribute: (name, value) => {
      attributes.set(name, value);
    },
    // What React does to <html> when it mounts the root again: every attribute goes.
    remove: (name) => {
      attributes.delete(name);
      for (const watcher of watchers) watcher();
    },
  };
  class Observer {
    constructor(private readonly callback: () => void) {}
    observe(_target: GuardElement, options: { attributes: true; attributeFilter: string[] }) {
      expect(options.attributeFilter).toEqual([TOP_PAGE_ATTRIBUTE]);
      watchers.push(this.callback);
    }
  }
  return { root, Observer, watchers };
}

function topWindow(extra: Partial<GuardWindow> = {}): GuardWindow {
  const win = { ...extra } as { top: unknown; self: unknown };
  win.self = win;
  win.top = win;
  return win as GuardWindow;
}

function framedWindow(extra: Partial<GuardWindow> = {}): GuardWindow {
  const win = { top: { another: "window" }, ...extra } as { top: unknown; self: unknown };
  win.self = win;
  return win as GuardWindow;
}

describe("isTopPage", () => {
  it("is true for the top page", () => {
    expect(isTopPage(topWindow())).toBe(true);
  });

  it("is false inside a frame", () => {
    expect(isTopPage(framedWindow())).toBe(false);
  });

  it("is false when the browser refuses to say", () => {
    const win = {
      get top(): unknown {
        throw new Error("blocked");
      },
      self: {},
    };
    expect(isTopPage(win)).toBe(false);
  });

  it("is false inside a frame whose self was overwritten to look like the top", () => {
    // `self` can be reassigned by a script in the page; `top` can't.
    const win = framedWindow() as { top: unknown; self: unknown };
    win.self = win.top;
    expect(isTopPage(win)).toBe(false);
  });

  it("is false with no top window at all (a detached document)", () => {
    const win = { top: null, self: null };
    expect(isTopPage(win)).toBe(false);
  });
});

describe("guardTopPage", () => {
  it("shows the top page and marks when", () => {
    const { root, Observer } = fakeRoot();
    const marks: string[] = [];
    const shown = guardTopPage(topWindow({ MutationObserver: Observer, performance: { mark: (n) => marks.push(n) } }), root);
    expect(shown).toBe(true);
    expect(root.attributes.get(TOP_PAGE_ATTRIBUTE)).toBe("");
    expect(marks).toEqual([TOP_PAGE_MARK]);
  });

  it("leaves a framed page hidden, touches nothing and watches nothing", () => {
    const { root, Observer, watchers } = fakeRoot();
    const marks: string[] = [];
    const shown = guardTopPage(framedWindow({ MutationObserver: Observer, performance: { mark: (n) => marks.push(n) } }), root);
    expect(shown).toBe(false);
    expect(root.attributes.size).toBe(0);
    expect(watchers).toHaveLength(0);
    expect(marks).toEqual([]);
  });

  it("puts the attribute back when something removes it", () => {
    const { root, Observer } = fakeRoot();
    guardTopPage(topWindow({ MutationObserver: Observer }), root);
    root.remove(TOP_PAGE_ATTRIBUTE);
    expect(root.hasAttribute(TOP_PAGE_ATTRIBUTE)).toBe(true);
  });

  it("does not set the attribute twice when it is already there", () => {
    const { root, Observer } = fakeRoot();
    let sets = 0;
    const counting: GuardElement = {
      hasAttribute: root.hasAttribute,
      setAttribute: (n, v) => {
        sets++;
        root.setAttribute(n, v);
      },
    };
    guardTopPage(topWindow({ MutationObserver: Observer }), counting);
    guardTopPage(topWindow({ MutationObserver: Observer }), counting);
    expect(sets).toBe(1);
  });

  it("still shows the page without MutationObserver or performance marks", () => {
    const { root } = fakeRoot();
    expect(guardTopPage(topWindow(), root)).toBe(true);
    expect(root.hasAttribute(TOP_PAGE_ATTRIBUTE)).toBe(true);
  });

  it("still shows the page when marking fails", () => {
    const { root } = fakeRoot();
    const win = topWindow({
      performance: {
        mark: () => {
          throw new Error("no marks here");
        },
      },
    });
    expect(guardTopPage(win, root)).toBe(true);
    expect(root.hasAttribute(TOP_PAGE_ATTRIBUTE)).toBe(true);
  });
});

describe("the stylesheet half", () => {
  const css = readFileSync(join(__dirname, "frame_guard.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const squashed = css.replace(/\s+/g, " ");

  it("hides the page until the guard's attribute is there", () => {
    expect(squashed).toContain(`html:not([${TOP_PAGE_ATTRIBUTE}]) { display: none; }`);
  });

  it("without scripts, shows only the page's no-JavaScript note", () => {
    expect(squashed).toContain(
      `@media (scripting: none) { html:not([${TOP_PAGE_ATTRIBUTE}]) { display: block; } html:not([${TOP_PAGE_ATTRIBUTE}]) body > :not(noscript) { display: none; } }`,
    );
  });

  it("names no other attribute and shows nothing else", () => {
    expect(css.match(/data-[a-z-]+/g)?.every((a) => a === TOP_PAGE_ATTRIBUTE)).toBe(true);
    expect(css.match(/display:\s*block/g)).toHaveLength(1);
  });
});
