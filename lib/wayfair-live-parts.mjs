const TOKEN_URL = "https://sso.auth.wayfair.com/oauth/token";
const CATALOG_ENDPOINT = "https://api.wayfair.io/product-catalog-api/graphql";
const AUDIENCE = "https://api.wayfair.com/";
const PAGE_SIZE = 30;
const MAX_PAGES = 200;

const QUERY = `query LivePartNumbers($input: SupplierCatalogItemsInput!) {
  supplierCatalogItems(input: $input) {
    ... on SupplierCatalogItems {
      paginationInfo { hasNextPage totalPages }
      catalogItems { supplierPartNumber catalogItemStatus }
    }
    ... on SupplierCatalogItemsError {
      httpError { code message }
      internalError { code message }
    }
  }
}`;

/** 从 Wayfair Catalog API 取全部 LIVE 商品的 Supplier Part #（去重）。任何失败都抛错，由调用方决定回退。 */
export async function fetchLiveSupplierParts(env, fetchImpl = fetch) {
  if (!env.WAYFAIR_CATALOG_CLIENT_ID || !env.WAYFAIR_CATALOG_CLIENT_SECRET) throw new Error("Catalog API 凭证未配置");
  if (!/^\d+$/.test(String(env.WAYFAIR_CATALOG_SUPPLIER_ID || ""))) throw new Error("Catalog Supplier ID 未配置");
  const tokenResponse = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", client_id: env.WAYFAIR_CATALOG_CLIENT_ID, client_secret: env.WAYFAIR_CATALOG_CLIENT_SECRET, audience: AUDIENCE }),
  });
  if (!tokenResponse.ok) throw new Error(`Catalog OAuth 失败（HTTP ${tokenResponse.status}）`);
  const { access_token: token } = await tokenResponse.json();
  if (!token) throw new Error("Catalog OAuth 缺少 access_token");

  const parts = new Set();
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const response = await fetchImpl(CATALOG_ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "X-SELECTED-SUPPLIER-ID": String(env.WAYFAIR_CATALOG_SUPPLIER_ID), "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ query: QUERY, variables: { input: { paginationOptions: { page, pageSize: PAGE_SIZE }, filter: { catalogItemStatuses: ["LIVE"] } } } }),
    });
    if (!response.ok) throw new Error(`Catalog API 请求失败（HTTP ${response.status}）`);
    const body = await response.json();
    if (body.errors?.length) throw new Error(body.errors.map((item) => item.message || "Catalog GraphQL 错误").join("；"));
    const result = body.data?.supplierCatalogItems;
    if (!result || result.httpError || result.internalError) throw new Error(result?.httpError?.message || result?.internalError?.message || "Catalog API 响应缺少商品数据");
    for (const item of result.catalogItems || []) {
      const part = String(item?.supplierPartNumber || "").trim();
      if (part && (!item.catalogItemStatus || item.catalogItemStatus === "LIVE")) parts.add(part);
    }
    if (!result.paginationInfo?.hasNextPage) return [...parts];
  }
  throw new Error("Catalog 分页超过上限，已放弃");
}

/** 实时清单明显缩水（< 静态清单一半）时视为异常，不采用，避免误把大批商品踢出推送。 */
export function chooseActiveParts(livePartNumbers, staticPartNumbers) {
  const minimum = Math.ceil(staticPartNumbers.length / 2);
  if (!livePartNumbers || livePartNumbers.length < minimum) return { parts: staticPartNumbers, source: "static" };
  return { parts: livePartNumbers, source: "wayfair-catalog" };
}
