const HOUR_MS = 60 * 60 * 1000;

export const WAYFAIR_SCOPE_REGISTRY = Object.freeze([
  {
    id: "advertising-reports",
    family: "advertising",
    app: "Advertising",
    permission: "Manage Reports",
    policy: "active",
    evidencePrefix: "ads-analysis:",
    staleAfterMs: 36 * HOUR_MS,
  },
  {
    id: "advertising-bids",
    family: "advertising",
    app: "Advertising",
    permission: "Modify Bids",
    policy: "active",
    evidencePrefix: "ads-action:",
    staleAfterMs: 36 * HOUR_MS,
  },
  {
    id: "orders-read",
    family: "dropship-orders",
    app: "Ops",
    permission: "Purchase Order Read",
    policy: "active",
    evidenceKey: "orders",
    staleAfterMs: 6 * HOUR_MS,
  },
  {
    id: "inventory-write",
    family: "dropship-inventory",
    app: "Ops",
    permission: "Inventory Write + Inventory Verified",
    policy: "active",
    evidencePrefix: "inventory:push:",
    staleAfterMs: 36 * HOUR_MS,
  },
  {
    id: "catalog-read",
    family: "catalog-read-v2",
    app: "Catalog Read Only",
    permission: "Catalog Products Read",
    policy: "active",
    evidenceKey: "server:catalog:crawl",
    staleAfterMs: 36 * HOUR_MS,
  },
  {
    id: "shipping-excluded",
    family: "shipping",
    permission: "ASN / Registration / Ship Label / BOL / Packing Slip / Shipping Documents",
    policy: "excluded",
  },
  {
    id: "castlegate-excluded",
    family: "castlegate",
    permission: "All CastleGate APIs",
    policy: "excluded",
  },
  {
    id: "cancellation-excluded",
    family: "order-cancellation",
    permission: "Purchase Order Cancellation Read / Write",
    policy: "excluded",
  },
  {
    id: "multichannel-excluded",
    family: "multichannel",
    permission: "CastleGate Multi Channel Orders Read / Write",
    policy: "excluded",
  },
]);

function safeJson(value) {
  try {
    return JSON.parse(String(value || "{}"));
  } catch {
    return {};
  }
}

function newestMatchingState(states, scope) {
  return states
    .filter((state) => (
      scope.evidenceKey
        ? state.key === scope.evidenceKey
        : String(state.key || "").startsWith(scope.evidencePrefix)
    ))
    .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at))[0];
}

function evidenceStatus(scope, state, now) {
  if (!state) {
    return {
      status: "unverified",
      lastSuccessAt: null,
      detail: "尚无成功 API 调用证据",
    };
  }
  const value = safeJson(state.value);
  if (
    value.status === "failed"
    || value.status === "integrity-error"
    || value.complete === false
    || value.integrity?.closed === false
  ) {
    return {
      status: "failed",
      lastSuccessAt: null,
      lastObservedAt: state.updated_at,
      detail: value.error || "最近调用未通过完整性校验",
    };
  }
  if (value.status === "running") {
    return {
      status: "syncing",
      lastSuccessAt: null,
      lastObservedAt: state.updated_at,
      detail: `正在同步，第 ${Math.max(1, Number(value.nextPage || 1) - 1)} / ${value.totalPages || "?"} 页已完成`,
    };
  }
  const ageMs = now.getTime() - Date.parse(state.updated_at);
  if (!Number.isFinite(ageMs) || ageMs > scope.staleAfterMs) {
    return {
      status: "stale",
      lastSuccessAt: state.updated_at,
      detail: "最近成功证据已超过新鲜度 SLA",
    };
  }
  return {
    status: "healthy",
    lastSuccessAt: state.updated_at,
    detail: "最近 API 调用成功且在新鲜度 SLA 内",
  };
}

export function buildWayfairScopeHealth({
  now = new Date(),
  syncStates = [],
} = {}) {
  const active = WAYFAIR_SCOPE_REGISTRY.filter((item) => item.policy === "active");
  const sources = active.map((scope) => ({
    id: scope.id,
    family: scope.family,
    app: scope.app,
    permission: scope.permission,
    ...evidenceStatus(scope, newestMatchingState(syncStates, scope), now),
  }));
  const summary = sources.reduce(
    (counts, source) => {
      counts[source.status] = (counts[source.status] || 0) + 1;
      return counts;
    },
    { healthy: 0, syncing: 0, stale: 0, failed: 0, unverified: 0 },
  );
  return {
    generatedAt: now.toISOString(),
    summary,
    sources,
    excluded: WAYFAIR_SCOPE_REGISTRY
      .filter((item) => item.policy === "excluded")
      .map(({ id, family, permission }) => ({ id, family, permission })),
  };
}
