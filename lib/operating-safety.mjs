function configured(env, keys) {
  return keys.every((key) => Boolean(String(env?.[key] || "").trim()));
}

function supplierIds(value) {
  const tokens = String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
  const valid = tokens.filter((item) => /^\d+$/.test(item)).map(Number);
  return { tokens, valid: [...new Set(valid)], invalid: tokens.filter((item) => !/^\d+$/.test(item)) };
}

export function buildOperatingReadiness(env = {}) {
  const deployment = String(env.WAYFAIR_DEPLOYMENT_ENV || "unconfigured").trim().toLowerCase();
  const platform = String(env.RUNTIME_PLATFORM || "unknown").trim().toLowerCase();
  const expected = supplierIds(env.WAYFAIR_EXPECTED_SUPPLIER_IDS);
  const catalogSupplier = /^\d+$/.test(String(env.WAYFAIR_CATALOG_SUPPLIER_ID || ""))
    ? Number(env.WAYFAIR_CATALOG_SUPPLIER_ID)
    : null;
  const environmentVerified = deployment === "production"
    && ["node", "vercel"].includes(platform);
  const identityVerified = expected.valid.length > 0
    && expected.invalid.length === 0
    && catalogSupplier !== null
    && expected.valid.includes(catalogSupplier);
  const opsReady = configured(env, ["WAYFAIR_OPS_CLIENT_ID", "WAYFAIR_OPS_CLIENT_SECRET"]);
  const adsReady = configured(env, ["WAYFAIR_AD_CLIENT_ID", "WAYFAIR_AD_CLIENT_SECRET"]);
  const catalogReady = configured(env, ["WAYFAIR_CATALOG_CLIENT_ID", "WAYFAIR_CATALOG_CLIENT_SECRET", "WAYFAIR_CATALOG_SUPPLIER_ID"]);
  const storageReady = Boolean(env.S3_BUCKET)
    && (configured(env, ["S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"])
      || env.S3_USE_DEFAULT_CREDENTIAL_CHAIN === "true");
  const blockers = [];
  if (!environmentVerified) blockers.push("必须明确运行在 Node/Vercel production 生产环境");
  if (!identityVerified) blockers.push("必须配置且匹配 WAYFAIR_EXPECTED_SUPPLIER_IDS 与 Catalog Supplier ID");

  const live = (kind, credentialsReady, switchEnabled) => {
    const localBlockers = [...blockers];
    if (!credentialsReady) localBlockers.push(`${kind} API 凭证不完整`);
    if (!switchEnabled) localBlockers.push(`${kind} 正式写入开关未启用`);
    return { allowed: localBlockers.length === 0, blockers: localBlockers };
  };

  return {
    generatedAt: new Date().toISOString(),
    environment: { name: deployment, platform, verified: environmentVerified },
    identity: { expectedSupplierIds: expected.valid, catalogSupplierId: catalogSupplier, verified: identityVerified },
    sources: [
      { id: "orders-inventory", name: "Ops API · 库存 + 订单", status: opsReady ? "ready" : "blocked", detail: opsReady ? "OAuth 已配置" : "OAuth 凭证不完整", scope: "库存写 / 订单读" },
      { id: "advertising", name: "Advertising API", status: adsReady ? "ready" : "blocked", detail: adsReady ? "OAuth 已配置" : "OAuth 凭证不完整", scope: "Campaign / Listing 报表与受控写入" },
      { id: "catalog", name: "Catalog Read V2", status: catalogReady && identityVerified ? "ready" : "blocked", detail: identityVerified ? "Supplier 身份已核对" : "Supplier 身份未核对", scope: "商品、Listing 与诊断" },
      { id: "outlook", name: "Outlook 邮件日报", status: configured(env, ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"]) ? "ready" : "blocked", detail: configured(env, ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"]) ? "Microsoft Graph 已配置" : "Microsoft Graph 凭证不完整", scope: "风险与待办" },
      { id: "persistence", name: "运营数据库", status: configured(env, ["DATABASE_URL"]) && storageReady ? "ready" : "blocked", detail: configured(env, ["DATABASE_URL"]) && storageReady ? "PostgreSQL + S3 运行环境" : "PostgreSQL 或 S3 凭证未配置", scope: "订单、广告、库存、执行单与报告" },
    ],
    live: {
      ads: live("Advertising", adsReady, env.ALLOW_WAYFAIR_AD_LIVE_CHANGES === "true"),
      inventory: live("Inventory", opsReady, env.ALLOW_WAYFAIR_LIVE_PUSH === "true"),
    },
  };
}

export function assertLiveOperation(env, operation, actualSupplierIds = []) {
  const readiness = buildOperatingReadiness(env);
  const gate = readiness.live[operation];
  if (!gate?.allowed) throw new Error(`生产写入被安全闸门阻止：${(gate?.blockers || ["未知操作"]).join("；")}`);
  if (operation === "inventory") {
    const actual = [...new Set(actualSupplierIds.map(Number).filter(Number.isFinite))];
    if (!actual.length) throw new Error("生产写入被安全闸门阻止：库存载荷没有 Supplier ID");
    const unexpected = actual.filter((id) => !readiness.identity.expectedSupplierIds.includes(id));
    if (unexpected.length) throw new Error(`生产写入被安全闸门阻止：发现未授权 Supplier ID ${unexpected.join("、")}`);
  }
  return readiness;
}
