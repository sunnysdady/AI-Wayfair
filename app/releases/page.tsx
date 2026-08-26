import type { Metadata } from "next";
import Link from "next/link";

import {
  RELEASE_NOTES,
  validateReleaseNotes,
} from "@/lib/release-notes.mjs";
import { formatLingxingDateTime } from "@/lib/lingxing-business-time.mjs";

export const metadata: Metadata = {
  title: "系统功能与逻辑升级日报 · Wayfair AI",
  description: "Wayfair AI 运营中台系统功能、判断逻辑与生产验证日报。",
};

const release = validateReleaseNotes(RELEASE_NOTES);

export default function ReleasesPage() {
  const versionLabel = `v${release.version}`;
  const nonTerminal = release.operations.total - release.operations.closed;
  return (
    <main className="release-page">
      <header className="release-hero">
        <div>
          <span>Wayfair AI · 版本记录</span>
          <h1>{release.title}</h1>
          <strong className="release-conclusion-label">系统升级结论</strong>
          <p>{release.conclusion}</p>
        </div>
        <aside>
          <b>{versionLabel}</b>
          <small>功能汇总基线 {release.productionBaseline}</small>
          <Link href="/">返回运营中台</Link>
        </aside>
      </header>

      <section className="release-status" aria-label="系统升级指标">
        <article><span>系统模块</span><strong>{release.systemSummary.featureAreas}</strong><small>个功能域完成升级</small></article>
        <article><span>核心逻辑</span><strong>{release.systemSummary.logicUpgrades}</strong><small>组判断规则重构</small></article>
        <article><span>代码提交</span><strong>{release.systemSummary.commits}</strong><small>个昨日生产提交</small></article>
        <article><span>验证测试</span><strong>{release.systemSummary.tests}</strong><small>项全量测试通过</small></article>
      </section>

      <section className="release-section">
        <header><span>管理摘要</span><h2>完成事项、结果与下一步</h2></header>
        <div className="release-highlight-grid">
          {[
            ["今天完成了什么", release.managementBrief.completed],
            ["结果怎么样", release.managementBrief.results],
            ["遇到的阻力", release.managementBrief.blockers],
            ["需要你的协助或授权", release.managementBrief.assistance],
            ["明天计划", release.managementBrief.tomorrow],
          ].map(([title, items]) => (
            <article key={title as string}>
              <h3>{title as string}</h3>
              <ul>{(items as string[]).map((item) => <li key={item}>{item}</li>)}</ul>
            </article>
          ))}
        </div>
      </section>

      <section className="release-section">
        <header><span>系统功能升级</span><h2>昨日进入生产的能力</h2></header>
        <div className="release-highlight-grid">
          {release.systemUpgrades.map((item) => (
            <article key={item.title}>
              <small>{item.area}</small>
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
              <b>{item.outcome}</b>
            </article>
          ))}
        </div>
      </section>

      <section className="release-section">
        <header><span>核心逻辑升级</span><h2>判断方式发生了什么变化</h2></header>
        <div className="release-logic-grid">
          {release.logicUpgrades.map((item, index) => (
            <article key={item.title}>
              <small>{String(index + 1).padStart(2, "0")}</small>
              <div>
                <h3>{item.title}</h3>
                <dl>
                  <div><dt>原逻辑</dt><dd>{item.before}</dd></div>
                  <div><dt>新逻辑</dt><dd>{item.after}</dd></div>
                  <div><dt>解决问题</dt><dd>{item.impact}</dd></div>
                </dl>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="release-section release-daily release-runtime">
        <header><span>运行快照 · 次要信息</span><h2>系统升级后的生产状态</h2></header>
        <div className="release-daily-grid">
          <article>
            <h3>今日工作日报与部署</h3>
            <dl>
              <div><dt>今日 Orders / Units</dt><dd>{release.dailyRun.orders} / {release.dailyRun.units}</dd></div>
              <div><dt>营收 / 广告后贡献</dt><dd>USD {release.dailyRun.revenue.toFixed(2)} / {release.dailyRun.contributionAfterAds.toFixed(2)}</dd></div>
              <div><dt>健康检查</dt><dd>{release.production.health}</dd></div>
              <div><dt>Scheduler</dt><dd>{release.production.scheduler}</dd></div>
            </dl>
          </article>
          <article>
            <h3>Outlook 与财务</h3>
            <dl>
              <div><dt>同步时间</dt><dd>{formatLingxingDateTime(release.outlook.syncedAt)}</dd></div>
              <div><dt>邮件 / 未读</dt><dd>{release.outlook.total} / {release.outlook.unread}</dd></div>
              <div><dt>实际汇款</dt><dd>{release.finance.currency} {release.finance.actualAmount.toFixed(2)}</dd></div>
              <div><dt>汇款单 / 发票</dt><dd>{release.finance.remittanceId} / {release.finance.invoiceCount} 张</dd></div>
            </dl>
          </article>
          <article>
            <h3>闭环台快照</h3>
            <dl>
              <div><dt>已关闭</dt><dd>{release.operations.closed}</dd></div>
              <div><dt>非终态</dt><dd>{nonTerminal}</dd></div>
              <div><dt>待验收 / 复盘</dt><dd>{release.operations.pendingAcceptance} / {release.operations.pendingReview}</dd></div>
              <div><dt>失败待处理</dt><dd>{release.operations.failed}</dd></div>
            </dl>
          </article>
        </div>
      </section>

      <section className="release-section release-followups">
        <header><span>后续待办</span><h2>升级后的持续验证</h2></header>
        <ol>{release.followUps.map((item) => <li key={item}>{item}</li>)}</ol>
      </section>

      <footer className="release-footer">
        <span>修订于 {formatLingxingDateTime(release.generatedAt)}（领星站点时间）</span>
        <span>生产分支 {release.git.branch} · 功能汇总基线 {release.productionBaseline}</span>
      </footer>
    </main>
  );
}
