const VALID_VIEWS = new Set([
  "dashboard",
  "tasks",
  "daily",
  "ads",
  "planning",
  "products",
  "fulfillment",
  "assistant",
  "sources",
  "help",
]);

const VALID_TABS = {
  daily: new Set(["operating", "email"]),
  ads: new Set(["manager", "listings", "ai", "manual", "review"]),
  planning: new Set(["plan", "august", "september", "review", "history"]),
  products: new Set(["inventory", "catalog", "launch", "performance"]),
};

const LEGACY_TAB_REDIRECTS = {
  products: { addition: "catalog" },
};

function canonicalTab(view, tab) {
  return LEGACY_TAB_REDIRECTS[view]?.[tab] ?? tab;
}

/** @param {string} [search] */
export function navigationStateFromSearch(search = "") {
  const params = new URLSearchParams(search);
  const requestedView = params.get("view");
  const view = VALID_VIEWS.has(requestedView) ? requestedView : "dashboard";
  const requestedTab = canonicalTab(view, params.get("tab"));
  const validTabs = VALID_TABS[view];
  const tab = validTabs?.has(requestedTab) ? requestedTab : null;
  return { view, tab };
}

/** @param {{ view: string, tab?: string | null }} state */
export function navigationSearch({ view, tab = null }) {
  const params = new URLSearchParams({ view });
  if (tab) params.set("tab", canonicalTab(view, tab));
  return `?${params.toString()}`;
}
