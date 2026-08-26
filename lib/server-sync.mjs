const INTERNAL_ORIGIN = "https://worker.internal";
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CATALOG_PAGE_BUDGET = 10;

function lingxingClock(scheduledTime) {
  const instant = new Date(scheduledTime);
  if (Number.isNaN(instant.getTime())) throw new Error("定时任务时间无效");
  return {
    date: lingxingDate(instant),
    hour: lingxingHour(instant),
  };
}
function addDays(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

async function checkedJson(request, label, url) {
  const response = await request(url);
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(`${label}响应不是有效 JSON（HTTP ${response.status}）`);
  }
  if (!response.ok) {
    throw new Error(`${label}失败（HTTP ${response.status}）：${body?.error || "未知错误"}`);
  }
  if (body?.error) throw new Error(`${label}失败：${body.error}`);
  if (body?.sync?.stale) {
    throw new Error(`${label}未刷新：${body.sync.error || "服务器返回旧快照"}`);
  }
  return body;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function catalogPageUrl(page) {
  const url = new URL("/api/catalog/items", INTERNAL_ORIGIN);
  url.search = new URLSearchParams({
    page: String(page),
    pageSize: "30",
    refresh: "1",
  }).toString();
  return url;
}

function catalogItemKeys(body) {
  return (Array.isArray(body?.items) ? body.items : [])
    .map((item) => String(item?.supplierPartNumber || "").trim())
    .filter(Boolean);
}

function normalizeCatalogCheckpoint(value) {
  if (
    !value
    || typeof value !== "object"
    || !["running", "failed"].includes(value.status)
    || value.resumable === false
  ) return null;
  const nextPage = positiveInteger(value.nextPage, 0);
  const totalPages = positiveInteger(value.totalPages, 0);
  if (!nextPage || !totalPages || nextPage > totalPages + 1) return null;
  return {
    ...value,
    status: "running",
    resumable: true,
    error: null,
    nextPage,
    totalPages,
    expectedTotalCount: Number.isInteger(value.expectedTotalCount) && value.expectedTotalCount >= 0
      ? value.expectedTotalCount
      : null,
    fetchedCount: Number.isInteger(value.fetchedCount) && value.fetchedCount >= 0
      ? value.fetchedCount
      : 0,
    seenPartNumbers: Array.isArray(value.seenPartNumbers)
      ? [...new Set(value.seenPartNumbers.map(String).filter(Boolean))]
      : [],
  };
}

function finishCatalogCheckpoint(checkpoint) {
  const uniqueCount = checkpoint.seenPartNumbers.length;
  const expected = checkpoint.expectedTotalCount;
  const countClosed = expected === null
    ? checkpoint.fetchedCount === uniqueCount
    : expected === checkpoint.fetchedCount && expected === uniqueCount;
  return {
    ...checkpoint,
    status: countClosed ? "complete" : "integrity-error",
    nextPage: checkpoint.totalPages + 1,
    uniqueCount,
    completedAt: new Date().toISOString(),
    integrity: {
      closed: countClosed,
      expectedTotalCount: expected,
      fetchedCount: checkpoint.fetchedCount,
      uniqueCount,
    },
  };
}

async function pause(delayMs) {
  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

async function syncCatalog({
  mode,
  request,
  completed,
  catalogPageBudget,
  catalogPageDelayMs,
  loadCatalogCheckpoint,
  saveCatalogCheckpoint,
}) {
  const persisted = normalizeCatalogCheckpoint(
    loadCatalogCheckpoint ? await loadCatalogCheckpoint() : null,
  );
  if (mode === "regular" && !persisted) return null;

  const budget = positiveInteger(catalogPageBudget, DEFAULT_CATALOG_PAGE_BUDGET);
  const delayMs = Math.max(0, Number(catalogPageDelayMs) || 0);
  let checkpoint = persisted;
  let pagesThisRun = 0;

  if (!checkpoint) {
    let firstPage;
    try {
      firstPage = await checkedJson(
        request,
        "Catalog 第1页同步",
        catalogPageUrl(1),
      );
    } catch (error) {
      if (saveCatalogCheckpoint) {
        await saveCatalogCheckpoint({
          status: "failed",
          resumable: false,
          nextPage: 1,
          totalPages: null,
          updatedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : "Catalog 第1页同步失败",
        });
      }
      throw error;
    }
    completed.push("catalog:1");
    pagesThisRun += 1;
    const reportedPages = Number(
      firstPage?.paginationInfo?.totalPages ?? firstPage?.totalPages ?? 1,
    );
    const totalPages = positiveInteger(reportedPages, 1);
    const reportedTotalCount = Number(
      firstPage?.paginationInfo?.totalCount ?? firstPage?.totalCount,
    );
    const itemKeys = catalogItemKeys(firstPage);
    checkpoint = {
      status: "running",
      resumable: true,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      nextPage: 2,
      totalPages,
      expectedTotalCount: Number.isInteger(reportedTotalCount) && reportedTotalCount >= 0
        ? reportedTotalCount
        : null,
      fetchedCount: Array.isArray(firstPage?.items) ? firstPage.items.length : 0,
      uniqueCount: new Set(itemKeys).size,
      seenPartNumbers: [...new Set(itemKeys)],
    };
    if (saveCatalogCheckpoint) await saveCatalogCheckpoint(checkpoint);
  }

  while (checkpoint.nextPage <= checkpoint.totalPages && pagesThisRun < budget) {
    await pause(delayMs);
    const page = checkpoint.nextPage;
    let body;
    try {
      body = await checkedJson(
        request,
        `Catalog 第${page}页同步`,
        catalogPageUrl(page),
      );
    } catch (error) {
      checkpoint = {
        ...checkpoint,
        status: "failed",
        resumable: true,
        updatedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : `Catalog 第${page}页同步失败`,
      };
      if (saveCatalogCheckpoint) await saveCatalogCheckpoint(checkpoint);
      throw error;
    }
    completed.push(`catalog:${page}`);
    pagesThisRun += 1;
    const itemKeys = catalogItemKeys(body);
    checkpoint = {
      ...checkpoint,
      status: "running",
      error: null,
      updatedAt: new Date().toISOString(),
      nextPage: page + 1,
      fetchedCount: checkpoint.fetchedCount
        + (Array.isArray(body?.items) ? body.items.length : 0),
      seenPartNumbers: [...new Set([...checkpoint.seenPartNumbers, ...itemKeys])],
    };
    checkpoint.uniqueCount = checkpoint.seenPartNumbers.length;
    if (saveCatalogCheckpoint) await saveCatalogCheckpoint(checkpoint);
  }

  if (checkpoint.nextPage > checkpoint.totalPages) {
    checkpoint = finishCatalogCheckpoint(checkpoint);
    if (saveCatalogCheckpoint) await saveCatalogCheckpoint(checkpoint);
  }
  return checkpoint;
}

/**
 * Refresh persisted Wayfair snapshots from the server-side scheduler.
 * Requests stay inside the deployed application; no browser token is involved.
 */
export async function runLayeredSync({
  scheduledTime,
  mode: requestedMode,
  request,
  record,
  syncOutlook,
  catalogPageBudget = DEFAULT_CATALOG_PAGE_BUDGET,
  catalogPageDelayMs = 0,
  loadCatalogCheckpoint,
  saveCatalogCheckpoint,
}) {
  const startedAt = new Date().toISOString();
  const { date: today, hour } = lingxingClock(scheduledTime);
  const mode = requestedMode === "manual-full"
    ? "manual-full"
    : hour === 6 ? "daily-full" : "regular";
  const completed = [];
  let catalog = null;

  try {
    const monthStart = `${today.slice(0, 7)}-01`;
    const orderUrl = new URL("/api/orders/summary", INTERNAL_ORIGIN);
    orderUrl.search = new URLSearchParams({ start: monthStart, end: today, refresh: "1" }).toString();
    await checkedJson(request, "订单同步", orderUrl);
    completed.push("orders");

    if (mode !== "regular") {
      const matureEnd = addDays(today, -14);
      const matureStart = addDays(matureEnd, -6);
      const adUrl = new URL("/api/ads/analysis", INTERNAL_ORIGIN);
      adUrl.search = new URLSearchParams({ start: matureStart, end: matureEnd, refresh: "1" }).toString();
      await checkedJson(request, "广告同步", adUrl);
      completed.push("ads");
    }

    catalog = await syncCatalog({
      mode,
      request,
      completed,
      catalogPageBudget,
      catalogPageDelayMs,
      loadCatalogCheckpoint,
      saveCatalogCheckpoint,
    });

    if (syncOutlook) {
      await syncOutlook();
      completed.push("outlook");
    }

    const result = {
      ok: true,
      status: "succeeded",
      mode,
      scheduledFor: new Date(scheduledTime).toISOString(),
      startedAt,
      completedAt: new Date().toISOString(),
      completed,
      catalog,
    };
    await record(result);
    return result;
  } catch (error) {
    const failure = {
      ok: false,
      status: "failed",
      mode,
      scheduledFor: new Date(scheduledTime).toISOString(),
      startedAt,
      completedAt: new Date().toISOString(),
      completed,
      catalog,
      error: error instanceof Error ? error.message : "服务器同步失败",
    };
    try {
      await record(failure);
    } catch {
      // Preserve the original sync error if recording the failure also fails.
    }
    throw error;
  }
}
import { lingxingDate, lingxingHour } from "./lingxing-business-time.mjs";
