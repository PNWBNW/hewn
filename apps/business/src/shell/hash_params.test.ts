import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HASH_EVENT, HashLink, hashFor, moveQueryToHash, parseHash, readHash, setHashParams, subscribeHash } from "./hash_params";

// A browser's window, as far as the fragment goes: an address, a history and events.
class FakeWindow extends EventTarget {
  location = { pathname: "/messages", search: "", hash: "" };
  entries: string[] = [];
  requested: string[] = [];
  history = {
    pushState: (_: unknown, __: string, url: string) => this.go(url, true),
    replaceState: (_: unknown, __: string, url: string) => this.go(url, false),
  };
  private go(url: string, push: boolean) {
    const u = new URL(url, "https://hewn.test");
    this.location = { pathname: u.pathname, search: u.search, hash: u.hash };
    if (push) this.entries.push(url);
    else this.entries[this.entries.length - 1] = url;
  }
  /** The address bar changed by the person (a typed fragment, a link to one): the browser fires hashchange. */
  typeHash(hash: string) {
    this.location = { ...this.location, hash };
    this.dispatchEvent(new Event("hashchange"));
  }
  scrollTo() {}
}

let win: FakeWindow;
beforeEach(() => {
  win = new FakeWindow();
  vi.stubGlobal("window", win);
});
afterEach(() => vi.unstubAllGlobals());

describe("the page's fragment", () => {
  it("reads and writes search params after the #", () => {
    expect(parseHash("#client=aleo1abc&at=7").get("client")).toBe("aleo1abc");
    expect(parseHash("").get("client")).toBeNull();
    expect(hashFor({ coworker: "t1", at: "a/b", group: null, with: "" })).toBe("#coworker=t1&at=a%2Fb");
    expect(hashFor({})).toBe("");
  });

  it("setHashParams changes the fragment as a history entry and tells every subscriber", () => {
    win.location.search = "?tab=offers";
    const seen: string[] = [];
    const stop = subscribeHash(() => seen.push(readHash()));
    setHashParams({ client: "aleo1xyz" });
    expect(win.location).toEqual({ pathname: "/messages", search: "?tab=offers", hash: "#client=aleo1xyz" });
    expect(win.entries).toEqual(["/messages?tab=offers#client=aleo1xyz"]);
    setHashParams({}, { replace: true });
    expect(win.entries).toEqual(["/messages?tab=offers"]);
    expect(seen).toEqual(["#client=aleo1xyz", ""]);
    stop();
    setHashParams({ with: "w1" });
    expect(seen).toHaveLength(2);
  });

  it("picks up a fragment changed by the browser, and back and forward", () => {
    const seen: string[] = [];
    subscribeHash(() => seen.push(readHash()));
    win.typeHash("#channel=c1");
    win.location.hash = "";
    win.dispatchEvent(new Event("popstate"));
    win.dispatchEvent(new Event(HASH_EVENT));
    expect(seen).toEqual(["#channel=c1", "", ""]);
  });

  it("moves an old link's selection out of the query, in place", () => {
    win.location.search = "?with=w1&tab=x";
    win.entries = ["/messages?with=w1&tab=x"];
    const seen: string[] = [];
    subscribeHash(() => seen.push(readHash()));
    expect(moveQueryToHash(["with", "client"])).toBe(true);
    expect(win.location).toEqual({ pathname: "/messages", search: "?tab=x", hash: "#with=w1" });
    expect(win.entries).toEqual(["/messages?tab=x#with=w1"]);
    expect(seen).toEqual(["#with=w1"]);
    expect(moveQueryToHash(["with", "client"])).toBe(false);
  });

  it("links to a selection without naming it in the query", () => {
    const html = renderToStaticMarkup(createElement(HashLink, { path: "/messages", values: { client: "aleo1q" }, children: "Open" }));
    expect(html).toContain('href="/messages#client=aleo1q"');
    expect(html).not.toContain("?client");
  });
});
