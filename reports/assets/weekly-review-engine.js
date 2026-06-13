/* Wayfair 周复盘优化引擎 v2 · 纯 JS（无 Pyodide）
 *
 * 在 codex 周复盘逻辑基础上落地的改进（P0+P1+部分 P2）：
 *  1) 真实订单优先于广告 14 天归因（避免 DMOM1019 式误杀）。
 *  2) ROAS 用 retail ROAS（= 归因零售额/花费）做辅助，保/停以真实件数为准。
 *  3) 库存硬门槛：赢家要"加预算"必须库存健康；低库存→先补货；缺货→止血。
 *  4) 利润闸：成本未回填期间，所有"加预算"标"待毛利确认"。
 *  5) 闭环：账本行带 result 字段（待回填），到期记结果再触发推广/止损。
 *  6) 进攻：若提供 Search Term Research，输出高曝光低占位的抢词机会。
 *  7) 分店铺：US / CA 区分，CA 最低出价挂机单独提示。
 *
 * 用法： WFWeeklyReview.compute({product, orders, inventoryMap, stockMap, searchTerms?})
 */
(function (root) {
  function num(v) {
    if (v === undefined || v === null || v === "") return 0;
    const n = parseFloat(String(v).replace(/[, ]/g, ""));
    return isFinite(n) ? n : 0;
  }
  function norm(s) { return String(s == null ? "" : s).trim(); }
  function store(u) { u = String(u); return /\.ca/.test(u) ? "CA" : (/Professional/.test(u) ? "US-B2B" : "US-B2C"); }

  const T = {
    burnSpend: 8, trimSpend: 30, trimUnitsMax: 2, winUnits: 3,
    stockHealthy: 10,        // 库存硬门槛：≥ 此值才允许加预算
    marginConfirmed: false,  // 6月成本未回填 → 利润闸开着
    parkedBid: 0.05,         // ≤ 此值视为挂机最低出价
    oppImpr: 300, oppTop8: 5, // 搜索词机会：30天曝光≥300 且 进top8占比<5%
  };

  function compute(tables) {
    const product = tables.product || [];
    const orders = tables.orders || [];
    const invMap = tables.inventoryMap || {};
    const stockMap = tables.stockMap || {};
    const searchTerms = tables.searchTerms || [];

    // 1) 广告按 listing 聚合（含店铺拆分、零售额用于 ROAS）
    const ad = {};
    for (const r of product) {
      const lst = norm(r.listing); if (!lst) continue;
      const a = ad[lst] || (ad[lst] = { spend: 0, clicks: 0, attrOrders: 0, retail: 0, sku: norm(r.first_10_part_numbers), name: norm(r.product_name), stores: {} });
      a.spend += num(r.spend_USD);
      a.clicks += num(r.clicks);
      a.attrOrders += num(r.attributed_orders_window_view_through_Day_14);
      a.retail += num(r.attributed_retail_sales_window_view_through_USD_Day_14);
      const st = store(r.store_url); a.stores[st] = (a.stores[st] || 0) + num(r.spend_USD);
    }

    // 2) 真实订单按 Wayfair SKU
    const realBySku = {};
    for (const o of orders) {
      const wf = invMap[norm(o.SKU || o.sku)] || ""; if (!wf) continue;
      realBySku[wf] = (realBySku[wf] || 0) + num(o["数量"] || o.qty || 1);
    }
    const wfSkusOf = (lst) => ((ad[lst] && ad[lst].sku) || "").split(",").map(norm).filter(Boolean);
    const realUnits = (lst) => wfSkusOf(lst).reduce((t, s) => t + (realBySku[s] || 0), 0);
    const stock = (lst) => wfSkusOf(lst).reduce((t, s) => t + (stockMap[s] || 0), 0);

    // 3) 规则引擎（真实订单优先 + 库存硬门槛）
    const sellers = [], burners = [], trims = [], protects = [], restock = [];
    for (const lst of Object.keys(ad)) {
      const a = ad[lst]; const ru = realUnits(lst); const stk = stock(lst);
      const roas = a.spend > 0 ? +(a.retail / a.spend).toFixed(1) : 0;
      const row = { listing: lst, sku: a.sku, name: a.name, spend: +a.spend.toFixed(2), clicks: a.clicks, attrOrders: a.attrOrders, realUnits: ru, stock: stk, roas };
      if (ru >= T.winUnits) {                       // 真实赢家
        if (stk <= 0) restock.push({ ...row, _why: "oos" });        // 缺货止血
        else if (stk < T.stockHealthy) restock.push({ ...row, _why: "low" }); // 先补货
        else sellers.push(row);                                      // 加预算/维持
      } else if (a.spend >= T.burnSpend && ru === 0) burners.push(row);
      else if (a.spend >= T.trimSpend && ru <= T.trimUnitsMax) trims.push(row);
      else if (ru > 0 && a.attrOrders === 0) protects.push(row);     // 别误杀
    }
    sellers.sort((x, y) => y.realUnits - x.realUnits);
    burners.sort((x, y) => y.spend - x.spend);

    // 4) 进攻：搜索词机会（高曝光、进 top8 占比低）
    const opps = [];
    for (const r of searchTerms) {
      const brand = norm(r.brand_catalog || r.brand);
      const impr = num(r.total_search_term_impressions_in_the_last_30_days || r.imp30);
      const top8 = num(r.supplier_share_of_top_8_pct || r.share_top8 || r["supplier_share_of_top_8_%"]);
      const term = norm(r.customer_search_term || r.term);
      if (/US/i.test(brand) && impr >= T.oppImpr && top8 < T.oppTop8 && term)
        opps.push({ term, cls: norm(r.class_name || r.cls), impr, top8 });
    }
    opps.sort((x, y) => y.impr - x.impr);

    // 5) 动作账本（codex 14 字段 + result 闭环字段）
    const cycle = "2026-06-06 to 2026-06-12";
    let seq = 0;
    const marginTag = T.marginConfirmed ? "" : "（待毛利确认：6月成本未回填，按件数+花费判断）";
    const mk = (level, type, object, decision, reason, expect, promote, stop) => ({
      action_id: "WBR-AUTO-" + String(++seq).padStart(3, "0"),
      cycle, cadence: "Weekly", type, object, level, decision, reason,
      owner: "运营", due_date: "", expected_metric: expect, next_check: "", status: "Pending",
      result: "", promote_rule: promote, stop_loss_rule: stop,
    });
    const ledger = [];
    const burnSave = burners.reduce((t, b) => t + b.spend, 0);

    if (sellers.length) ledger.push(mk("P0", "放量",
      sellers.map(s => s.listing).join(" / "),
      "保护赢家：维持/小幅加预算" + marginTag,
      "真实订单领先且库存健康：" + sellers.slice(0, 4).map(s => `${s.listing} ${s.realUnits}件/库存${s.stock}`).join("、") + "。",
      "维持真实出单节奏，赢家 retail ROAS 不掉（参考 " + sellers.map(s => s.listing + " " + s.roas).join("、") + "）",
      "验证 2 周后把关键词/PDP 打法复制到同系列 SKU", "若真实件数掉头或毛利确认为负再降预算"));

    if (restock.length) ledger.push(mk("P0", "补货闸",
      restock.map(r => `${r.listing}(库存${r.stock})`).join(" / "),
      "真实赢家但库存不足：先补货，暂不加预算",
      "这些 SKU 真实在出单，但可用库存低于安全线（缺货/≤" + T.stockHealthy + "），加预算会缺货空投。",
      "补货到位后再进放量池", "补货完成且库存≥" + T.stockHealthy + "才解锁加预算", "缺货期把广告降到最低止血"));

    if (burners.length) ledger.push(mk("P0", "止损",
      burners.map(b => b.listing).join(" / "),
      "止损：暂停或降到最低预算",
      `有花费、0 真实订单（${burners.map(b => `${b.listing} $${b.spend}`).join("、")}），预计省 ~$${burnSave.toFixed(2)}/周。`,
      `省下 ~$${burnSave.toFixed(2)} 周浪费且不丢核心订单`,
      "防守性止损，不推广", "若暂停后丢失自然单，只按 30% 预算恢复高意图精确词"));

    if (protects.length) ledger.push(mk("P1", "别误杀",
      protects.map(p => p.listing).join(" / "),
      "别误杀：降到最低预算 + 留高意图精确词观察",
      "广告 0 归因但有真实成交（" + protects.map(p => `${p.listing} ${p.realUnits}件/${p.clicks}点击`).join("、") + "），14 天归因可能滞后。",
      "保住真实出单同时砍低意图花费", "若证明部分订单广告助攻，按 30% 预算恢复更多词", "若砍词后真实单也掉，说明是自然单，广告维持最低"));

    if (trims.length) ledger.push(mk("P1", "缩减",
      trims.map(t => t.listing).join(" / "),
      "缩减：降 bid / 降预算",
      "花费不低但真实件数很少（" + trims.map(t => `${t.listing} $${t.spend}/${t.realUnits}件`).join("、") + "）。",
      "把预算让给已验证赢家", "无", "连续两周仍低效则暂停"));

    if (opps.length) ledger.push(mk("P2", "进攻",
      opps.slice(0, 6).map(o => o.term).join(" / "),
      "抢量机会：确认对应 Listing 在投并补词/提 bid",
      "高曝光但你进 top8 占比低：" + opps.slice(0, 4).map(o => `${o.term}(${o.impr}曝光/${o.top8}%)`).join("、") + "。",
      "把高流量低占位词的自然位+广告位抢回来", "占位提升且 ROAS 达标后纳入常规投放", "投放两周无转化则停词"));

    // 分店铺与挂机检查
    const storeSpend = {};
    for (const lst of Object.keys(ad)) for (const [st, sp] of Object.entries(ad[lst].stores)) storeSpend[st] = (storeSpend[st] || 0) + sp;
    const caParked = product.filter(r => store(r.store_url) === "CA" && num(r.product_default_bid) <= T.parkedBid && num(r.spend_USD) < 0.2).length;
    if (caParked > 0) ledger.push(mk("P2", "分店铺",
      "CA 加拿大站", "CA 多为 $0.05 最低出价挂机：单独评估是否值得真正投放",
      `检测到 ${caParked} 条 CA 产品定向在最低出价、几乎 0 花费，相当于挂着没投。`,
      "明确 CA 是放弃、维持挂机、还是认真投一档", "若 CA 有真实订单潜力，单独给小预算测试", "无订单则保持挂机不占精力"));

    const kpis = {
      realUnits: Object.values(realBySku).reduce((a, b) => a + b, 0),
      adSpend: +Object.values(ad).reduce((t, a) => t + a.spend, 0).toFixed(2),
      burnSave: +burnSave.toFixed(2),
      sellers: sellers.length,
      storeSpend: Object.fromEntries(Object.entries(storeSpend).map(([k, v]) => [k, +v.toFixed(2)])),
      marginConfirmed: T.marginConfirmed,
    };
    return { ledger, kpis, sellers, burners, protects, trims, restock, opps };
  }

  root.WFWeeklyReview = { compute, _num: num };
})(typeof module !== "undefined" && module.exports ? module.exports : (window.WF = window.WF || {}, window));
