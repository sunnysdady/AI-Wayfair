"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Readiness = {
  configured: boolean;
  deployment: string;
  supplierId: string;
  identityMatched: boolean;
  readEnabled: boolean;
  liveSubmitEnabled: boolean;
};

type ProductAdditionRun = {
  id: string;
  operationId: string;
  linkedPreflightOperationId?: string;
  mode: "PREFLIGHT" | "LIVE";
  payloadHash: string;
  status: string;
  requestId?: string;
  batchId?: string;
  lastError?: string;
  updatedAt: string;
};

type Discovery = {
  classId: string;
  categories: unknown[];
  brands: unknown[];
  attributes: unknown[];
};

type ApiResponse = {
  readiness?: Readiness;
  discovery?: Discovery | null;
  runs?: ProductAdditionRun[];
  run?: ProductAdditionRun;
  error?: string;
};

const SAMPLE_PAYLOAD = JSON.stringify(
  {
    proposedProductAdditions: [
      {
        productId: "REPLACE-WITH-UNIQUE-SKU",
        classId: "3",
        attributes: [
          { attributeId: "core::supplierPartNumber", value: "REPLACE-WITH-SKU" },
          { attributeId: "core::manufacturerId", value: "REPLACE-WITH-BRAND-ID" },
          { attributeId: "core::productName", value: "REPLACE-WITH-PRODUCT-NAME" },
        ],
      },
    ],
  },
  null,
  2,
);

const STATUS_LABELS: Record<string, string> = {
  CREATED: "已建档",
  PROCESSING: "Wayfair 处理中",
  SUCCEEDED: "成功待验收",
  CLOSED: "已闭环",
  FAILED: "失败",
};

async function readBody(response: Response) {
  const body = (await response.json()) as ApiResponse;
  if (!response.ok) throw new Error(body.error || `请求失败（HTTP ${response.status}）`);
  return body;
}

