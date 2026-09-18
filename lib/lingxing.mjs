import { createCipheriv, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export const LINGXING_API_BASE = "https://openapi.lingxing.com";
const TOKEN_PATH = "/api/auth-server/oauth/access-token";
const WAREHOUSE_PATH = "/erp/sc/data/local_inventory/warehouse";
const INVENTORY_PATH = "/erp/sc/routing/data/local_inventory/inventoryDetails";
const PAGE_SIZE = 200;
const SUCCESS_CODES = new Set([0, 1, 200, "0", "1", "200"]);
// 领星 OpenAPI 默认约 1 次/秒；供应链看板也在同一 App/IP 拉库存。
const REQUEST_GAP_MS = 1050;
const RATE_LIMIT_RETRIES = 3;
let lastSignedRequestAt = 0;

function isRateLimited(response, payload, error) {
  const status = response?.status;
  const code = payload?.code ?? payload?.error_code ?? payload?.error?.code;
  const message = String(
    payload?.message || payload?.msg || payload?.error?.message || error?.message || "",
  );
  return status === 429
    || code === 429
    || code === "429"
    || code === 20002
    || code === "20002"
    || /限流|过于频繁|too many|rate limit|frequency/i.test(message);
}

async function wait(ms) {
  if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
}

async function respectLingxingQps(fetchImpl) {
  if (fetchImpl !== fetch) return;
  const waitMs = REQUEST_GAP_MS - (Date.now() - lastSignedRequestAt);
  await wait(waitMs);
  lastSignedRequestAt = Date.now();
}

function clean(value) {
  return String(value ?? "").trim();
}

function asInteger(value) {
  const parsed = typeof value === "number" ? value : Number(clean(value));
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function pick(record, keys) {
  for (const key of keys) {
    if (record && record[key] != null && record[key] !== "") return record[key];
  }
  return undefined;
}

export function stringifySignValue(value) {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value) || (value && typeof value === "object")) {
    return JSON.stringify(value);
  }
  return String(value);
}

export function buildSignPayload(params) {
  return Object.keys(params)
    .sort()
    .flatMap((key) => {
      const value = params[key];
      if (value === undefined || value === "") return [];
      return [`${key}=${stringifySignValue(value)}`];
    })
    .join("&");
}

export function generateLingxingSign(params, appId) {
  const md5 = createHash("md5").update(buildSignPayload(params), "utf8").digest("hex").toUpperCase();
  const key = Buffer.from(String(appId), "utf8").subarray(0, 16);
  if (key.length < 16) {
    throw new Error("领星 AppId 长度不足以生成 AES-128 签名");
  }
  const cipher = createCipheriv("aes-128-ecb", key, null);
  cipher.setAutoPadding(true);
  return Buffer.concat([cipher.update(md5, "utf8"), cipher.final()]).toString("base64");
}

export function lingxingCredentials(env = {}) {
  const appId = clean(env.LINGXING_APP_ID);
  const appSecret = clean(env.LINGXING_APP_SECRET);
  const baseUrl = clean(env.LINGXING_API_BASE) || LINGXING_API_BASE;
  return {
    appId,
    appSecret,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    configured: Boolean(appId && appSecret),
  };
}

async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`领星接口响应不是 JSON（HTTP ${response.status}）`);
  }
}

function assertSuccess(payload, label) {
  const code = payload?.code;
  if (code === undefined || SUCCESS_CODES.has(code)) return payload;
  const message = payload?.message || payload?.msg || "未知错误";
  throw new Error(`${label}失败：${message}（code ${code}）`);
}

export async function fetchLingxingAccessToken(env, fetchImpl = fetch) {
  const { appId, appSecret, baseUrl, configured } = lingxingCredentials(env);
  if (!configured) throw new Error("领星 API 未配置：请设置 LINGXING_APP_ID 与 LINGXING_APP_SECRET");
  const url = new URL(TOKEN_PATH, `${baseUrl}/`);
  url.searchParams.set("appId", appId);
  url.searchParams.set("appSecret", appSecret);
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { accept: "application/json" },
  });
  const payload = assertSuccess(await readJson(response), "领星授权");
  if (!response.ok) throw new Error(`领星授权失败（HTTP ${response.status}）`);
  const data = payload.data || payload;
  const accessToken = clean(data.access_token);
  if (!accessToken) throw new Error("领星授权响应缺少 access_token");
  return {
    accessToken,
    refreshToken: clean(data.refresh_token),
    expiresIn: asInteger(data.expires_in) || 3600,
  };
}

async function signedRequest(env, path, body, token, fetchImpl = fetch) {
  const { appId, baseUrl } = lingxingCredentials(env);
  let lastError = new Error(`领星接口失败：${path}`);
  for (let attempt = 1; attempt <= RATE_LIMIT_RETRIES; attempt += 1) {
    await respectLingxingQps(fetchImpl);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const publicParams = {
      access_token: token.accessToken,
      app_key: appId,
      timestamp,
    };
    const sign = generateLingxingSign({ ...body, ...publicParams }, appId);
    const url = new URL(path, `${baseUrl}/`);
    url.searchParams.set("access_token", token.accessToken);
    url.searchParams.set("app_key", appId);
    url.searchParams.set("timestamp", timestamp);
    url.searchParams.set("sign", sign);
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await readJson(response);
    if (isRateLimited(response, payload)) {
      lastError = new Error(`领星限流（HTTP ${response.status}）：${payload?.message || payload?.msg || path}`);
      await wait(2000 * attempt);
      continue;
    }
    if (!response.ok) {
      throw new Error(`领星接口失败（HTTP ${response.status}）：${payload?.message || payload?.msg || path}`);
    }
    return assertSuccess(payload, path);
  }
  throw lastError;
}

