"use client";

/**
 * 广告增长 → 关键词表现 / 排名 两个子页，以及 TACOS 与利润守护面板。
 * 只读、只给建议：这里没有任何写出价、预算或 Campaign 状态的请求。
 * 视觉沿用广告页现有的 card / api-table / good / bad 体系（ui-ux-pro-max：
 * 一致性、文字+符号表达状态而不只靠颜色、对比度、表格横向滚动收在容器内、不用 emoji）。
 */
import { useEffect, useMemo, useState } from "react";

export type TacosAccount = {
  line: number;
  spend: number | null;
  totalSales: number | null;
  tacos: number | null;
  status: "WITHIN_LINE" | "OVER_LINE" | "PROVISIONAL" | "NO_SALES" | "UNKNOWN";
  budgetAdvice: "NO_CAP" | "KEEP_CAP" | "UNKNOWN";
  reason: string;
  coverage: string;
  orders: number;
  contributionAfterAds: number | null;
  contributionBasis: string;
  loss: boolean;
  partial?: boolean;
};
export type LossAlert = {
  level: "listing" | "campaign";
  id: string;
  label: string;
  spend: number | null;
  wsc: number | null;
  contribution: number | null;
  basis: string;
  status: "LOSS" | "SUSPECTED" | "WATCH";
  confirmed: boolean;
  mature: boolean;
};
export type TacosGuardData =
  | { error: string }
  | { line: number; account: TacosAccount; alerts: LossAlert[]; notes: string[]; range?: { start: string; end: string }; mature?: boolean };

type ExtendedView<Row> = {
  kind: "keywords" | "rank";
  enabled: boolean;
  range: { start: string; end: string };
  tacos: { line: number; account: TacosAccount; alerts: LossAlert[]; notes: string[]; mature?: boolean } | null;
  coverage: { expectedDays: number; syncedDays: number; missingDays: string[]; lastRefreshedAt: string | null };
  sync: { status: string; error?: string; rows?: number } | null;
  hints: string[];
  rows: Row[];
  summary: Record<string, number | boolean | string | null>;
  quality: { unmappedColumns: string[]; missingColumns?: string[]; columnNotes?: string[] };
  error?: string;
};
type Advice = { code: string; label: string; validated?: boolean };
type KeywordRow = {
  campaignId: string;
  campaignName: string;
  sku: string;
  productName: string;
  keyword: string;
  matchType: string;
  maxBid: number | null;
  impressions: number | null;
  clicks: number | null;
  spend: number | null;
  orders: number | null;
  retail: number | null;
  wsc: number | null;
  ctr: number | null;
  cvr: number | null;
  retailRoas: number | null;
  wscRoas: number | null;
  contribution: number | null;
  contributionBasis: string;
  loss: boolean;
  suspectedLoss: boolean;
  advice: Advice;
};
type RankRow = {
  sku: string;
  productName: string;
  className: string;
  rank: number | null;
  classSize: number | null;
  tier: "LEAD" | "MID" | "TRAIL" | "UNKNOWN";
  rankChange: number | null;
  adSpend: number | null;
  contribution: number | null;
  contributionBasis: string;
  loss: boolean;
  suspectedLoss: boolean;
  tacos: number | null;
  advice: Advice;
};

