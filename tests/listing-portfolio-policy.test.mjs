import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("blocks duplicate links that differ only by copy, images, or price", async () => {
  const [page, plan, route] = await Promise.all([
    readFile(new URL("../app/OpsCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/operating-plan.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/plan/progress/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(plan, /mode: "ONE_PRODUCT_ONE_LISTING"/);
  assert.match(plan, /同一产品不得仅通过文案、图片或价格差异创建2–3条链接/);
  assert.match(plan, /真实型号、结构、尺寸、材质、功能或套装数量/);
  assert.match(route, /listingPortfolioPolicy: LISTING_PORTFOLIO_POLICY/);
  assert.match(page, /成功老品放大 · 合规边界/);
  assert.match(page, /不执行视觉去重规避/);
});

test("keeps successful-product growth experiments on the original listing", async () => {
  const plan = await readFile(new URL("../lib/operating-plan.ts", import.meta.url), "utf8");

  assert.match(plan, /原Listing持续优化/);
  assert.match(plan, /主图、场景图、标题卖点和价格按单变量分阶段测试/);
  assert.match(plan, /至少3张高清图/);
  assert.match(plan, /价格不得虚高或制造虚假折扣/);
});
