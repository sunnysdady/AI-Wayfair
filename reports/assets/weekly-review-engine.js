/* Wayfair 周复盘优化引擎 · 纯 JS（无 Pyodide）
 *
 * 把 codex 的周复盘逻辑（广告花费 × 真实订单 → 止损/保护/验证/缩减）做成可在浏览器
 * 一键执行的引擎。输入是已解析的表（行数组），输出动作账本行 + 汇总。
 * 同一个 computeWeeklyReview() 既被浏览器调用，也被 Node 单测调用——单一来源、可验证。
 *
 * 用法：
 *   const res = WFWeeklyReview.compute({campaign, product, orders, inventoryMap});
 *   res = { ledger:[...], kpis:{...}, sellers:[...], burners:[...] }
 */
(function (root) {
  function num(v) {
    if (v === undefined || v === null || v === "") return 0;
    const n = parseFloat(String(v).replace(/[, ]/g, ""));
    return isFinite(n) ? n : 0;
  }
  function norm(s) { return String(s == null ? "" : s).trim(); }

  // 阈值（与 codex 周复盘口径一致：周级只做止损 + 小预算验证）
  const T = {
    burnSpend: 8,      // 单 SKU 花费 ≥ 此值且 0 真实订单 → 止损
    trimSpend: 30,     // 花费高但真实件数很少 → 缩减
    trimUnitsMax: 2,
    winUnits: 3,       // 真实件数 ≥ 此值 → 赢家保护
  };

  function compute(tables) {
    const product = tables.product || [];   // Product Report 行
    const orders = tables.orders || [];     // 6月订单行（已含数量、SKU）
    const invMap = tables.inventoryMap || {}; // 仓库/供应商SKU -> Wayfair listing SKU
    const stockMap = tables.stockMap || {};   // Wayfair SKU -> 可用量

    // 1) 广告：按 listing(DMOM) 聚合花费/点击/归因订单
    const ad = {};
    for (const r of product) {
      const lst = norm(r.listing);
      if (!lst) continue;
      const a = ad[lst] || (ad[lst] = { spend: 0, clicks: 0, attrOrders: 0, sku: norm(r.first_10_part_numbers), name: norm(r.product_name) });
      a.spend += num(r.spend_USD);
      a.clicks += num(r.clicks);
      a.attrOrders += num(r.attributed_orders_window_view_through_Day_14);
    }

    // 2) 真实订单：按 Wayfair listing SKU 聚合件数（经库存映射）
    const realBySku = {};
    for (const o of orders) {
      const raw = norm(o.SKU || o.sku);
      const wf = invMap[raw] || "";
      if (!wf) continue;
      realBySku[wf] = (realBySku[wf] || 0) + num(o["数量"] || o.qty || 1);
    }
    // DMOM -> 旗下 Wayfair SKU（来自 Product Report 的 first_10_part_numbers）
    function wfSkusOf(lst) {
      const s = (ad[lst] && ad[lst].sku) || "";
      return s.split(",").map(norm).filter(Boolean);
    }
    function realUnits(lst) { return wfSkusOf(lst).reduce((t, s) => t + (realBySku[s] || 0), 0); }
    function stock(lst) { return wfSkusOf(lst).reduce((t, s) => t + (stockMap[s] || 0), 0); }

    // 3) 规则引擎 → 分类
    const sellers = [], burners = [], trims = [], protects = [];
    for (const lst of Object.keys(ad)) {
      const a = ad[lst]; const ru = realUnits(lst); const stk = stock(lst);
      const row = { listing: lst, sku: a.sku, name: a.name, spend: +a.spend.toFixed(2), clicks: a.clicks, attrOrders: a.attrOrders, realUnits: ru, stock: stk };
      if (ru >= T.winUnits) sellers.push(row);
      else if (a.spend >= T.burnSpend && ru === 0) burners.push(row);
      else if (a.spend >= T.trimSpend && ru <= T.trimUnitsMax) trims.push(row);
      else if (ru > 0 && a.attrOrders === 0) protects.push(row); // 有真实单但广告 0 归因 → 别误杀
    }
    sellers.sort((x, y) => y.realUnits - x.realUnits);
    burners.sort((x, y) => y.spend - x.spend);

    // 4) 生成动作账本行（codex 14 字段结构）
    const cycle = "2026-06-06 to 2026-06-12";
    let seq = 0;
    const mk = (level, object, decision, reason, expect, promote, stop) => ({
      action_id: "WBR-AUTO-" + String(++seq).padStart(3, "0"),
      cycle, cadence: "Weekly", object, level, decision, reason,
      owner: "运营", due_date: "", expected_metric: expect, next_check: "", status: "Pending",
      promote_rule: promote, stop_loss_rule: stop,
    });
    const ledger = [];
    const burnSave = burners.reduce((t, b) => t + b.spend, 0);
    if (sellers.length) ledger.push(mk("P0",
      sellers.map(s => s.listing).join(" / "),
      "保护赢家：维持/小幅加预算",
      "真实订单领先：" + sellers.slice(0, 4).map(s => `${s.listing} ${s.realUnits}件`).join("、") + "；库存健康。",
      "维持真实出单节奏，赢家 ROAS 不掉", "验证 2 周后把关键词/PDP 打法复制到同系列 SKU", "若真实件数掉头再降预算诊断"));
    if (burners.length) ledger.push(mk("P0",
      burners.map(b => b.listing).join(" / "),
      "止损：暂停或降到最低预算",
      `有花费、0 真实订单（${burners.map(b => `${b.listing} $${b.spend}`).join("、")}），预计省 ~$${burnSave.toFixed(2)}/周。`,
      `省下 ~$${burnSave.toFixed(2)} 周浪费且不丢核心订单`, "防守性止损，不推广", "若暂停后丢失自然单，只按 30% 预算恢复高意图精确词"));
    if (protects.length) ledger.push(mk("P1",
      protects.map(p => p.listing).join(" / "),
      "别误杀：降到最低预算 + 留高意图精确词观察",
      "广告 0 归因但有真实成交（" + protects.map(p => `${p.listing} ${p.realUnits}件/${p.clicks}点击`).join("、") + "），14 天归因可能滞后。",
      "保住真实出单同时砍低意图花费", "若证明部分订单广告助攻，按 30% 预算恢复更多词", "若砍词后真实单也掉，说明是自然单，广告维持最低"));
    if (trims.length) ledger.push(mk("P1",
      trims.map(t => t.listing).join(" / "),
      "缩减：降 bid / 降预算",
      "花费不低但真实件数很少（" + trims.map(t => `${t.listing} $${t.spend}/${t.realUnits}件`).join("、") + "）。",
      "把预算让给已验证赢家", "无", "连续两周仍低效则暂停"));

    const kpis = {
      realUnits: Object.values(realBySku).reduce((a, b) => a + b, 0),
      adSpend: +Object.values(ad).reduce((t, a) => t + a.spend, 0).toFixed(2),
      burnSave: +burnSave.toFixed(2),
      sellers: sellers.length,
    };
    return { ledger, kpis, sellers, burners, protects, trims };
  }

  root.WFWeeklyReview = { compute, _num: num };
})(typeof module !== "undefined" && module.exports ? module.exports : (window.WF = window.WF || {}, window));
