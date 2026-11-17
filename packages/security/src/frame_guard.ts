// ---------------------------------------------------------------------------
// The top-page guard, shared by the app and the site (docs/THREAT_MODEL.md T3,
// docs/HOSTING.md step 1).
//
// Each app's stylesheet hides the whole page until <html> carries
// TOP_PAGE_ATTRIBUTE, and only this code sets it, only when the page is the
// top page. So a copy of the page inside someone else's frame stays blank:
//
// - a frame sandboxed without scripts never runs this, so nothing is shown
//   (the stylesheet shows the no-JavaScript note there, and nothing else);
// - a frame that runs scripts, sandboxed or not, runs this, finds it is framed
//   and leaves the page hidden. It never tries to move the top window: that
//   is the framing page's to decide, and a sandbox would refuse it anyway.
//
// The rule is in a stylesheet file and the check in the app's own script
// file, so the strict security policy (no inline script or style) stays as it
// is, and no header is needed: it works on any host. Each app runs
// `guardTopPage` from `src/instrumentation-client.ts`, which Next.js runs
// before it hydrates the page, as early as the app's own code can run.
// ---------------------------------------------------------------------------

/** The attribute on `<html>` that the stylesheets wait for before showing anything. */
export const TOP_PAGE_ATTRIBUTE = "data-top-page";

/** The performance mark set when the page is shown, so the blank time can be read in the browser. */
export const TOP_PAGE_MARK = "top-page-shown";

/** What the guard reads of the window: whether it is the top one, and how to watch an element. */
export type GuardWindow<E extends GuardElement = GuardElement> = {
  readonly top: unknown;
  readonly self: unknown;
  readonly MutationObserver?: new (callback: () => void) => {
    observe(target: E, options: { attributes: true; attributeFilter: string[] }): void;
  };
  readonly performance?: { mark?(name: string): unknown };
};

/** What the guard touches of `<html>`. */
export type GuardElement = {
  hasAttribute(name: string): boolean;
  setAttribute(name: string, value: string): void;
};

/**
 * True only when the page is not inside any frame. Reading `top` is allowed across origins; if a
 * browser ever refused it, the answer is "framed", so the page stays hidden rather than shown.
 */
export function isTopPage(win: Pick<GuardWindow, "top" | "self">): boolean {
  try {
    return win.top != null && win.top === win.self;
  } catch {
    return false;
  }
}

/**
 * Shows the page if it is the top page, and keeps it shown: React removes every attribute from
 * `<html>` if it ever has to mount the root again (after an error it could not recover from in
 * place), so the attribute is put back whenever it goes, before the browser draws. Returns
 * whether the page was shown. A framed page is left exactly as it was.
 */
export function guardTopPage<E extends GuardElement>(win: GuardWindow<NoInfer<E>>, root: E): boolean {
  if (!isTopPage(win)) return false;
  const show = () => {
    if (!root.hasAttribute(TOP_PAGE_ATTRIBUTE)) root.setAttribute(TOP_PAGE_ATTRIBUTE, "");
  };
  show();
  try {
    win.performance?.mark?.(TOP_PAGE_MARK);
  } catch {
    // A mark is only for measuring; the page is shown either way.
  }
  if (win.MutationObserver) {
    new win.MutationObserver(show).observe(root, { attributes: true, attributeFilter: [TOP_PAGE_ATTRIBUTE] });
  }
  return true;
}
