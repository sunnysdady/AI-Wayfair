function validTimestamp(value) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function utcDatePart(value) {
  const timestamp = value instanceof Date
    ? value.getTime()
    : validTimestamp(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error("订单最大时间无效");
  }
  return new Date(timestamp).toISOString().slice(0, 10);
}

function orderKey(order, index) {
  const poNumber = String(order?.poNumber || "").trim();
  return poNumber || `missing-po:${order?.poDate || "unknown"}:${index}`;
}

/**
 * The Dropship PO query has no response cursor. Ascending reads can safely
 * advance from the newest timestamp on each full page; boundary rows are
 * intentionally re-read and de-duplicated by PO number.
 */
export async function fetchAllDropshipOrders({
  fromDate,
  fetchPage,
  pageSize = 2000,
  maxPages = 1000,
}) {
  if (typeof fetchPage !== "function") throw new Error("订单分页缺少 fetchPage");
  if (validTimestamp(fromDate) === null) throw new Error("订单分页 fromDate 无效");
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error("订单分页 pageSize 无效");
  if (!Number.isInteger(maxPages) || maxPages < 1) throw new Error("订单分页 maxPages 无效");

  let cursor = fromDate;
  const ordersByKey = new Map();

  for (let page = 1; page <= maxPages; page += 1) {
    const rows = await fetchPage({
      fromDate: cursor,
      limit: pageSize,
      sortOrder: "ASC",
    });
    if (!Array.isArray(rows)) throw new Error("订单 API 分页响应不是数组");

    rows.forEach((order, index) => {
      ordersByKey.set(orderKey(order, index), order);
    });

    const newest = rows.reduce(
      (latest, order) => {
        const timestamp = validTimestamp(order?.poDate);
        return timestamp !== null && timestamp > latest.timestamp
          ? { timestamp, value: order.poDate }
          : latest;
      },
      { timestamp: validTimestamp(cursor), value: cursor },
    );

    if (rows.length < pageSize) {
      return {
        orders: [...ordersByKey.values()],
        pages: page,
        complete: true,
        highWatermark: newest.value,
      };
    }

    const cursorTimestamp = validTimestamp(cursor);
    if (
      newest.timestamp === null
      || cursorTimestamp === null
      || newest.timestamp <= cursorTimestamp
    ) {
      throw new Error("订单分页游标无法推进，拒绝返回可能截断的数据");
    }
    cursor = newest.value;

    if (page === maxPages) {
      throw new Error(`订单分页达到最大页数 ${maxPages}，拒绝返回可能截断的数据`);
    }
  }

  throw new Error("订单分页异常结束，拒绝返回可能截断的数据");
}
