import type { Metadata } from "next";
import Link from "next/link";

import {
  RELEASE_NOTES,
  validateReleaseNotes,
} from "@/lib/release-notes.mjs";

export const metadata: Metadata = {
  title: "版本记录 · Wayfair AI 运营中台",
  description: "Wayfair AI 运营中台日终日报与生产版本记录。",
};

const release = validateReleaseNotes(RELEASE_NOTES);

function shanghaiTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export default function ReleasesPage() {
  const nonTerminal = release.operations.total - release.operations.closed;
  const versionLabel = `v${release.version}`;
  return (
    <main className="release-page">
      <header className="release-hero">
        <div>
          <span>Wayfair AI · 版本记录</span>
          <h1>{release.title}</h1>
          <strong className="release-conclusion-label">日终结论</strong>
          <p>{release.conclusion}</p>
        </div>
        <aside>
          <b>{versionLabel}</b>
          <small>生产基线 {release.productionBaseline}</small>
          <Link href="/">返回运营中台</Link>
        </aside>
      </header>

      <section className="release-status" aria-label="版本状态">
        <article><span>今日 Git</span><strong>{release.git.commits}</strong><small>个生产分支提交</small></article>
        <article><span>Outlook 日报</span><strong>{release.outlook.total}</strong><small>{release.outlook.unread} 封未读 · {release.outlook.actionRequired} 项待办</small></article>
        <article><span>闭环任务</span><strong>{release.operations.closed}/{release.operations.total}</strong><small>{nonTerminal} 项仍非终态</small></article>
        <article><span>生产健康</span><strong>{release.production.health}</strong><small>Scheduler {release.production.scheduler}</small></article>
      </section>

      <section className="release-section">
        <header><span>今日收尾</span><h2>已进入生产的工作</h2></header>
        <div className="release-highlight-grid">
          {release.highlights.map((item, index) => (
            <article key={item.title}>
              <small>{String(index + 1).padStart(2, "0")} · {item.area}</small>
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="release-section release-daily">
        <header><span>日报快照</span><h2>2026-07-28 运营状态</h2></header>
        <div className="release-daily-grid">
          <article>
            <h3>Outlook 日报</h3>
            <dl>
              <div><dt>同步时间</dt><dd>{shanghaiTime(release.outlook.syncedAt)}</dd></div>
              <div><dt>邮件 / 未读</dt><dd>{release.outlook.total} / {release.outlook.unread}</dd></div>
              <div><dt>待办</dt><dd>{release.outlook.actionRequired}</dd></div>
              <div><dt>最高优先级</dt><dd>{release.outlook.highestPriority}</dd></div>
            </dl>
          </article>
          <article>
            <h3>任务闭环台</h3>
            <dl>
              <div><dt>已关闭</dt><dd>{release.operations.closed}</dd></div>
              <div><dt>待验收</dt><dd>{release.operations.pendingAcceptance}</dd></div>
              <div><dt>待复盘</dt><dd>{release.operations.pendingReview}</dd></div>
              <div><dt>失败待处理</dt><dd>{release.operations.failed}</dd></div>
            </dl>
          </article>
          <article>
            <h3>生产验收</h3>
            <dl>
              <div><dt>唯一域名</dt><dd>{release.production.domain}</dd></div>
              <div><dt>健康检查</dt><dd>{release.production.health}</dd></div>
              <div><dt>匿名首页</dt><dd>{release.production.anonymousHome}</dd></div>
              <div><dt>运行环境</dt><dd>{release.production.platform}</dd></div>
            </dl>
          </article>
        </div>
      </section>

      <section className="release-section release-followups">
        <header><span>后续待办</span><h2>未达到终态的事项</h2></header>
        <ol>{release.followUps.map((item) => <li key={item}>{item}</li>)}</ol>
      </section>

      <footer className="release-footer">
        <span>生成于 {shanghaiTime(release.generatedAt)}（Asia/Shanghai）</span>
        <span>生产分支 {release.git.branch} · 基线 {release.productionBaseline}</span>
      </footer>
    </main>
  );
}
