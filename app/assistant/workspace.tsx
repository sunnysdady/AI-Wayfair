"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

import styles from "./workspace.module.css";

type AssistantRecord = {
  source: string;
  reference: string;
  title: string;
  detail: string;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  knowledge?: {
    resultCount: number;
    sources: string[];
    records: AssistantRecord[];
    command?: { type: string; date: string; description: string } | null;
  };
  mode?: "model" | "data_only";
  notice?: string;
};

type ChatResponse = {
  message: string;
  mode: "model" | "data_only";
  knowledge?: ChatMessage["knowledge"];
  notice?: string;
};

const EXAMPLES = ["帮助", "DMOM1021 库存风险", "广告表现需要关注什么", "BFIJ 订单进展"];
const WELCOME: ChatMessage = {
  role: "assistant",
  content: "你好，我是 AI 助理。你可以问 SKU、库存、订单、广告、任务和日报相关的问题。我会先读取已保存的运营数据，再基于已配置的大模型进行分析。",
};

export default function AssistantWorkspace({ embedded = false }: { embedded?: boolean }) {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function sendMessage(rawMessage: string) {
    const trimmed = rawMessage.trim();
    if (trimmed.length < 2 || loading) return;

    const nextUserMessage: ChatMessage = { role: "user", content: trimmed };
    const history = messages.slice(-8).map(({ role, content }) => ({ role, content }));
    setMessage("");
    setError("");
    setLoading(true);
    setMessages((current) => [...current, nextUserMessage]);
    try {
      const response = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: trimmed, history }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "AI 助理暂时无法回答");
      const reply = body as ChatResponse;
      setMessages((current) => [...current, {
        role: "assistant",
        content: reply.message,
        knowledge: reply.knowledge,
        mode: reply.mode,
        notice: reply.notice,
      }]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "AI 助理暂时无法回答");
    } finally {
      setLoading(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(message);
  }

  const workspace = (
    <section className={styles.shell} aria-labelledby="assistant-title">
        <header className={styles.header}>
          <div>
            {!embedded ? <Link className={styles.back} href="/">← 返回运营中台</Link> : null}
            <p className={styles.eyebrow}>AI OPERATIONS ASSISTANT</p>
            <h1 id="assistant-title">AI 助理</h1>
            <p>以对话方式分析已同步的 Wayfair 运营数据；所有数据读取与模型调用均在服务端完成。</p>
          </div>
          <span className={styles.readonly}>只读分析</span>
        </header>

        <section className={styles.conversation} aria-label="与 AI 助理对话" aria-live="polite">
          {messages.map((item, index) => (
            <article className={`${styles.message} ${styles[item.role]}`} key={`${item.role}-${index}`}>
              <strong>{item.role === "user" ? "你" : "AI 助理"}</strong>
              <p>{item.content}</p>
              {item.role === "assistant" && item.knowledge ? (
                <details className={styles.sources}>
                  <summary>
                    本次引用 {item.knowledge.resultCount} 条数据
                    {item.knowledge.sources.length ? ` · ${item.knowledge.sources.join("、")}` : ""}
                    {item.knowledge.command ? ` · ${item.knowledge.command.description}` : ""}
                    {item.notice ? ` · ${item.notice}` : ""}
                  </summary>
                  <ul>
                    {item.knowledge.records.slice(0, 4).map((record, recordIndex) => (
                      <li key={`${record.reference}-${recordIndex}`}>
                        <b>{record.title}</b> · {record.detail}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </article>
          ))}
          {loading ? <p className={styles.typing}>AI 助理正在读取数据并思考…</p> : null}
        </section>

        <div className={styles.examples} aria-label="提问示例">
          {EXAMPLES.map((example) => (
            <button key={example} type="button" onClick={() => void sendMessage(example)}>{example}</button>
          ))}
        </div>

        <form className={styles.composer} onSubmit={submit}>
          <label htmlFor="assistant-message">输入你的问题</label>
          <div>
            <textarea
              id="assistant-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="例如：DMOM1021 的库存是否需要补货？"
              minLength={2}
              maxLength={1200}
              rows={3}
              required
            />
            <button type="submit" disabled={loading || message.trim().length < 2}>
              {loading ? "处理中…" : "发送"}
            </button>
          </div>
        </form>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        <p className={styles.notice}>AI 助理不会执行 Wayfair、广告或数据库写操作；建议需由人工确认后执行。</p>
    </section>
  );

  return embedded
    ? <section className={styles.embedded}>{workspace}</section>
    : <main className={styles.page}>{workspace}</main>;
}
