# 关键词表现 / 排名报表与 TACOS 守护

范围：Wayfair Advertising API 的 `KEYWORD_PRODUCT_REPORT`（SPN）和 `PRODUCT_RANK_REPORT`（WSP）接入，以及“TACOS ≤10% 不设预算上限、扣广告后贡献为负要提醒”的只读建议。全部只给建议，不写出价、预算或 Campaign 状态。

## 结构
- `lib/ads-report-source.mjs`：来源适配层（请求体、CSV 解析、列名容错）。2027 Q1 报表迁移到 Wayfair 统一报表平台时，只换这个文件。
- `lib/ads-extended-sync.mjs`：创建 → 轮询 → 下载 → 按天替换写入 `ad_report_rows`（`report_type` 区分，不改表结构）。
- 每日 06:00（Lingxing）同步在原有“广告同步”之后追加 `ads-keywords`、`ads-rank` 两步；失败只记 `warnings`，不影响订单、广告、Catalog。
- `GET /api/ads/keywords`、`GET /api/ads/rank`：只读库里的数据；`refresh=1` 才会请求 Wayfair，且仅在开关打开时。
- `lib/ads-profit-rules.mjs` / `lib/ads-tacos-guard.mjs`：TACOS 与利润贡献规则；`/api/ads/analysis` 的返回新增 `tacosGuard`。

## 开关与默认值
- `ADS_EXTENDED_REPORTS_ENABLED=true` 才会向 Wayfair 请求这两个报表（默认关闭，缺省即关闭）。
- TACOS 守护不依赖开关，只用库里已有数据。

## 字段口径
- TACOS = 广告花费（CAMPAIGN_REPORT 的 `spend_USD`）÷ 订单总销售额（`orders.revenue_cents`，不含 0 元样品单）。
- 利润贡献 = 归因批发额 WSC − 归因件数 × SKU 成本（`sku_costs`，仅 USD 且已认证）− 广告花费；成本未覆盖时按店铺毛利 28.26% 估算并标“估算”；缺 WSC 时不估算（显示未知）。
- 订单口径的账户级“扣广告后贡献”与 `/api/orders/summary` 的 `contributionAfterAds` 同一算法。

## 只读试调用
```bash
# 在应用容器里（环境变量里已有 WAYFAIR_AD_CLIENT_ID/SECRET），不打印密钥、不写库
node scripts/probe-ads-reports.mjs --confirm-readonly --days 7
```

## 回填（默认演练）
```bash
node scripts/backfill-ads-extended-reports.mjs --days 56            # 演练：只列窗口
ADS_EXTENDED_REPORTS_ENABLED=true ADS_EXTENDED_BACKFILL_CONFIRM=yes \
  node scripts/backfill-ads-extended-reports.mjs --days 56 --run     # 真正写库
```

## 回滚
1. 把 `ADS_EXTENDED_REPORTS_ENABLED` 设回 `false`（或删除），重启应用容器：06:00 同步不再请求这两个报表，页面只读已有数据。
2. 需要清数据时：`DELETE FROM ad_report_rows WHERE report_type IN ('KEYWORD_PRODUCT_REPORT','PRODUCT_RANK_REPORT')` 以及对应的 `ad_report_days`；不会影响 CAMPAIGN_REPORT / LISTING_REPORT。
3. 代码回滚：回到上一个 `production` SHA 重新部署（本次无数据库迁移，无需反向迁移）。

## 审计修复后的行为（第二轮）

- 缺列一律为 `null`（显示“—”），不当 0；没有订单列时不判断“零订单”（建议为“未知”）；页面提示列出缺失的列。
- 归因列同时有 click_through 与 view_through（14 天）时，明确选用 view_through（与现有 Campaign/Listing 口径一致）并在“列名匹配提示”里写明；仍有歧义则取 null。`rank_percentile` 不会被当成排名。
- 最近 14 天内（归因未成熟）“有花费无销售”只标“观察”，不判亏损；TACOS 面板的提醒带“观察/亏损”状态。
- 广告花费覆盖不是 FULL 时，TACOS 只给“暂估”，不提示“可不设预算上限”。
- 排名页“建议”列标“待验证”（`RANK_ADVICE_VALIDATED=false`），用真实样本核对后再改为 true；加投建议要求 Listing TACOS 已知且在 10% 线内。
- `refresh=1` 同时校验 `Origin` 与 `Sec-Fetch-Site`（仅放行 same-origin / none / 无该头的内部同步）。`/api/ads/analysis` 行为未改。
- 报表轮询每 3 秒一次、最多 60 次（约 3 分钟）；超时后报表 id 记入 `sync_state`（键 `ads-extended:pending:<类型>:<起>:<止>`，24 小时有效），下次同步同一窗口时续取而不重复创建。限制：每日窗口随日期平移，窗口变化后上一份未完成报表不会被续取（只会多留一份孤儿报表，不写数据）。
- 每个日期的“删除旧数据 + 写入新数据”在同一个事务里（`db.batch` = BEGIN…COMMIT，失败整日回滚）；多日窗口中途失败时，已完成的日期保持新数据、其余日期保持旧数据。