const usd = (value: number | null | undefined, digits = 2) =>
  value === null || value === undefined
    ? "—"
    : `${value < 0 ? "-" : ""}$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const pct = (value: number | null | undefined, digits = 1) =>
  value === null || value === undefined ? "—" : `${(value * 100).toFixed(digits)}%`;
const BASIS_LABEL: Record<string, string> = {
  SKU_COST: "按 SKU 成本",
  NO_SALES: "有花费无销售",
  ESTIMATE: "估算",
  UNKNOWN: "未知",
};
const num = (value: number | null | undefined) => (value === null || value === undefined ? "—" : value);

/** 缺数据（null）显示“暂无法判断”，绝不显示成 $0 或绿色“未亏损”。 */
function ContributionCell({ value, basis, loss, suspected }: { value: number | null; basis: string; loss: boolean; suspected: boolean }) {
  if (value === null) {
    return (
      <span>
        <b className="neutral">暂无法判断</b>
        <small>缺少归因批发额或花费</small>
      </span>
    );
  }
  return (
    <span>
      <b className={loss ? "bad" : suspected ? "bad" : value >= 0 ? "good" : "neutral"}>{usd(value)}</b>
      <small>
        {loss ? "亏损 · " : suspected ? "疑似亏损 · " : ""}
        {BASIS_LABEL[basis] || basis}
      </small>
    </span>
  );
}

export function TacosGuardPanel({ guard, compact = false }: { guard: TacosGuardData | null | undefined; compact?: boolean }) {
  if (!guard) return null;
  if ("error" in guard) {
    return <div className="inline-error">TACOS 与利润守护暂不可用：{guard.error}</div>;
  }
  const { account, alerts, notes } = guard;
  const scaleMax = 0.2; // 条形图满格 = 20%，10% 线固定在中间
  const fill = account.tacos === null ? 0 : Math.min(1, account.tacos / scaleMax);
  const within = account.status === "WITHIN_LINE";
  const provisional = account.status === "PROVISIONAL";
  const contributionKnown = account.contributionAfterAds !== null;
  return (
    <section className="card tacos-guard" aria-label="TACOS 与利润守护">
      <div className="section-head">
        <div>
          <span>TACOS GUARD</span>
          <h2>TACOS 与 {pct(guard.line, 0)} 线</h2>
        </div>
        <b>
          {guard.range ? `${guard.range.start} 至 ${guard.range.end} · ` : ""}
          只给建议，不自动改预算或出价
        </b>
      </div>
      <div className="tacos-guard-body">
        <div className="tacos-meter">
          <strong className={within ? "good" : account.status === "OVER_LINE" ? "bad" : "neutral"}>
            {provisional ? "≥ " : ""}
            {pct(account.tacos)}
          </strong>
          {provisional && <em className="tacos-provisional">暂估 · 广告花费数据不全（{account.coverage}），暂不能判断是否可不设预算上限</em>}
          <span>
            {within
              ? "低于 10% 线 · 可不设预算上限"
              : account.status === "OVER_LINE"
                ? "高于 10% 线 · 保留预算上限"
                : provisional
                  ? "待广告花费补齐后再判断"
                  : "暂无法判断"}
          </span>
          <div className="tacos-bar" role="img" aria-label={`TACOS ${pct(account.tacos)}，10% 线`}>
            <i className={within ? "ok" : "over"} style={{ width: `${fill * 100}%` }} />
            <u style={{ left: `${(guard.line / scaleMax) * 100}%` }} />
          </div>
          <small>
            广告花费 {usd(account.spend)} ÷ 总销售额 {usd(account.totalSales)}（{account.orders} 单）
            {account.partial ? " · 广告花费仅部分覆盖，实际可能更高" : ""}
          </small>
        </div>
        <div className="tacos-contribution">
          <small>订单口径 · 扣广告后贡献</small>
          <strong className={!contributionKnown ? "neutral" : account.loss ? "bad" : "good"}>
            {contributionKnown ? usd(account.contributionAfterAds) : "暂无法判断"}
          </strong>
          <span>
            {!contributionKnown
              ? "广告花费未同步，无法计算扣广告后贡献"
              : `${account.loss ? "亏损：订单毛利不足以覆盖广告花费" : "未亏损"} · ${account.contributionBasis === "SKU_COST" ? "SKU 成本已全覆盖" : "含按店铺毛利估算的部分"}`}
          </span>
        </div>
      </div>
      <div className="tacos-alerts">
        <b>{alerts.length ? `扣广告后为负或需观察的项（${alerts.length}）` : "没有扣广告后为负的 Listing / Campaign"}</b>
        {guard.mature === false && alerts.length > 0 && <small>所选周期的归因窗口未满14天：标“观察”的只是暂时没有销售，不算亏损。</small>}
        {alerts.map((alert) => (
          <p key={`${alert.level}:${alert.id}`}>
            <em className={alert.status === "WATCH" ? "neutral" : "bad"}>
              {alert.status === "LOSS" ? "亏损" : alert.status === "SUSPECTED" ? "疑似亏损（估算）" : "观察 · 归因未满14天"}
            </em>
            <span>
              {alert.level === "listing" ? "SKU" : "活动"} · {alert.label}
            </span>
            <b className={alert.status === "WATCH" ? "neutral" : "bad"}>{usd(alert.contribution)}</b>
            <small>
              花费 {usd(alert.spend)} · WSC {usd(alert.wsc)}
            </small>
          </p>
        ))}
      </div>
      {!compact && (
        <details className="tacos-notes">
          <summary>口径说明</summary>
          <ul>
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function useExtendedView<Row>(kind: "keywords" | "rank") {
  const [days, setDaysState] = useState(14);
  // nonce 0 = plain read from the database; >0 = ask Wayfair to refresh first (no-op unless the sync flag is on).
  const [nonce, setNonce] = useState(0);
  const [result, setResult] = useState<{ key: string; data?: ExtendedView<Row>; error?: string } | null>(null);
  const key = `${kind}:${days}:${nonce}`;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/ads/${kind}?days=${days}${nonce > 0 ? "&refresh=1" : ""}`, { cache: "no-store" });
        const body = (await response.json()) as ExtendedView<Row>;
        if (!response.ok || body.error) throw new Error(body.error || `HTTP ${response.status}`);
        if (!cancelled) setResult({ key, data: body });
      } catch (caught) {
        if (!cancelled) setResult({ key, error: caught instanceof Error ? caught.message : "读取失败" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, days, nonce, key]);

  const current = result?.key === key ? result : null;
  return {
    days,
    setDays: (value: number) => {
      setDaysState(value);
      setNonce(0);
    },
    data: current?.data ?? result?.data ?? null,
    loading: !current,
    refreshing: nonce > 0 && !current,
    error: current?.error || "",
    refresh: () => setNonce((value) => value + 1),
  };
}

