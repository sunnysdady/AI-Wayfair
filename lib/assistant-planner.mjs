import { modelConfiguration, responseInput, responseText } from "./assistant-model.mjs";
import { validatePlannedCommands } from "./assistant-search.mjs";

const PLANNER_TIMEOUT_MS = 20_000;
const PLANNER_MAX_OUTPUT_TOKENS = 1_000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

const TOOL_CATALOG = [
  '- daily_sales {"date":"YYYY-MM-DD"} 或 {"date_from":"YYYY-MM-DD","date_to":"YYYY-MM-DD"}（最多 31 天，返回合计与逐日）：订单数、销量、销售额',
  '- sku_month_orders {"sku":"DMOM1027","month":"YYYY-MM"}：某 SKU 某月的订单/销量/销售额',
  '- ad_spend {"date":"YYYY-MM-DD"} 或 {"date_from":"YYYY-MM-DD","date_to":"YYYY-MM-DD"}（最多 31 天）或 {}（最近有数据的一天）：广告花费、点击、曝光、14 天归因销售额与订单，含花费最高的 Campaign（来自 CAMPAIGN_REPORT）',
  '- ad_spend_sku {"sku":"DMOM1021","date":"YYYY-MM-DD"} 或带 date_from/date_to 或不带日期（最近一天）：单个 Listing/子 SKU 的广告花费、点击、CPC、归因销售额，及按 Campaign 拆分（来自 LISTING_REPORT）',
  '- sku_economics {"sku":"DMOM1021"}：把 Listing 展开成子 SKU，给出各子 SKU 成本、库存与可售天数、近 90 天实际毛利率和保本 WSC ROAS（Listing 编号或子 SKU 编号都可）',
  '- inventory_sku {"sku":"…"}：某 SKU 的最新库存（现货/在途/仓库）',
  "- inventory_shortage {}：现货为 0 的缺货 SKU 清单",
  "- inventory_overview {}：库存总览",
  '- cost_sku {"sku":"…"}：某 SKU 的成本',
  "- daily_report {}：最新每日运营日报与 Outlook 日报",
  "- ad_actions {}：最近的广告动作及状态（不含花费金额）",
  "- tasks {}：最近的运营任务",
  "- orders_recent {}：最近的采购订单",
  "- reports {}：已上传的报告",
  '- keyword_search {"query":"…"}：以上都不合适时，按 SKU/订单号/标题关键词全库检索',
].join("\n");

function shanghaiToday(now) {
  const shifted = new Date(new Date(now).getTime() + SHANGHAI_OFFSET_MS);
  return { date: shifted.toISOString().slice(0, 10), weekday: WEEKDAYS[shifted.getUTCDay()] };
}

export function plannerInstructions(now = new Date().toISOString()) {
  const today = shanghaiToday(now);
  return [
    "你是 Wayfair 运营数据查询的“意图规划器”。读取用户的自然语言问题，决定要调用哪些只读数据工具来取数，只输出一个 JSON 对象，不要任何解释。",
    `今天是北京时间 ${today.date}（星期${today.weekday}）。用户说的“昨天/前天/上周/本月”等相对时间都按北京日期换算成具体 YYYY-MM-DD。`,
    "可用工具（tool 名必须完全一致）：",
    TOOL_CATALOG,
    '输出格式：{"commands":[{"tool":"ad_spend","date":"2026-10-04"}]}。',
    "规则：",
    "1. 一个问题涉及多类数据时，同时给出多个工具（最多 4 个），例如“昨天销量和广告费”= daily_sales + ad_spend。",
    "2. 用户把问题写成字段清单（如“日期/数据源/指标：Spend、Clicks、Orders”）时，按其含义映射：CAMPAIGN_REPORT、Spend、Clicks、Impressions、归因销售额 → ad_spend；订单、销量、销售额 → daily_sales；两者都出现就都调用。",
    "3. 广告 API 只同步到前一天：问“今天”的广告花费也照常调用 ad_spend，由数据层告知暂无数据。",
    "4. 纯闲聊、运营方法论/建议、与上述数据无关的问题，输出 {\"commands\":[]}。",
    "5. 不要编造 SKU 或日期；缺少必要参数就不要调用该工具。",
    "6. 像运营一样补全对比数据：问某一天的广告花费/广告表现时，同时取同一天的 daily_sales（算广告占比）和前一天的 ad_spend（看环比）；问“最近 N 天”的广告趋势时，取该区间的 ad_spend，再取紧邻的前一个等长区间做对比；问某 SKU 库存时，若同时涉及销售/断货风险，加上 inventory_shortage。总数仍不超过 4 个。",
    "7. 问某个 SKU/Listing 的广告表现（花了多少、值不值、ROAS）用 ad_spend_sku；同时必须补 sku_economics（成本、库存、保本线是判断“值不值/能不能加投”的前提）；Listing 编号（如 DMOM1021）查库存或成本时也用 sku_economics，不要用 inventory_sku/cost_sku。问整个店铺的广告用 ad_spend。",
    "8. 模糊时间词（这几天、最近、近期、这段时间、本周）一律按最近 7 天处理（date_to 取今天）；“值不值/效果怎么样/要不要加投”这类评估问题，广告和销量都要取不少于 7 天的区间，不要只取一天。",
  ].join("\n");
}

function extractJson(text) {
  const cleaned = String(text).replace(/```(?:json)?/gi, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * 让模型把自然语言映射为白名单内的只读数据指令。
 * 返回已校验的指令数组（可能为空，表示无需取数）；模型不可用或输出无法解析时抛错，由调用方回退到关键词规则。
 */
export async function planAssistantCommands(env, input, options = {}) {
  const config = modelConfiguration(env);
  if (!config) throw new Error("model not configured");
  const fetchImpl = options.fetchImpl || fetch;
  const now = (options.now || (() => new Date().toISOString()))();
  const history = (input.history || []).slice(-4);
  const response = await fetchImpl(`${config.baseUrl}/responses`, {
    method: "POST",
    headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      instructions: plannerInstructions(now),
      input: responseInput([...history, { role: "user", content: input.message }]),
      max_output_tokens: PLANNER_MAX_OUTPUT_TOKENS,
    }),
    signal: AbortSignal.timeout(PLANNER_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Planner request failed with ${response.status}`);
  const text = responseText(await response.json());
  const parsed = text ? extractJson(text) : null;
  if (!parsed || !Array.isArray(parsed.commands)) throw new Error("Planner returned no valid JSON plan");
  return validatePlannedCommands(parsed.commands);
}
