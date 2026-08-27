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

type AttributeRule = {
  taxonomyAttributeId?: string;
  internalName?: string;
  title?: string;
  description?: string;
  requirement?: string;
  isActive?: boolean;
  isMultiValue?: boolean;
  isCustomEligible?: boolean;
  possibleAttributeValues?: Array<{ value?: string }>;
  valueFormat?: {
    datatype?: string;
    canValueBeCustomized?: boolean;
  };
};

type Discovery = {
  classId: string;
  categories: unknown[];
  brands: unknown[];
  attributes: AttributeRule[];
};

type HealthIssue = {
  code: string;
  severity: "BLOCKER" | "WARNING";
  attributeId: string;
  title: string;
  message: string;
  suggestion: string;
  currentValues: string[];
  allowedValues: string[];
};

type AttributeAssessment = {
  productId: string;
  classId: string;
  score: number;
  band: string;
  hardGate: "PASS" | "BLOCKED";
  canRunValidateOnly: boolean;
  components: Record<string, number>;
  stats: {
    activeRules: number;
    required: number;
    requiredPresent: number;
    recommended: number;
    recommendedPresent: number;
    checkedValues: number;
    validValues: number;
    blockers: number;
    warnings: number;
  };
  issues: HealthIssue[];
};

type ProductAssessment = {
  assessmentId: string;
  operationId: string;
  assessedAt: string;
  classId: string;
  ruleFingerprint: string;
  payloadFingerprint: string;
  method: {
    name: string;
    version: string;
    weights: Record<string, number>;
  };
  aggregate: {
    products: number;
    averageScore: number;
    blockedProducts: number;
    validateOnlyReadyProducts: number;
  };
  limitations: Array<{ code: string; message: string }>;
  products: AttributeAssessment[];
};

type ApiResponse = {
  readiness?: Readiness;
  discovery?: Discovery | null;
  runs?: ProductAdditionRun[];
  run?: ProductAdditionRun;
  assessment?: ProductAssessment;
  error?: string;
};

