"use client";

import { FormEvent, useState } from "react";

import styles from "./workspace.module.css";

type AssistantRecord = {
  source: string;
  reference: string;
  title: string;
  detail: string;
  occurred_at: string | null;
};

type AssistantResponse = {
  answer: string;
  resultCount: number;
  sources: string[];
  records: AssistantRecord[];
  searchedAt: string;
};

const EXAMPLES = ["DMOM1021", "广告", "库存", "BFIJ"];

export default function AssistantWorkspace() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<AssistantResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/api/assistant/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, limit: 8 }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "查询失败");
      setResult(body);
    } catch (caught) {
      setResult(null);
      setError(caught instanceof Error ? caught.message : "查询失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="assistant-title">
        <a className={styles.back} href="/">← 返回运营中台</a>
        <p className={styles.eyebrow}>READ-ONLY DATA ASSISTANT</p>
        <h1 id="assistant-title">运营数据助理</h1>
        <p className={styles.intro}>
          输入 SKU、采购订单号、Campaign 或报告关键词，直接调取数据库中已同步的运营记录。
        </p>
        <p className={styles.notice}>
          当前为只读检索版：不会执行 Wayfair 写操作，结果来自最近保存的快照。
        </p>

        <form className={styles.form} onSubmit={submit}>
          <label htmlFor="assistant-query">查询内容</label>
          <div className={styles.searchRow}>
            <input
              id="assistant-query"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="例如：DMOM1021、广告、BFIJ"
              minLength={2}
              maxLength={120}
              required
            />
            <button type="submit" disabled={loading}>{loading ? "查询中…" : "查询数据"}</button>
          </div>
        </form>

        <div className={styles.examples} aria-label="查询示例">
          {EXAMPLES.map((example) => (
            <button key={example} type="button" onClick={() => setQuery(example)}>{example}</button>
          ))}
        </div>

        {error ? <p className={styles.error} role="alert">{error}</p> : null}

        {result ? (
          <section className={styles.results} aria-live="polite">
            <p className={styles.answer}>{result.answer}</p>
            <p className={styles.meta}>
              检索时间 {new Date(result.searchedAt).toLocaleString("zh-CN", { hour12: false })}
              {result.sources.length ? ` · 来源：${result.sources.join("、")}` : ""}
            </p>
            <div className={styles.cards}>
              {result.records.map((record, index) => (
                <article className={styles.card} key={`${record.source}-${record.reference}-${index}`}>
                  <p>{record.source.replaceAll("_", " ")}</p>
                  <h2>{record.title}</h2>
                  <strong>{record.reference}</strong>
                  <span>{record.detail}</span>
                  {record.occurred_at ? <time>{record.occurred_at}</time> : null}
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </section>
    </main>
  );
}
