function comparable(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value ? 1 : 0;
  const numeric = Number(String(value).replace(/[$,%×,]/g, ""));
  return Number.isFinite(numeric) && String(value).trim() !== "" ? numeric : String(value).toLocaleLowerCase("zh-CN");
}

export function sortRows(rows = [], sort = {}, accessors = {}) {
  const accessor = accessors[sort.key];
  if (!accessor) return [...rows];
  const direction = sort.direction === "asc" ? 1 : -1;
  return rows.map((row, index) => ({ row, index })).sort((left, right) => {
    const a = comparable(accessor(left.row));
    const b = comparable(accessor(right.row));
    if (a === null && b === null) return left.index - right.index;
    if (a === null) return 1;
    if (b === null) return -1;
    const compared = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), "zh-CN", { numeric: true });
    return compared === 0 ? left.index - right.index : compared * direction;
  }).map(({ row }) => row);
}

export function nextSort(current, key) {
  return current.key === key ? { key, direction: current.direction === "desc" ? "asc" : "desc" } : { key, direction: "desc" };
}
