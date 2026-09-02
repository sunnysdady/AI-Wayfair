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
  assert.match(workspace, /import \{ LINGXING_TIME_ZONE \} from "@\/lib\/lingxing-business-time\.mjs"/);
  assert.doesNotMatch(workspace, /timeZone:\s*"America\/New_York"/);
  assert.match(workspace, /const quickRanges = \["今天", "昨天", "7天", "14天", "本月", "上个月", "今年"\]/);
  assert.match(workspace, /label === "今天"[\s\S]*start: isoDate\(today\), end: isoDate\(today\)/);
  assert.match(workspace, /label === "昨天"[\s\S]*start: yesterday, end: yesterday/);
  assert.match(styles, /var\(--brand-color-primary\)/);
  assert.match(styles, /var\(--brand-panel-filter\)/);
  assert.doesNotMatch(styles, /#176c58|#102b32|#cbd8dd|#dce6e9/);
});