function extractList(payload) {
  const data = payload?.data ?? payload;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.list)) return data.list;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.records)) return data.records;
  return [];
}

function extractTotal(payload, fallback) {
  const data = payload?.data ?? payload;
  const total = Number(data?.total ?? payload?.total ?? fallback);
  return Number.isFinite(total) ? total : fallback;
}

export function warehouseDisplayNames(row) {
  return [...new Set([
    clean(pick(row, ["name", "warehouse_name", "wh_name", "ware_house_name"])),
    clean(pick(row, ["t_warehouse_name", "third_warehouse_name"])),
    [clean(pick(row, ["wp_name", "provider_name"])), clean(pick(row, ["t_warehouse_code", "t_warehouse_name"]))].filter(Boolean).join(" "),
  ].filter(Boolean))];
}

export function mapLingxingInventoryRows(inventoryRows, warehouses = []) {
  const warehouseById = new Map();
  for (const warehouse of warehouses) {
    const id = clean(pick(warehouse, ["wid", "warehouse_id", "id"]));
    if (id) warehouseById.set(id, warehouse);
  }
  const stockRows = [];
  inventoryRows.forEach((row, index) => {
    const wid = clean(pick(row, ["wid", "warehouse_id"]));
    const warehouse = warehouseById.get(wid) || {};
    const names = warehouseDisplayNames({ ...warehouse, ...row });
    const lingxingSku = clean(pick(row, ["sku", "lsku", "local_sku"]));
    if (!lingxingSku || !names.length) return;
    const productName = clean(pick(row, ["product_name", "sku_name", "title", "pname"]));
    names.forEach((warehouseName) => {
      stockRows.push({
        rowNumber: index + 2,
        lingxingSku,
        warehouse: warehouseName,
        productName,
        available: asInteger(pick(row, ["product_valid_num", "available", "fulfillable_qty", "valid_num"])),
        locked: asInteger(pick(row, ["good_lock_num", "product_lock_num", "lock_num"])),
        incoming: asInteger(pick(row, ["quantity_receive", "pending_arrival_qty", "onorder"])),
        transferInTransit: asInteger(pick(row, ["product_onway", "transit_qty", "onway"])),
      });
    });
  });
  return stockRows;
}

const SHARED_SNAPSHOT = process.env.LINGXING_SHARED_SNAPSHOT || "/var/lib/lingxing/inventory-raw.json";
const SHARED_MAX_AGE_MS = Number(process.env.LINGXING_SHARED_MAX_AGE_MS || 20 * 60 * 1000);

export async function loadSharedLingxingSnapshot(maxAgeMs = SHARED_MAX_AGE_MS) {
  try {
    const doc = JSON.parse(await readFile(SHARED_SNAPSHOT, "utf8"));
    const pulled = Date.parse(doc?.pulledAt);
    if (!Number.isFinite(pulled) || Date.now() - pulled > maxAgeMs) return null;
    if (!Array.isArray(doc.inventoryRows) || !Array.isArray(doc.warehouses)) return null;
    return doc;
  } catch {
    return null;
  }
}

export async function pullLingxingStockRows(env, fetchImpl = fetch) {
  if (fetchImpl === fetch) {
    const shared = await loadSharedLingxingSnapshot();
    if (shared) {
      return {
        warehouses: shared.warehouses,
        inventoryRows: shared.inventoryRows,
        stockRows: mapLingxingInventoryRows(shared.inventoryRows, shared.warehouses),
        sourceFile: `lingxing-shared:${shared.pulledAt || ""}`,
        source: "lingxing-shared",
      };
    }
  }
  const token = await fetchLingxingAccessToken(env, fetchImpl);
  const warehouses = [];
  const seen = new Set();
  for (const type of [3, 1]) {
    const warehousePayload = await signedRequest(
      env,
      WAREHOUSE_PATH,
      { type, offset: 0, length: 1000, is_delete: 0 },
      token,
      fetchImpl,
    );
    for (const row of extractList(warehousePayload)) {
      const id = clean(pick(row, ["wid", "warehouse_id", "id"]));
      if (!id || seen.has(id)) continue;
      seen.add(id);
      warehouses.push(row);
    }
  }
  const inventoryRows = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  while (offset < total) {
    const page = await signedRequest(env, INVENTORY_PATH, { offset, length: PAGE_SIZE }, token, fetchImpl);
    const rows = extractList(page);
    inventoryRows.push(...rows);
    total = extractTotal(page, offset + rows.length);
    if (!rows.length) break;
    offset += rows.length;
    if (rows.length < PAGE_SIZE) break;
  }
  return {
    warehouses,
    inventoryRows,
    stockRows: mapLingxingInventoryRows(inventoryRows, warehouses),
    sourceFile: `lingxing-api:${new Date().toISOString().slice(0, 19)}Z`,
    source: "lingxing-api",
  };
}
