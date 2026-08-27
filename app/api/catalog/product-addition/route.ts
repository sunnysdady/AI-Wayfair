import { sameOrigin } from "@/lib/http-origin.mjs";
import { upsertOperation } from "@/lib/operation-ledger.mjs";
import {
  createProductAdditionRun,
  getProductAdditionRun,
  listProductAdditionRuns,
  updateProductAdditionRun,
} from "@/lib/product-addition-runs.mjs";
import { getRuntimeBindings } from "@/lib/runtime-bindings.mjs";
import { assessWayfairAttributeHealth } from "@/lib/wayfair-attribute-health.mjs";
import {
  assertProductAdditionLiveGate,
  discoverProductAddition,
  getProductAdditionStatus,
  payloadHash,
  productAdditionReadiness,
  submitProductAdditions,
  summarizeProductAdditionStatus,
} from "@/lib/wayfair-product-addition-v2.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RuntimeEnv = Awaited<ReturnType<typeof getRuntimeBindings>>;
type Run = Awaited<ReturnType<typeof getProductAdditionRun>>;

function publicRun(run: Run) {
  if (!run) return null;
  return {
    id: run.id,
    operationId: run.operationId,
    linkedPreflightOperationId: run.linkedPreflightOperationId,
    mode: run.mode,
    payloadHash: run.payloadHash,
    status: run.status,
    requestId: run.requestId,
    batchId: run.batchId,
    lastError: run.lastError,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

function requireRun(run: Run): NonNullable<Run> {
  if (!run) throw new Error("Product Addition 运行记录写入失败");
  return run;
}

function operationInput(run: NonNullable<Run>, status: string, details: Record<string, unknown> = {}) {
  const productIds = (run.payload?.proposedProductAdditions || []).map((item: { productId?: string }) => item.productId);
  const executionResult = String(details.executionResult || "");
  const evidence = Array.isArray(details.evidence) ? details.evidence : [];
  return {
    operationId: run.operationId,
    sourceType: "WAYFAIR_PRODUCT_ADDITION_V2",
    sourceId: run.id,
    objectType: "PRODUCT_ADDITION_BATCH",
    objectId: run.payloadHash,
    title: run.mode === "PREFLIGHT" ? "新品 API V2 预检" : "新品 API V2 正式提交",
    owner: "Wayfair API 操作员",
    status,
    proposedAction: run.mode === "PREFLIGHT" ? "仅校验商品新增载荷，不创建商品" : "正式提交经预检锁定的商品新增载荷",
    beforeState: { productIds, payloadHash: run.payloadHash, mode: run.mode },
    intendedAfterState: { expected: run.mode === "PREFLIGHT" ? "VALIDATED" : "COMPLETED" },
    executionResult,
    terminalReceipt: String(details.terminalReceipt || ""),
    evidence,
    acceptanceCriteria: executionResult ? "Wayfair 返回成功终态，requestId、batchId 与载荷哈希可关联" : "",
    acceptedBy: String(details.acceptedBy || ""),
    reviewVerdict: String(details.reviewVerdict || ""),
    rollbackLink: `/api/catalog/product-addition/?runId=${encodeURIComponent(run.id)}`,
  };
}

function assessmentOperationInput(
  assessment: ReturnType<typeof assessWayfairAttributeHealth>,
  operationId: string,
  status: string,
) {
  const result = `属性体检完成：${assessment.aggregate.products} 个商品，平均 ${assessment.aggregate.averageScore} 分，${assessment.aggregate.blockedProducts} 个被硬性闸门阻断`;
  const closed = ["PENDING_ACCEPTANCE", "VERIFIED", "CLOSED"].includes(status);
  return {
    operationId,
    sourceType: "WAYFAIR_PRODUCT_ADDITION_V2",
    sourceId: assessment.assessmentId,
    objectType: "PRODUCT_ATTRIBUTE_ASSESSMENT",
    objectId: assessment.payloadFingerprint,
    title: "Product Addition 属性合规体检",
    owner: "Wayfair API 操作员",
    status,
    proposedAction: `读取 Wayfair Class ${assessment.classId} 属性规则并评估草稿，不写入 Wayfair`,
    beforeState: {
      classId: assessment.classId,
      payloadFingerprint: assessment.payloadFingerprint,
      products: assessment.aggregate.products,
    },
    intendedAfterState: {
      assessmentId: assessment.assessmentId,
      ruleFingerprint: assessment.ruleFingerprint,
      hardGate: assessment.aggregate.blockedProducts ? "BLOCKED" : "PASS",
    },
    executionResult: closed ? result : "",
    terminalReceipt: closed ? assessment.assessmentId : "",
    evidence: closed ? [
      { type: "ASSESSMENT_ID", value: assessment.assessmentId },
      { type: "RULE_FINGERPRINT", value: assessment.ruleFingerprint },
      { type: "PAYLOAD_FINGERPRINT", value: assessment.payloadFingerprint },
    ] : [],
    acceptanceCriteria: closed ? "规则与载荷指纹已固化，所有问题可追溯到 attributeId，且未执行 Wayfair 写入" : "",
    acceptedBy: ["VERIFIED", "CLOSED"].includes(status) ? "system:attribute-health-engine" : "",
    reviewVerdict: status === "CLOSED" ? "ASSESSMENT_COMPLETED" : "",
    rollbackLink: `/product-addition?assessmentId=${encodeURIComponent(assessment.assessmentId)}`,
  };
}

async function closeAssessmentOperation(
  env: RuntimeEnv,
  assessment: ReturnType<typeof assessWayfairAttributeHealth>,
) {
  const operationId = `WAYFAIR-AH-${crypto.randomUUID()}`;
  for (const status of ["DISCOVERED", "ASSIGNED", "PREFLIGHTED", "EXECUTING", "PENDING_ACCEPTANCE", "VERIFIED", "CLOSED"]) {
    await upsertOperation(
      env.DB,
      assessmentOperationInput(assessment, operationId, status),
      `PRODUCT_ATTRIBUTE_ASSESSMENT_${status}`,
    );
  }
  return operationId;
}

async function moveOperation(env: RuntimeEnv, run: NonNullable<Run>, statuses: string[]) {
  for (const status of statuses) {
    await upsertOperation(env.DB, operationInput(run, status), `PRODUCT_ADDITION_${status}`);
  }
}

function noStore(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cache-control", "private, no-store");
  return Response.json(body, { ...init, headers });
}

export async function GET(request: Request) {
  try {
    const env = await getRuntimeBindings();
    const url = new URL(request.url);
    const readiness = productAdditionReadiness(env);
    const runs = await listProductAdditionRuns(env.DB, Number(url.searchParams.get("limit") || 30));
    const discovery = url.searchParams.get("discover") === "1"
      ? await discoverProductAddition(env, { classId: url.searchParams.get("classId") || "3" })
      : null;
    return noStore({ readiness, discovery, runs: runs.map(publicRun) });
  } catch (error) {
    return noStore({ error: error instanceof Error ? error.message : "Product Addition 读取失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return noStore({ error: "请求来源无效" }, { status: 403 });
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 524_288) return noStore({ error: "请求载荷不能超过 512 KB" }, { status: 413 });

  let env: RuntimeEnv | null = null;
  let activeRun: NonNullable<Run> | null = null;
  try {
    env = await getRuntimeBindings();
    const body = await request.json();
    const action = String(body?.action || "");

    if (action === "assess") {
      const products = Array.isArray(body?.payload?.proposedProductAdditions)
        ? body.payload.proposedProductAdditions
        : [];
      const classIds: string[] = [...new Set<string>(
        products.map((product: { classId?: unknown }) => String(product?.classId || "").trim()).filter(Boolean),
      )];
      if (classIds.length !== 1) throw new Error("首期属性体检一次只支持同一个 Class，且 classId 不能为空");
      const discovery = await discoverProductAddition(env, { classId: classIds[0] });
      const assessment = assessWayfairAttributeHealth({
        classId: classIds[0],
        rules: discovery.attributes,
        payload: body.payload,
      });
      const operationId = await closeAssessmentOperation(env, assessment);
      return noStore({ assessment: { ...assessment, operationId }, discovery });
    }

    if (action === "preflight") {
      const hash = payloadHash(body.payload);
      const id = crypto.randomUUID();
      activeRun = requireRun(await createProductAdditionRun(env.DB, {
        id,
        operationId: `WAYFAIR-PA-${id}`,
        mode: "PREFLIGHT",
        payloadHash: hash,
        payload: body.payload,
        status: "CREATED",
      }));
      await moveOperation(env, activeRun, ["DISCOVERED", "PENDING_APPROVAL", "PREFLIGHTED", "EXECUTING"]);
      const result = await submitProductAdditions(env, activeRun.payload, { validateOnly: true });
      activeRun = requireRun(await updateProductAdditionRun(env.DB, id, {
        status: "PROCESSING",
        requestId: result.productAdditionRequestId,
        batchId: result.batchId,
        result,
      }));
      await upsertOperation(env.DB, operationInput(activeRun, "PENDING_ACCEPTANCE", {
        executionResult: `Wayfair 已接收 validateOnly 预检，状态 ${result.status || "PROCESSING"}`,
        terminalReceipt: `${result.productAdditionRequestId}/${result.batchId}`,
        evidence: [
          { type: "PAYLOAD_HASH", value: hash },
          { type: "WAYFAIR_REQUEST_ID", value: result.productAdditionRequestId },
          { type: "WAYFAIR_BATCH_ID", value: result.batchId },
        ],
      }), "PRODUCT_ADDITION_SUBMITTED");
      return noStore({ run: publicRun(activeRun) }, { status: 202 });
    }

    if (action === "submit") {
      assertProductAdditionLiveGate(env);
      if (body.confirmation !== "SUBMIT PRODUCT ADDITION") throw new Error("正式提交确认文本不匹配");
      const preflight = await getProductAdditionRun(env.DB, String(body.preflightRunId || ""));
      if (!preflight || preflight.mode !== "PREFLIGHT" || preflight.status !== "CLOSED") {
        throw new Error("必须关联一条已闭环成功的预检记录");
      }
      const hash = payloadHash(body.payload);
      if (hash !== preflight.payloadHash) throw new Error("正式提交载荷与预检载荷不一致");
      const id = crypto.randomUUID();
      activeRun = requireRun(await createProductAdditionRun(env.DB, {
        id,
        operationId: `WAYFAIR-PA-${id}`,
        linkedPreflightOperationId: preflight.operationId,
        mode: "LIVE",
        payloadHash: hash,
        payload: body.payload,
        status: "CREATED",
      }));
      await moveOperation(env, activeRun, ["DISCOVERED", "PENDING_APPROVAL", "PREFLIGHTED", "EXECUTING"]);
      const result = await submitProductAdditions(env, activeRun.payload, { validateOnly: false });
      activeRun = requireRun(await updateProductAdditionRun(env.DB, id, {
        status: "PROCESSING",
        requestId: result.productAdditionRequestId,
        batchId: result.batchId,
        result,
      }));
      await upsertOperation(env.DB, operationInput(activeRun, "PENDING_ACCEPTANCE", {
        executionResult: `Wayfair 已接收正式提交，状态 ${result.status || "PROCESSING"}`,
        terminalReceipt: `${result.productAdditionRequestId}/${result.batchId}`,
        evidence: [
          { type: "PREFLIGHT_OPERATION", value: preflight.operationId },
          { type: "PAYLOAD_HASH", value: hash },
          { type: "WAYFAIR_REQUEST_ID", value: result.productAdditionRequestId },
          { type: "WAYFAIR_BATCH_ID", value: result.batchId },
        ],
      }), "PRODUCT_ADDITION_SUBMITTED");
      return noStore({ run: publicRun(activeRun) }, { status: 202 });
    }

    if (action === "refresh") {
      activeRun = await getProductAdditionRun(env.DB, String(body.runId || ""));
      if (!activeRun?.requestId || !activeRun.batchId) throw new Error("运行记录缺少 Wayfair requestId 或 batchId");
      const result = await getProductAdditionStatus(env, activeRun, fetch);
      const summary = summarizeProductAdditionStatus(result);
      activeRun = requireRun(await updateProductAdditionRun(env.DB, activeRun.id, {
        status: summary.terminal ? (summary.successful ? "SUCCEEDED" : "FAILED") : "PROCESSING",
        result,
        lastError: summary.terminal && !summary.successful ? summary.statuses.join(", ") : "",
      }));
      if (summary.terminal && summary.successful && activeRun.mode === "PREFLIGHT") {
        const details = {
          executionResult: `validateOnly 预检成功：${summary.statuses.join(" / ")}`,
          terminalReceipt: `${activeRun.requestId}/${activeRun.batchId}`,
          evidence: [
            { type: "PAYLOAD_HASH", value: activeRun.payloadHash },
            { type: "WAYFAIR_STATUS", value: summary.statuses.join(" / ") },
          ],
          acceptedBy: "system:wayfair-validateOnly",
          reviewVerdict: "PRECHECK_PASSED",
        };
        await upsertOperation(env.DB, operationInput(activeRun, "VERIFIED", details), "PRODUCT_ADDITION_VERIFIED");
        await upsertOperation(env.DB, operationInput(activeRun, "CLOSED", details), "PRODUCT_ADDITION_CLOSED");
        activeRun = requireRun(await updateProductAdditionRun(env.DB, activeRun.id, { status: "CLOSED" }));
      } else if (summary.terminal && !summary.successful) {
        await upsertOperation(env.DB, operationInput(activeRun, "FAILED"), "PRODUCT_ADDITION_FAILED");
      } else {
        await upsertOperation(env.DB, operationInput(activeRun, "PENDING_ACCEPTANCE", {
          executionResult: `Wayfair 正在处理：${summary.statuses.join(" / ") || "PROCESSING"}`,
          terminalReceipt: `${activeRun.requestId}/${activeRun.batchId}`,
          evidence: [{ type: "WAYFAIR_STATUS", value: summary.statuses.join(" / ") || "PROCESSING" }],
        }), "PRODUCT_ADDITION_STATUS_REFRESHED");
      }
      return noStore({ run: publicRun(activeRun), summary });
    }

    if (action === "accept") {
      if (body.confirmation !== "ACCEPT PRODUCT ADDITION") throw new Error("验收确认文本不匹配");
      activeRun = await getProductAdditionRun(env.DB, String(body.runId || ""));
      if (!activeRun || activeRun.mode !== "LIVE" || activeRun.status !== "SUCCEEDED") {
        throw new Error("只有成功终态的正式提交可以验收");
      }
      const summary = summarizeProductAdditionStatus(activeRun.result);
      const details = {
        executionResult: `正式提交成功：${summary.statuses.join(" / ")}`,
        terminalReceipt: `${activeRun.requestId}/${activeRun.batchId}`,
        evidence: [
          { type: "PAYLOAD_HASH", value: activeRun.payloadHash },
          { type: "WAYFAIR_STATUS", value: summary.statuses.join(" / ") },
        ],
        acceptedBy: "operator:product-addition",
        reviewVerdict: "LIVE_SUBMISSION_ACCEPTED",
      };
      await upsertOperation(env.DB, operationInput(activeRun, "VERIFIED", details), "PRODUCT_ADDITION_ACCEPTED");
      await upsertOperation(env.DB, operationInput(activeRun, "CLOSED", details), "PRODUCT_ADDITION_CLOSED");
      activeRun = requireRun(await updateProductAdditionRun(env.DB, activeRun.id, { status: "CLOSED" }));
      return noStore({ run: publicRun(activeRun) });
    }

    return noStore({ error: "Product Addition action 无效" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Product Addition 操作失败";
    if (env && activeRun) {
      try {
        await updateProductAdditionRun(env.DB, activeRun.id, { status: "FAILED", lastError: message });
        await upsertOperation(env.DB, operationInput(activeRun, "FAILED"), "PRODUCT_ADDITION_FAILED");
      } catch {
        // Preserve the original API failure; database failure is observable in server logs.
      }
    }
    return noStore({ error: message }, { status: 400 });
  }
}