export default function ProductAdditionWorkspace() {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [runs, setRuns] = useState<ProductAdditionRun[]>([]);
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [payloadText, setPayloadText] = useState(SAMPLE_PAYLOAD);
  const [preflightRunId, setPreflightRunId] = useState("");
  const [liveConfirmation, setLiveConfirmation] = useState("");
  const [acceptConfirmation, setAcceptConfirmation] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async (discover = false) => {
    setError("");
    const response = await fetch(
      `/api/catalog/product-addition/${discover ? "?discover=1&classId=3" : ""}`,
      { cache: "no-store" },
    );
    const body = await readBody(response);
    setReadiness(body.readiness || null);
    setRuns(body.runs || []);
    if (discover) setDiscovery(body.discovery || null);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/catalog/product-addition/", { cache: "no-store", signal: controller.signal })
      .then(readBody)
      .then((body) => {
        setReadiness(body.readiness || null);
        setRuns(body.runs || []);
      })
      .catch((reason) => {
        if (reason?.name !== "AbortError") setError(reason instanceof Error ? reason.message : "读取失败");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const closedPreflights = useMemo(
    () => runs.filter((run) => run.mode === "PREFLIGHT" && run.status === "CLOSED"),
    [runs],
  );

  async function post(action: string, input: Record<string, unknown>) {
    setBusy(action);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/catalog/product-addition/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...input }),
      });
      const body = await readBody(response);
      setMessage(
        action === "preflight"
          ? "预检已提交；请刷新状态直到自动闭环。"
          : action === "submit"
            ? "正式提交已发送；请刷新状态并人工验收。"
            : action === "accept"
              ? "正式提交已验收闭环。"
              : "状态已刷新。",
      );
      await load(false);
      return body;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "操作失败");
      return null;
    } finally {
      setBusy("");
    }
  }

  function parsedPayload() {
    try {
      return JSON.parse(payloadText) as Record<string, unknown>;
    } catch {
      throw new Error("商品载荷不是有效 JSON");
    }
  }

  async function preflight() {
    try {
      await post("preflight", { payload: parsedPayload() });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "载荷解析失败");
    }
  }

  async function submitLive() {
    try {
      await post("submit", {
        payload: parsedPayload(),
        preflightRunId,
        confirmation: liveConfirmation,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "载荷解析失败");
    }
  }

  if (loading) return <section className="card product-addition-state">正在读取 Product Addition V2 状态…</section>;

  return (
    <div className="product-addition-workspace">
      <section className="card product-addition-summary">
        <div>
          <span>PRODUCTION READINESS</span>
          <h2>Product Addition V2</h2>
          <p>读取、预检、正式提交和验收共用 operationId；正式提交默认关闭，Secret 仅保存在服务端。</p>
        </div>
        <dl>
          <div><dt>供应商</dt><dd>{readiness?.supplierId || "未配置"}</dd></div>
          <div><dt>读取权限</dt><dd className={readiness?.readEnabled ? "ok" : "warn"}>{readiness?.readEnabled ? "可用" : "未就绪"}</dd></div>
          <div><dt>正式提交</dt><dd className={readiness?.liveSubmitEnabled ? "warn" : "ok"}>{readiness?.liveSubmitEnabled ? "已打开" : "安全关闭"}</dd></div>
        </dl>
      </section>

      {error ? <div className="product-addition-alert error" role="alert">{error}</div> : null}
      {message ? <div className="product-addition-alert success" role="status">{message}</div> : null}

      <section className="card product-addition-discovery">
        <header>
          <div><span>READ-ONLY CHECK</span><h3>生产读取权限</h3></div>
          <button
            className="ghost"
            disabled={busy !== "" || !readiness?.readEnabled}
            onClick={() => {
              setBusy("discover");
              setError("");
              load(true).catch((reason) => setError(reason instanceof Error ? reason.message : "读取失败")).finally(() => setBusy(""));
            }}
          >{busy === "discover" ? "验证中…" : "验证生产读取权限"}</button>
        </header>
        {discovery ? (
          <div className="product-addition-metrics">
            <div><b>{discovery.categories.length}</b><span>分类</span></div>
            <div><b>{discovery.brands.length}</b><span>品牌关联</span></div>
            <div><b>{discovery.attributes.length}</b><span>Class {discovery.classId} 属性</span></div>
          </div>
        ) : <p className="product-addition-hint">只执行 OAuth 和三项读取查询，不创建或修改商品。</p>}
      </section>

      <section className="card product-addition-editor">
        <header><div><span>VALIDATE ONLY</span><h3>载荷预检</h3></div><b>不会创建商品</b></header>
        <textarea
          aria-label="Product Addition JSON 载荷"
          spellCheck={false}
          value={payloadText}
          onChange={(event) => setPayloadText(event.target.value)}
        />
        <footer>
          <p>服务端固定 validateOnly=true、ignoreWarnings=false、rejectAllOnErrors=true，并记录载荷 SHA-256。</p>
          <button className="primary" disabled={busy !== "" || !readiness?.readEnabled} onClick={preflight}>
            {busy === "preflight" ? "提交预检中…" : "提交 validateOnly 预检"}
          </button>
        </footer>
      </section>

      <section className="card product-addition-live">
        <header><div><span>LIVE MUTATION</span><h3>正式提交闸门</h3></div><b>{readiness?.liveSubmitEnabled ? "需双重确认" : "服务端已关闭"}</b></header>
        <div className="product-addition-live-controls">
          <label>已闭环预检
            <select value={preflightRunId} onChange={(event) => setPreflightRunId(event.target.value)}>
              <option value="">请选择 operationId</option>
              {closedPreflights.map((run) => <option key={run.id} value={run.id}>{run.operationId}</option>)}
            </select>
          </label>
          <label>确认文本
            <input value={liveConfirmation} onChange={(event) => setLiveConfirmation(event.target.value)} placeholder="SUBMIT PRODUCT ADDITION" />
          </label>
          <button
            className="primary danger"
            disabled={busy !== "" || !readiness?.liveSubmitEnabled || !preflightRunId || liveConfirmation !== "SUBMIT PRODUCT ADDITION"}
            onClick={submitLive}
          >正式提交</button>
        </div>
      </section>

      <section className="card product-addition-runs">
        <header><div><span>CLOSED LOOP LEDGER</span><h3>最近运行</h3></div><button className="ghost" disabled={busy !== ""} onClick={() => load(false).catch((reason) => setError(String(reason)))}>刷新台账</button></header>
        {runs.length ? runs.map((run) => (
          <article key={run.id}>
            <div><span>{run.mode === "PREFLIGHT" ? "预检" : "正式"}</span><strong>{run.operationId}</strong><small>{run.payloadHash.slice(0, 16)}…</small></div>
            <div><b>{STATUS_LABELS[run.status] || run.status}</b><small>{run.requestId || "尚无 requestId"}</small><small>{run.batchId || "尚无 batchId"}</small></div>
            <div className="product-addition-run-actions">
              {(run.status === "PROCESSING" || run.status === "SUCCEEDED") ? <button className="ghost" disabled={busy !== ""} onClick={() => post("refresh", { runId: run.id })}>刷新状态</button> : null}
              {run.mode === "LIVE" && run.status === "SUCCEEDED" ? (
                <><input aria-label="验收确认文本" value={acceptConfirmation} onChange={(event) => setAcceptConfirmation(event.target.value)} placeholder="ACCEPT PRODUCT ADDITION" /><button className="primary" disabled={busy !== "" || acceptConfirmation !== "ACCEPT PRODUCT ADDITION"} onClick={() => post("accept", { runId: run.id, confirmation: acceptConfirmation })}>验收闭环</button></>
              ) : null}
            </div>
            {run.lastError ? <p>{run.lastError}</p> : null}
          </article>
        )) : <p className="product-addition-hint">暂无 Product Addition 运行记录。</p>}
      </section>
    </div>
  );
}
