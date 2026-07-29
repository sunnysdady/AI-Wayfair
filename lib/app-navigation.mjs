const VALID_VIEWS = new Set([
  "dashboard",
  "tasks",
  "daily",
  "ads",
  "planning",
  "products",
  "sources",
  "help",
]);

const VALID_TABS = {
  daily: new Set(["operating", "email"]),
  ads: new Set(["manager", "listings", "ai", "manual", "review"]),
  planning: new Set(["plan", "august", "review", "history"]),
  products: new Set(["inventory", "catalog", "launch", "performance"]),
};

/** @param {string} [search] */
export function navigationStateFromSearch(search = "") {
  const params = new URLSearchParams(search);
  const requestedView = params.get("view");
  const view = VALID_VIEWS.has(requestedView) ? requestedView : "dashboard";
  const requestedTab = params.get("tab");
  const validTabs = VALID_TABS[view];
  const tab = validTabs?.has(requestedTab) ? requestedTab : null;
  return { view, tab };
}

/** @param {{ view: string, tab?: string | null }} state */
export function navigationSearch({ view, tab = null }) {
  const params = new URLSearchParams({ view });
  if (tab) params.set("tab", tab);
  return `?${params.toString()}`;
}
