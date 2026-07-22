const INTERNAL_ORIGIN = "https://worker.internal";
const DAY_MS = 24 * 60 * 60 * 1000;

function shanghaiClock(scheduledTime) {
  const shifted = new Date(scheduledTime + 8 * 60 * 60 * 1000);
  if (Number.isNaN(shifted.getTime())) throw new Error("定时任务时间无效");
  return {
    date: shifted.toISOString().slice(0, 10),
    hour: shifted.getUTCHours(),
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

/**
 * Refresh the persisted Wayfair snapshots from a Cloudflare Cron Trigger.
 * All requests stay inside the deployed Worker, so no browser or SIWC token is
 * involved and no Codex task is created.
 */
export async function runLayeredSync({ scheduledTime, request, record }) {
  const startedAt = new Date().toISOString();
  const { date: today, hour } = shanghaiClock(scheduledTime);
  const mode = hour === 6 ? "daily-full" : "regular";
  const completed = [];

  try {
    const monthStart = `${today.slice(0, 7)}-01`;
    const orderUrl = new URL("/api/orders/summary", INTERNAL_ORIGIN);
    orderUrl.search = new URLSearchParams({ start: monthStart, end: today, refresh: "1" }).toString();
    await checkedJson(request, "订单同步", orderUrl);
    completed.push("orders");

    if (mode === "daily-full") {
      const matureEnd = addDays(today, -14);
      const matureStart = addDays(matureEnd, -6);
      const adUrl = new URL("/api/ads/analysis", INTERNAL_ORIGIN);
      adUrl.search = new URLSearchParams({ start: matureStart, end: matureEnd, refresh: "1" }).toString();
      await checkedJson(request, "广告同步", adUrl);
      completed.push("ads");

      const catalogUrl = (page) => {
        const url = new URL("/api/catalog/items", INTERNAL_ORIGIN);
        url.search = new URLSearchParams({ page: String(page), pageSize: "30", refresh: "1" }).toString();
        return url;
      };
      const firstPage = await checkedJson(request, "Catalog 第1页同步", catalogUrl(1));
      completed.push("catalog:1");
      const reportedPages = Number(firstPage?.paginationInfo?.totalPages ?? firstPage?.totalPages ?? 1);
      const totalPages = Number.isInteger(reportedPages) && reportedPages > 0
        ? Math.min(reportedPages, 10)
        : 1;
      for (let page = 2; page <= totalPages; page += 1) {
        await checkedJson(request, `Catalog 第${page}页同步`, catalogUrl(page));
        completed.push(`catalog:${page}`);
      }
    }

    const result = {
      ok: true,
      status: "succeeded",
      mode,
      scheduledFor: new Date(scheduledTime).toISOString(),
      startedAt,
      completedAt: new Date().toISOString(),
      completed,
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
      error: error instanceof Error ? error.message : "服务器同步失败",
    };
    try {
      await record(failure);
    } catch {
      // Preserve the original sync error; Cloudflare still records the failed invocation.
    }
    throw error;
  }
}

