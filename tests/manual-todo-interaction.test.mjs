import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("limits completion interaction and hover feedback to the checkbox column", async () => {
  const [page, styles] = await Promise.all([
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /className=\{`manual-todo-row/);
  assert.match(page, /className="manual-todo-check"/);
  assert.match(page, /className="manual-todo-content"/);
  assert.doesNotMatch(page, /<label className=\{done\?'done':''\} key=\{task\.id\}>/);
  assert.match(styles, /\.manual-todo-check:hover/);
  assert.doesNotMatch(styles, /\.manual-todo-list label:hover/);
  assert.match(styles, /\.manual-todo-content\{[^}]*user-select:text/);
});

test("renders every manual action at advertising-group grain with its Campaign ID", async () => {
  const page = await readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8");

  assert.match(page, /adGroup:/);
  assert.match(page, /campaignId:/);
  assert.match(page, /<dt>\u5e7f\u544a\u7ec4<\/dt><dd>\{task\.adGroup\}<\/dd>/);
  assert.match(page, /<dt>Campaign ID<\/dt><dd>\{task\.campaignId\}<\/dd>/);
  assert.match(page, /Campaign ID: \{task\.campaignId\}/);
  assert.match(page, /campaignId: "660198"/);
  assert.match(page, /campaignId: "597350"/);
  assert.match(page, /campaignId: "622725"/);
  assert.match(page, /campaignId: "622721"/);
  assert.match(page, /campaignId: "622722"/);
  assert.match(page, /campaignId: "622737"/);
  assert.match(page, /campaignId: "635903"/);
  assert.match(page, /campaignId: "\u65b0\u5efa\u540e\u56de\u586b"/);
});