const COMPONENT_LABELS: Record<string, string> = {
  requiredCompleteness: "必填完整度",
  observableValueValidity: "可观察值合规",
  recommendedCompleteness: "推荐项完整度",
  identityCompleteness: "身份字段完整度",
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
  const [assessment, setAssessment] = useState<ProductAssessment | null>(null);
  const [classId, setClassId] = useState("3");
  const [ruleFilter, setRuleFilter] = useState<"ALL" | "REQUIRED" | "RECOMMENDED">("ALL");
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
      `/api/catalog/product-addition/${discover ? `?discover=1&classId=${encodeURIComponent(classId)}` : ""}`,
      { cache: "no-store" },
    );
    const body = await readBody(response);
    setReadiness(body.readiness || null);
    setRuns(body.runs || []);
    if (discover) setDiscovery(body.discovery || null);
  }, [classId]);

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

  const visibleRules = useMemo(() => {
    const active = (discovery?.attributes || []).filter((rule) => rule.isActive !== false);
    if (ruleFilter === "ALL") return active;
    return active.filter((rule) => String(rule.requirement || "").toUpperCase().includes(ruleFilter));
  }, [discovery, ruleFilter]);

  const assessmentGatePassed = Boolean(
    assessment &&
    assessment.aggregate.blockedProducts === 0 &&
    assessment.aggregate.validateOnlyReadyProducts === assessment.aggregate.products,
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
      if (!assessmentGatePassed) throw new Error("请先完成属性评分，并修复所有硬性阻断项");
      await post("preflight", { payload: parsedPayload() });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "载荷解析失败");
    }
  }

  async function assess() {
    try {
      const body = await post("assess", { payload: parsedPayload() });
      if (!body?.assessment) return;
      setAssessment(body.assessment);
      if (body.discovery) setDiscovery(body.discovery);
      setMessage(
        body.assessment.aggregate.blockedProducts
          ? `评分完成：${body.assessment.aggregate.blockedProducts} 个商品被硬性闸门阻断，请按属性提示修复。`
          : "评分完成：本地可观察规则已通过，可以进入 Wayfair validateOnly 终验。",
      );
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
          <span>ATTRIBUTE HEALTH CENTER</span>
          <h2>产品属性体检中心</h2>
          <p>读取 Wayfair Product Addition V2 的真实 Class 属性规则，展示属性要求、评分并定位缺失项；评分是系统评估，不是 Wayfair 官方评分，最终仍以 validateOnly 为准。</p>
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
          <div><span>WAYFAIR RULE SNAPSHOT</span><h3>属性要求与候选值</h3></div>
          <div className="product-addition-discovery-controls">
            <label>Class ID<input value={classId} onChange={(event) => setClassId(event.target.value)} /></label>
            <button
              className="ghost"
              disabled={busy !== "" || !readiness?.readEnabled || !classId.trim()}
              onClick={() => {
                setBusy("discover");
                setError("");
                load(true).catch((reason) => setError(reason instanceof Error ? reason.message : "读取失败")).finally(() => setBusy(""));
              }}
            >{busy === "discover" ? "读取中…" : "读取 Wayfair 属性规则"}</button>
          </div>
        </header>
        {discovery ? (
          <>
            <div className="product-addition-metrics">
              <div><b>{discovery.categories.length}</b><span>分类</span></div>
              <div><b>{discovery.brands.length}</b><span>品牌关联</span></div>
              <div><b>{discovery.attributes.length}</b><span>Class {discovery.classId} 属性规则</span></div>
            </div>
            <div className="product-attribute-filter" aria-label="属性规则筛选">
              {(["ALL", "REQUIRED", "RECOMMENDED"] as const).map((filter) => (
                <button key={filter} className={ruleFilter === filter ? "active" : ""} onClick={() => setRuleFilter(filter)}>
                  {filter === "ALL" ? "全部属性" : filter === "REQUIRED" ? "必填" : "推荐"}
                </button>
              ))}
              <small>显示 {Math.min(visibleRules.length, 120)} / {visibleRules.length} 条</small>
            </div>
            <div className="product-attribute-rule-list">
              {visibleRules.slice(0, 120).map((rule) => {
                const id = rule.taxonomyAttributeId || rule.internalName || "unknown";
                const allowed = (rule.possibleAttributeValues || []).map((item) => item.value).filter(Boolean);
                const requirement = String(rule.requirement || "OPTIONAL").toUpperCase();
                return (
                  <article key={id}>
                    <div>
                      <span className={requirement.includes("REQUIRED") ? "required" : requirement.includes("RECOMMENDED") ? "recommended" : "optional"}>
                        {requirement.includes("REQUIRED") ? "必填" : requirement.includes("RECOMMENDED") ? "推荐" : "选填"}
                      </span>
                      <strong>{rule.title || rule.internalName || id}</strong>
                      <code>{id}</code>
                    </div>
                    <dl>
                      <div><dt>类型</dt><dd>{rule.valueFormat?.datatype || "未声明"}</dd></div>
                      <div><dt>取值</dt><dd>{rule.isMultiValue ? "多值" : "单值"}</dd></div>
                      <div><dt>自定义</dt><dd>{rule.valueFormat?.canValueBeCustomized || rule.isCustomEligible ? "允许" : "受限"}</dd></div>
                    </dl>
                    <p>{rule.description || (allowed.length ? `候选值：${allowed.slice(0, 8).join("、")}${allowed.length > 8 ? "…" : ""}` : "Wayfair 未返回补充说明")}</p>
                  </article>
                );
              })}
            </div>
          </>
        ) : <p className="product-addition-hint">只读取 OAuth、分类、品牌和属性规则，不创建、不修改商品，也不读取库存。</p>}
      </section>

      <section className="card product-addition-editor">
        <header><div><span>DRAFT ATTRIBUTE ASSESSMENT</span><h3>商品属性草稿与评分</h3></div><b>本地硬性 Gate → Wayfair validateOnly</b></header>
        <textarea
          aria-label="Product Addition JSON 载荷"
          spellCheck={false}
          value={payloadText}
          onChange={(event) => {
            setPayloadText(event.target.value);
            setAssessment(null);
          }}
        />
        <footer>
          <p>评分先检查必填、推荐、数据类型、单/多值和候选值；父子条件及 Wayfair 服务端规则由 validateOnly 终验。</p>
          <div className="product-addition-editor-actions">
            <button className="ghost" disabled={busy !== "" || !readiness?.readEnabled} onClick={assess}>
              {busy === "assess" ? "评分中…" : "生成属性评分"}
            </button>
            <button className="primary" disabled={busy !== "" || !readiness?.readEnabled || !assessmentGatePassed} onClick={preflight}>
              {busy === "preflight" ? "提交预检中…" : "进入 validateOnly 终验"}
            </button>
          </div>
        </footer>
      </section>

      {assessment ? (
        <section className="card product-attribute-assessment">
          <header>
            <div><span>WAYFAIR ATTRIBUTE COMPLIANCE</span><h3>属性合规完成度</h3></div>
            <b>{assessment.method.name}</b>
          </header>
          <div className="product-attribute-scoreboard">
            <div className={assessment.aggregate.blockedProducts ? "blocked" : "passed"}>
              <b>{assessment.aggregate.averageScore}</b><span>平均分 / 100</span>
            </div>
            <dl>
              <div><dt>商品</dt><dd>{assessment.aggregate.products}</dd></div>
              <div><dt>硬性阻断</dt><dd>{assessment.aggregate.blockedProducts}</dd></div>
              <div><dt>可进终验</dt><dd>{assessment.aggregate.validateOnlyReadyProducts}</dd></div>
            </dl>
            <div className="product-attribute-receipt">
              <span>闭环 operationId</span><code>{assessment.operationId}</code>
              <span>assessmentId</span><code>{assessment.assessmentId}</code>
            </div>
          </div>
          {assessment.products.map((product) => (
            <article className="product-attribute-product" key={`${product.productId}-${product.classId}`}>
              <header>
                <div><span>{product.hardGate === "PASS" ? "LOCAL GATE PASS" : "LOCAL GATE BLOCKED"}</span><h4>{product.productId || "未命名商品"}</h4></div>
                <div className={`product-attribute-score ${product.hardGate === "PASS" ? "passed" : "blocked"}`}><b>{product.score}</b><small>{product.band}</small></div>
              </header>
              <div className="product-attribute-components">
                {Object.entries(product.components).map(([key, value]) => (
                  <div key={key}><span>{COMPONENT_LABELS[key] || key}</span><b>{value}</b></div>
                ))}
              </div>
              {product.issues.length ? (
                <div className="product-attribute-issues">
                  {product.issues.map((issue, index) => (
                    <article className={issue.severity === "BLOCKER" ? "blocker" : "warning"} key={`${issue.code}-${issue.attributeId}-${index}`}>
                      <span>{issue.severity === "BLOCKER" ? "必须修复" : "建议补充"}</span>
                      <div><strong>{issue.title}</strong><code>{issue.attributeId}</code><p>{issue.message}</p><small>{issue.suggestion}</small></div>
                    </article>
                  ))}
                </div>
              ) : <p className="product-attribute-clean">可观察规则全部通过，可以进入 Wayfair validateOnly 终验。</p>}
            </article>
          ))}
          {assessment.limitations.map((limitation) => <p className="product-addition-hint" key={limitation.code}>{limitation.message}</p>)}
          <footer className="product-attribute-evidence">
            <span>规则指纹 <code>{assessment.ruleFingerprint}</code></span>
            <span>载荷指纹 <code>{assessment.payloadFingerprint}</code></span>
          </footer>
        </section>
      ) : null}

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
