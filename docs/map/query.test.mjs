// Known answers the queries must give (docs/map/README.md). Run: node --test docs/map/query.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { Ambiguous, NotFound, Usage, find, hubs, impact, load, path, regions, resolve, rule, run, show } from "./query.mjs";

const map = load();

test("a name is a full id or the end of a path; several matches are refused, none is not found", () => {
  assert.equal(resolve(map, "books/close.ts").id, "apps/business/src/books/close.ts");
  assert.equal(resolve(map, "inv-07".toUpperCase()).id, "INV-07");
  assert.throws(() => resolve(map, "page.tsx"), Ambiguous);
  assert.throws(() => resolve(map, "no-such-file.ts"), NotFound);
});

test("show groups every edge by kind and direction", () => {
  const out = show(map, "books/close.ts");
  assert.match(out, /^apps\/business\/src\/books\/close\.ts\n {2}Books code · code · \d+ lines/);
  assert.match(out, /imported by \(\d+\):\n(?: {4}.+\n)*? {4}apps\/business\/src\/books\/ClosePanel\.tsx/);
  assert.match(out, /imports \(\d+\):\n(?: {4}.+\n)*? {4}packages\/ledger\/src\/index\.ts/);
});

test("impact walks the code edges backwards, a hop at a time", () => {
  const out = impact(map, "books/close.ts", 1);
  assert.match(out, /1 hop \(\d+\):/);
  assert.match(out, /apps\/business\/src\/books\/ClosePanel\.tsx/);
  assert.doesNotMatch(out, /2 hops/);
});

test("path finds the chain from a screen to the program it ends up naming", () => {
  const out = path(map, "app/transactions/page.tsx", "payroll_audit_log.aleo/src/main.leo");
  assert.match(out, /--loads--> apps\/business\/src\/chain\/CloseShield\.tsx/);
  assert.match(out, /--names--> pnw_mvp_v2\/src\/layer1\/payroll_audit_log\.aleo\/src\/main\.leo$/);
});

test("rule lists a rule's checks, threats and citations", () => {
  const out = rule(map, "INV-07");
  assert.match(out, /checked by \(1\):\n {4}packages\/vault\/src\/vault\.test\.ts/);
  assert.match(out, /answers \(2\):\n {4}T2\n {4}T8/);
  assert.match(out, /cited by \(\d+\):\n(?: {4}.+\n)*? {4}CLAUDE\.md/);
  assert.match(rule(map, "T18"), /answered by/);
});

test("find, hubs and regions answer over the whole map", () => {
  assert.match(find(map, "Closing a period"), /apps\/business\/src\/books\/close\.ts/);
  assert.match(hubs(map, "chain", 3), /the 3 most connected points in chain/);
  assert.match(regions(map), /^\d+ points, \d+ edges, 18 regions:/);
});

test("the command line: usage on nothing, the same answers on the commands", () => {
  assert.throws(() => run([], map), Usage);
  assert.throws(() => run(["show"], map), Usage);
  assert.equal(run(["show", "books/close.ts"], map), show(map, "books/close.ts"));
  assert.equal(run(["hubs", "chain", "3"], map), hubs(map, "chain", 3));
});
