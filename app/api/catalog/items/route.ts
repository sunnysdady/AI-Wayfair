import { getRuntimeBindings } from "@/lib/runtime-bindings.mjs";

const TOKEN_URL = "https://sso.auth.wayfair.com/oauth/token";
const CATALOG_ENDPOINT = "https://api.wayfair.io/product-catalog-api/graphql";
const AUDIENCE = "https://api.wayfair.com/";
const ALLOWED_STATUSES = new Set(["LIVE", "NOT_LIVE", "LAUNCHING"]);
const CATALOG_CACHE_MS = 60 * 60 * 1000;

type Insight = {
  insightId?: string;
  title?: string;
  explanation?: string;
  insightTypeId?: string;
  expirationDate?: string;
  monthsInViolation?: number;
  resolution?: { resolutionId?: string; url?: string; description?: string };
};

type CatalogItem = {
  supplierPartNumber?: string;
  marketContext?: { locale?: string; country?: string; brand?: string; channel?: string; segment?: string; location?: string };
  catalogItemStatus?: string;
  class?: { classId?: string; className?: string };
  insights?: { problems?: Insight[]; warnings?: Insight[]; opportunities?: Insight[] };
  listings?: { listingId?: string }[];
};

const QUERY = `query SupplierCatalogItems($input: SupplierCatalogItemsInput!) {
  supplierCatalogItems(input: $input) {
    ... on SupplierCatalogItems {
      paginationInfo { page pageSize hasNextPage totalPages totalCount }
      supplier { supplierId supplierName }
      catalogItems {
        supplierPartNumber
        marketContext { locale country brand channel segment location }
        catalogItemStatus
        class { classId className }
        insights {
          problems { ...InsightFields }
          warnings { ...InsightFields }
          opportunities { ...InsightFields }
        }
        listings { listingId }
      }
    }
    ... on SupplierCatalogItemsError {
      httpError { code message }
      internalError { code message }
    }
  }
}
fragment InsightFields on Insight {
  insightId title explanation insightTypeId expirationDate monthsInViolation
  resolution { resolutionId url description }
}`;

const bindings = getRuntimeBindings;

function positiveInteger(value: string | null, fallback: number, maximum: number) {
  const parsed = Number(value || fallback);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) throw new Error(`分页参数需在 1–${maximum} 之间`);
  return parsed;
}

async function accessToken() {
  const env = await bindings();
  if (!env.WAYFAIR_CATALOG_CLIENT_ID || !env.WAYFAIR_CATALOG_CLIENT_SECRET) throw new Error("Catalog API 凭证未配置");
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: env.WAYFAIR_CATALOG_CLIENT_ID,
      client_secret: env.WAYFAIR_CATALOG_CLIENT_SECRET,
      audience: AUDIENCE,
    }),
  });
  if (!response.ok) throw new Error(`Catalog OAuth 失败（HTTP ${response.status}）`);
  const body = await response.json() as { access_token?: string };
  if (!body.access_token) throw new Error("Catalog OAuth 缺少 access_token");
  return body.access_token;
}

async function salesBySku(partNumbers: string[]) {
  const env = await bindings();
  if (!env.DB || !partNumbers.length) return new Map<string, { units: number; revenue: number }>();
  const placeholders = partNumbers.map(() => "?").join(",");
  const fromDate = new Date(Date.now() - 30 * 86400000).toISOString();
  const result = await env.DB.prepare(`SELECT i.part_number AS partNumber, SUM(i.quantity) AS units,
    SUM(i.unit_price_cents*i.quantity)/100.0 AS revenue
    FROM order_items i JOIN orders o ON o.po_number=i.po_number
    WHERE datetime(o.po_date) >= datetime(?) AND i.part_number IN (${placeholders})
    GROUP BY i.part_number`).bind(fromDate, ...partNumbers).all<{ partNumber: string; units: number; revenue: number }>();
  return new Map(result.results.map((row) => [row.partNumber, { units: Number(row.units || 0), revenue: Number(row.revenue || 0) }]));
}

export async function GET(request: Request) {
  try {
    const env = await bindings();
    const url = new URL(request.url);
    const page = positiveInteger(url.searchParams.get("page"), 1, 1_000_000);
    const pageSize = positiveInteger(url.searchParams.get("pageSize"), 20, 30);
    const q = (url.searchParams.get("q") || "").trim().toUpperCase();
    const status = (url.searchParams.get("status") || "").trim().toUpperCase();
    if (q.length > 100 || !/^[A-Z0-9_.-]*$/.test(q)) return Response.json({ error: "Supplier Part # 格式不正确" }, { status: 400 });
    if (status && !ALLOWED_STATUSES.has(status)) return Response.json({ error: "商品状态无效" }, { status: 400 });
    if (!/^\d+$/.test(String(env.WAYFAIR_CATALOG_SUPPLIER_ID || ""))) throw new Error("Catalog Supplier ID 未配置");
    const filter = {
      ...(q ? { supplierPartNumbers: [q] } : {}),
      ...(status ? { catalogItemStatuses: [status] } : {}),
    };
    const refresh=url.searchParams.get("refresh")==="1";
    const cacheKey=`catalog:v2:${page}:${pageSize}:${q}:${status}`;
    let result: { paginationInfo?: unknown; supplier?: unknown; catalogItems?: CatalogItem[]; httpError?: { message?: string }; internalError?: { message?: string } } | undefined;
    let cacheLayer="CATALOG_API";
    if(env.DB&&!refresh){
      const cached=await env.DB.prepare("SELECT value,updated_at FROM sync_state WHERE key=?").bind(cacheKey).first<{value:string;updated_at:string}>();
      if(cached&&Date.now()-Date.parse(cached.updated_at)<CATALOG_CACHE_MS){result=JSON.parse(cached.value);cacheLayer="D1_DATABASE";}
    }
    if(!result){
      const token = await accessToken();
      const response = await fetch(CATALOG_ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "X-SELECTED-SUPPLIER-ID": String(env.WAYFAIR_CATALOG_SUPPLIER_ID),
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({query: QUERY,variables: { input: { paginationOptions: { page, pageSize }, ...(Object.keys(filter).length ? { filter } : {}) } }}),
      });
      if (!response.ok) throw new Error(`Catalog API 请求失败（HTTP ${response.status}）`);
      const body = await response.json() as {data?: { supplierCatalogItems?: typeof result };errors?: { message?: string }[]};
      if (body.errors?.length) throw new Error(body.errors.map((item) => item.message || "Catalog GraphQL 错误").join("；"));
      result = body.data?.supplierCatalogItems;
      if(env.DB&&result){const now=new Date().toISOString();await env.DB.prepare("INSERT INTO sync_state(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(cacheKey,JSON.stringify(result),now).run();}
    }
    if (!result) throw new Error("Catalog API 响应缺少商品数据");
    if (result.httpError || result.internalError) throw new Error(result.httpError?.message || result.internalError?.message || "Catalog API 返回错误");
    const catalogItems = result.catalogItems || [];
    const sales = await salesBySku(catalogItems.map((item) => item.supplierPartNumber || "").filter(Boolean));
    const items = catalogItems.map((item) => ({
      ...item,
      recent30d: sales.get(item.supplierPartNumber || "") || { units: 0, revenue: 0 },
    }));
    return Response.json({ source: "Wayfair Catalog Read V2 + D1", cache: {layer:cacheLayer}, paginationInfo: result.paginationInfo, supplier: result.supplier, items }, {
      headers: { "Cache-Control": "private, max-age=300" },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "商品数据读取失败" }, { status: 500 });
  }
}
