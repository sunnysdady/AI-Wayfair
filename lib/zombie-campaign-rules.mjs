export const ZOMBIE_MATURE_DAYS = 14;
export const NEAR_ZOMBIE_SPEND_MAX = 0.35;
export const BID_FLOOR = 0.05;

function addDays(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function active(row) {
  const combined = `${row.campaign_status || ""} ${row.campaign_is_active || ""}`;
  return /active|true/i.test(combined) && !/inactive|false/i.test(combined);
}

function metric(rows) {
  return {
    impressions: Math.round(rows.reduce((sum, row) => sum + numeric(row.impressions), 0)),
    clicks: Math.round(rows.reduce((sum, row) => sum + numeric(row.clicks), 0)),
    spend: Number(rows.reduce((sum, row) => sum + numeric(row.spend_USD), 0).toFixed(2)),
    orders: Math.round(rows.reduce((sum, row) => sum + numeric(row.attributed_orders_window_view_through_Day_14), 0)),
  };
}

function latestBy(rows, key) {
  const result = new Map();
  for (const row of rows) {
    const id = String(row[key] || "");
    if (!id) continue;
    const current = result.get(id);
    if (!current || String(row.Date || "") >= String(current.Date || "")) result.set(id, row);
  }
  return result;
}

function parts(row) {
  return String(row?.first_10_part_numbers || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function campaignLinks(listingRows, campaignId) {
  return [...latestBy(listingRows.filter((row) => String(row.campaign_id) === campaignId), "listing").values()];
}

function baseFinding(row, links, recentMetric) {
  const primary = links[0];
  const bid = primary ? numeric(primary.product_default_bid) : 0;
  return {
    campaignId: String(row.campaign_id),
    campaignName: String(row.campaign_name || ""),
    targetingType: String(row.targeting_type || ""),
    site: String(row.store_url || primary?.store_url || ""),
    listing: primary ? String(primary.listing) : "CAMPAIGN",
    productName: String(primary?.product_name || ""),
    linkStatus: primary ? String(primary.product_status || "UNKNOWN").toUpperCase() : "NOT_AVAILABLE",
    bid,
    parts: parts(primary),
    metric: recentMetric,
    execution: "MANUAL_REVIEW",
    before: { bid, active: true },
  };
}

/**
 * @param {{campaignRows?: Array<Record<string, string>>, listingRows?: Array<Record<string, string>>, decisionEnd: string}} input
 */
export function detectZombieCampaigns({ campaignRows = [], listingRows = [], decisionEnd }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(decisionEnd || ""))) throw new Error("decisionEnd must be YYYY-MM-DD");
  const recentStart = addDays(decisionEnd, -(ZOMBIE_MATURE_DAYS - 1));
  const latestCampaigns = latestBy(campaignRows, "campaign_id");
  const findings = [];

  for (const [campaignId, latest] of latestCampaigns) {
    if (!active(latest)) continue;
    const allRows = campaignRows.filter((row) => String(row.campaign_id) === campaignId);
    const historical = metric(allRows);
    if (historical.impressions <= 0) continue;
    const recentRows = allRows.filter((row) => String(row.Date || "") >= recentStart && String(row.Date || "") <= decisionEnd);
    const recent = metric(recentRows);
    const links = campaignLinks(listingRows, campaignId);
    const finding = baseFinding(latest, links, recent);

    if (recent.impressions === 0) {
      const keyword = /keyword/i.test(finding.targetingType);
      const linksBroken = links.length > 0 && links.every((row) => /inactive|false/i.test(String(row.product_status || "")));
      if (keyword || linksBroken) {
        findings.push({
          ...finding,
          severity: "P0",
          actionType: "PAUSE_CAMPAIGN",
          label: keyword ? "暂停旧 Keyword Campaign" : "暂停无有效 Listing 的 Campaign",
          proposed: { active: false, manual: true },
          reasons: [
            `连续${ZOMBIE_MATURE_DAYS}个成熟日0曝光，历史累计${historical.impressions}曝光`,
            keyword ? "Keyword Campaign 当前无投放，需核对关键词资格与重复结构" : `Campaign 挂载的 Listing 均为 ${finding.linkStatus}`,
            "Campaign 启停不在公开 Advertising API 写入范围，仅进入人工执行清单",
          ],
        });
      } else {
        findings.push({
          ...finding,
          severity: "P0",
          actionType: "CHECK_LISTING_ELIGIBILITY",
          label: "核查 Listing eligibility 后决定测试或暂停",
          proposed: { manual: true, checks: ["catalog eligibility", "inventory", "store availability", "bid floor"] },
          reasons: [
            `连续${ZOMBIE_MATURE_DAYS}个成熟日0曝光，历史累计${historical.impressions}曝光`,
            links.length ? `Listing 仍显示 ${finding.linkStatus}，当前 Bid $${finding.bid.toFixed(2)}` : "Listing Report 未返回可核验的挂载关系",
            "未完成链接与库存 Gate 前不自动提价",
          ],
        });
      }
      continue;
    }

    const activeFloorLink = links.find((row) => /active|true/i.test(String(row.product_status || ""))
      && !/inactive|false/i.test(String(row.product_status || ""))
      && numeric(row.product_default_bid) <= BID_FLOOR);
    if (recent.orders === 0 && recent.spend > 0 && recent.spend <= NEAR_ZOMBIE_SPEND_MAX && activeFloorLink) {
      const nearFinding = baseFinding(latest, [activeFloorLink], recent);
      findings.push({
        ...nearFinding,
        severity: "P1",
        actionType: "CHECK_LOW_DELIVERY",
        label: "低投放：选择 7 天 Bid 测试或关闭",
        proposed: { manual: true, testDays: 7, decision: "TEST_OR_PAUSE" },
        reasons: [
          `${ZOMBIE_MATURE_DAYS}个成熟日仅${recent.impressions}曝光、$${recent.spend.toFixed(2)}花费、0单`,
          `Listing 为 ACTIVE，但 Bid 处于 $${BID_FLOOR.toFixed(2)} 最低档`,
          "只允许利润、库存、评分均过 Gate 的 2–3 个战略 SKU 分批测试",
        ],
      });
    }
  }

  return findings.sort((a, b) => a.campaignId.localeCompare(b.campaignId));
}
