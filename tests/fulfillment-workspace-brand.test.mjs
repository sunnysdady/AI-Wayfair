import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("keeps the fulfillment workspace concise and on the shared brand kit", async () => {
  const [workspace, styles] = await Promise.all([
    readFile(new URL("../app/fulfillment/workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/fulfillment/workspace.module.css", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(workspace, /订单履约台账 · A–P 标准模板/);
  assert.doesNotMatch(workspace, /一单多件按订单行和数量拆成独立包裹/);
  assert.doesNotMatch(workspace, /仅显示 2026-09-01 起的正式订单/);
  assert.match(styles, /var\(--brand-color-primary\)/);
  assert.match(styles, /var\(--brand-panel-filter\)/);
  assert.doesNotMatch(styles, /#176c58|#102b32|#cbd8dd|#dce6e9/);
});
