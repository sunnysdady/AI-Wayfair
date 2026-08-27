import type { Metadata } from "next";
import Link from "next/link";

import {
  RELEASE_NOTES,
  validateReleaseNotes,
} from "@/lib/release-notes.mjs";
import { formatLingxingDateTime } from "@/lib/lingxing-business-time.mjs";

export const metadata: Metadata = {
  title: "v0.3.0 产品属性评分工作台 · Wayfair AI",
  description: "Wayfair AI 运营中台产品属性评分、规则提示、关联闭环与生产验收记录。",
};

const release = validateReleaseNotes(RELEASE_NOTES);

export default function ReleasesPage() {
  const versionLabel = `v${release.version}`;
  return (
    <main className="release-page">
      <header className="release-hero">
        <div>
          <span>Wayfair AI · 版本记录</span>
          <h1>{release.title}</h1>
          <strong className="release-conclusion-label">版本发布结论</strong>
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
        <article><span>代码提交</span><strong>{release.systemSummary.commits}</strong><small>个本次功能提交</small></article>
        <article><span>验证测试</span><strong>{release.systemSummary.tests}</strong><small>项全量测试通过</small></article>
      </section>

      <section className="release-section">
        <header><span>管理摘要</span><h2>完成事项、结果与下一步</h2></header>
        <div className="release-highlight-grid">
          {[
            ["本次完成", release.managementBrief.completed],
            ["验收结果", release.managementBrief.results],
            ["当前限制", release.managementBrief.blockers],
            ["协助与授权", release.managementBrief.assistance],
            ["后续计划", release.managementBrief.tomorrow],
          ].map(([title, items]) => (
            <article key={title as string}>
              <h3>{title as string}</h3>
              <ul>{(items as string[]).map((item) => <li key={item}>{item}</li>)}</ul>
            </article>
          ))}
        </div>
      </section>

      <section className="release-section">
        <header><span>系统功能升级</span><h2>本次进入生产的能力</h2></header>
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
        <header><span>发布验收</span><h2>生产状态、安全闸门与验证结果</h2></header>
        <div className="release-daily-grid">
          <article>
            <h3>生产部署</h3>
            <dl>
              <div><dt>域名</dt><dd>{release.production.domain}</dd></div>
              <div><dt>功能镜像基线</dt><dd>{release.production.imageTag}</dd></div>
              <div><dt>健康检查</dt><dd>{release.production.health}</dd></div>
              <div><dt>Web / Scheduler</dt><dd>{release.production.web} / {release.production.scheduler}</dd></div>
              <div><dt>PostgreSQL</dt><dd>{release.production.database}</dd></div>
            </dl>
          </article>
          <article>
            <h3>质量验证</h3>
            <dl>
              <div><dt>全量测试</dt><dd>{release.verification.testsPassed} 通过 / {release.verification.testsFailed} 失败</dd></div>
              <div><dt>生产构建</dt><dd>{release.verification.build}</dd></div>
              <div><dt>ESLint</dt><dd>{release.verification.lintErrors} 错误 / {release.verification.lintWarnings} 既有警告</dd></div>
              <div><dt>近期日志</dt><dd>{release.verification.logs}</dd></div>
            </dl>
          </article>
          <article>
            <h3>安全与范围</h3>
            <dl>
              <div><dt>正式提交</dt><dd>{release.guardrails.liveSubmit}</dd></div>
              <div><dt>评分写入范围</dt><dd>{release.guardrails.assessmentWriteScope}</dd></div>
              <div><dt>单次商品上限</dt><dd>{release.guardrails.maxProductsPerAssessment}</dd></div>
              <div><dt>Class 范围</dt><dd>{release.guardrails.classScope}</dd></div>
              <div><dt>页面 / API 保护</dt><dd>{release.production.protectedProductPage} / {release.production.protectedProductAdditionApi}</dd></div>
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