function Toolbar({
  days,
  setDays,
  onRefresh,
  refreshing,
  enabled,
  children,
}: {
  days: number;
  setDays: (value: number) => void;
  onRefresh: () => void;
  refreshing: boolean;
  enabled: boolean | undefined;
  children?: React.ReactNode;
}) {
  return (
    <section className="period-bar ad-period">
      <div>
        {[7, 14, 30].map((value) => (
          <button key={value} className={days === value ? "active" : ""} onClick={() => setDays(value)}>
            近 {value} 天
          </button>
        ))}
      </div>
      {children}
      <button disabled={refreshing || enabled === false} onClick={onRefresh} title={enabled === false ? "同步开关未开启" : undefined}>
        {refreshing ? "刷新中…" : "从 Wayfair 刷新"}
      </button>
    </section>
  );
}

function StatusLines({ data, error }: { data: ExtendedView<unknown> | null; error: string }) {
  return (
    <>
      {error && <div className="inline-error">{error}</div>}
      {data?.sync?.status === "failed" && <div className="inline-error">刷新失败：{data.sync.error}</div>}
      {data?.hints.map((hint) => (
        <div className="listing-grain-note" key={hint}>
          <span>{hint}</span>
        </div>
      ))}
    </>
  );
}

export function KeywordPerformanceTab() {
  const { days, setDays, data, loading, refreshing, error, refresh } = useExtendedView<KeywordRow>("keywords");
  const [query, setQuery] = useState("");
  const [lossOnly, setLossOnly] = useState(false);
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data?.rows || []).filter(
      (row) =>
        (!lossOnly || row.loss || row.suspectedLoss) &&
        (!needle || `${row.keyword} ${row.sku} ${row.productName} ${row.campaignName}`.toLowerCase().includes(needle)),
    );
  }, [data, query, lossOnly]);
  const summary = data?.summary;
  return (
    <>
      <Toolbar days={days} setDays={setDays} onRefresh={refresh} refreshing={refreshing} enabled={data?.enabled}>
        <label>
          搜索
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="关键词、SKU、商品、Campaign" />
        </label>
        <label className="kw-check">
          <input type="checkbox" checked={lossOnly} onChange={(event) => setLossOnly(event.target.checked)} /> 只看扣广告后为负
        </label>
        <span>{data?.range ? `${data.range.start} 至 ${data.range.end}` : ""}</span>
      </Toolbar>
      <TacosGuardPanel guard={data?.tacos ? { ...data.tacos, range: data.range } : null} compact />
      <StatusLines data={data} error={error} />
      <section className="card ad-manager-card kw-card">
        <div className="listing-grain-note">
          <b>统计口径：关键词 × 商品 × 匹配类型</b>
          <span>
            仅关键词类广告（SPN）有数据；归因窗口 14 天。{String(summary?.mature) === "true" ? "" : "最近 14 天内归因未成熟，亏损建议只做观察。"}
            {summary ? ` 共 ${summary.keywords} 个关键词，花费 ${summary.spend === null ? "—" : usd(Number(summary.spend))}，扣广告后为负 ${Number(summary.lossCount) + Number(summary.suspectedLossCount)} 个。` : ""}
          </span>
        </div>
        <div className="api-table-scroll">
          <div className="api-table kw-table">
            <div className="api-row head">
              <span>关键词 / 匹配</span>
              <span>商品 / Campaign</span>
              <span>Bid</span>
              <span>点击</span>
              <span>花费</span>
              <span>订单</span>
              <span>WSC ROAS</span>
              <span>扣广告后贡献</span>
              <span>建议（仅供参考）</span>
            </div>
            {rows.map((row) => (
              <article className="api-row" key={`${row.campaignId}:${row.sku}:${row.keyword}:${row.matchType}`}>
                <span>
                  <b>{row.keyword || "—"}</b>
                  <small>{row.matchType || "—"}</small>
                </span>
                <span>
                  <b>{row.productName || row.sku || "—"}</b>
                  <small>
                    {row.sku} · {row.campaignName || `Campaign ${row.campaignId}`}
                  </small>
                </span>
                <b>{usd(row.maxBid)}</b>
                <b>{num(row.clicks)}</b>
                <b>{usd(row.spend)}</b>
                <b>{num(row.orders)}</b>
                <strong>{row.wscRoas === null ? "—" : `${row.wscRoas.toFixed(2)}×`}</strong>
                <ContributionCell value={row.contribution} basis={row.contributionBasis} loss={row.loss} suspected={row.suspectedLoss} />
                <span>
                  <em className={row.loss || row.suspectedLoss || row.advice.code === "LOWER_OR_DROP" ? "bad" : row.advice.code.startsWith("KEEP") ? "good" : "neutral"}>
                    {row.advice.label}
                  </em>
                </span>
              </article>
            ))}
            {!loading && !rows.length ? <p className="empty-state">当前周期没有关键词数据。</p> : null}
            {loading ? <p className="empty-state">读取中…</p> : null}
          </div>
        </div>
      </section>
    </>
  );
}

const TIER_LABEL: Record<string, string> = { LEAD: "领先", MID: "中游", TRAIL: "落后", UNKNOWN: "未知" };

export function RankTab() {
  const { days, setDays, data, loading, refreshing, error, refresh } = useExtendedView<RankRow>("rank");
  const [query, setQuery] = useState("");
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data?.rows || []).filter((row) => !needle || `${row.sku} ${row.productName} ${row.className}`.toLowerCase().includes(needle));
  }, [data, query]);
  return (
    <>
      <Toolbar days={days} setDays={setDays} onRefresh={refresh} refreshing={refreshing} enabled={data?.enabled}>
        <label>
          搜索
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="SKU、商品、类目" />
        </label>
        <span>{data?.range ? `${data.range.start} 至 ${data.range.end}` : ""}</span>
      </Toolbar>
      <TacosGuardPanel guard={data?.tacos ? { ...data.tacos, range: data.range } : null} compact />
      <StatusLines data={data} error={error} />
      <section className="card ad-manager-card rank-card">
        <div className="listing-grain-note">
          <b>统计口径：商品在所属类目内按销量的排名</b>
          <span>仅 WSP 商品广告有数据；位置按 排名÷类目商品数 划分（前 20% 领先、后 40% 落后），类目商品数缺失时不分档。“建议”列尚未用真实报表样本验证，仅供参考，不据此投放。</span>
        </div>
        <div className="api-table-scroll">
          <div className="api-table rank-table">
            <div className="api-row head">
              <span>SKU / 商品</span>
              <span>类目</span>
              <span>排名</span>
              <span>变化</span>
              <span>位置</span>
              <span>广告花费</span>
              <span>TACOS</span>
              <span>扣广告后贡献</span>
              <span>建议（待验证）</span>
            </div>
            {rows.map((row) => (
              <article className="api-row" key={row.sku}>
                <span>
                  <b>{row.productName || row.sku}</b>
                  <small>{row.sku}</small>
                </span>
                <span>{row.className || "—"}</span>
                <b>{row.rank === null ? "—" : row.classSize ? `${row.rank} / ${row.classSize}` : row.rank}</b>
                <b className={row.rankChange === null ? "neutral" : row.rankChange > 0 ? "good" : row.rankChange < 0 ? "bad" : "neutral"}>
                  {row.rankChange === null ? "—" : row.rankChange > 0 ? `上升 ${row.rankChange}` : row.rankChange < 0 ? `下降 ${-row.rankChange}` : "持平"}
                </b>
                <em className={row.tier === "LEAD" ? "good" : row.tier === "TRAIL" ? "bad" : "neutral"}>{TIER_LABEL[row.tier]}</em>
                <b>{usd(row.adSpend)}</b>
                <b className={row.tacos === null ? "neutral" : row.tacos <= 0.1 ? "good" : "bad"}>{pct(row.tacos)}</b>
                <ContributionCell value={row.contribution} basis={row.contributionBasis} loss={row.loss} suspected={row.suspectedLoss} />
                <span>
                  <em className="neutral">
                    {row.advice.validated === true ? "" : "待验证 · "}
                    {row.advice.label}
                  </em>
                </span>
              </article>
            ))}
            {!loading && !rows.length ? <p className="empty-state">当前周期没有排名数据。</p> : null}
            {loading ? <p className="empty-state">读取中…</p> : null}
          </div>
        </div>
      </section>
    </>
  );
}
