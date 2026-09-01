"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./workspace.module.css";

type FulfillmentRecord = {
  sourceKey: string;
  source: string;
  orderDate: string;
  systemOrderNumber: string;
  parentOrderNumber: string;
  orderNumber: string;
  country: string;
  customerName: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  stateRegion: string;
  postalCode: string;
  phone: string;
  warehouseSkuCode: string;
  trackingNumber: string;
  sku: string;
  quantity: number;
  shippingStatus: string;
  labelObjectKey: string;
  labelFileName: string;
};

const columns: Array<[string, string, keyof FulfillmentRecord]> = [
  ["A", "日期", "orderDate"], ["B", "系统单号", "systemOrderNumber"], ["C", "单号", "orderNumber"],
  ["D", "国家", "country"], ["E", "客人姓名", "customerName"], ["F", "地址1", "addressLine1"],
  ["G", "地址2", "addressLine2"], ["H", "城市", "city"], ["I", "州", "stateRegion"],
  ["J", "邮编", "postalCode"], ["K", "电话", "phone"], ["L", "云仓SKU编码", "warehouseSkuCode"],
  ["M", "跟踪号", "trackingNumber"], ["N", "SKU", "sku"], ["O", "数量", "quantity"],
  ["P", "发货状态", "shippingStatus"],
];

const editableFields: Array<[string, keyof FulfillmentRecord]> = columns.slice(0, -1).map(([, label, field]) => [label, field]);
const quickRanges = ["7天", "14天", "本月", "上个月", "今年"] as const;
type QuickRange = typeof quickRanges[number] | "自定义";
const formalStart = "2026-09-01";

function isoDate(value: Date) { return value.toISOString().slice(0, 10); }

function newYorkToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || "";
  return new Date(Date.UTC(Number(part("year")), Number(part("month")) - 1, Number(part("day"))));
}

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function withinFormalRange(range: { start: string; end: string }) {
  if (range.end < formalStart) return { start: formalStart, end: formalStart };
  return { start: range.start < formalStart ? formalStart : range.start, end: range.end };
}

function rangeFor(label: typeof quickRanges[number]) {
  const today = newYorkToday();
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  if (label === "7天") return withinFormalRange({ start: isoDate(addDays(today, -6)), end: isoDate(today) });
  if (label === "14天") return withinFormalRange({ start: isoDate(addDays(today, -13)), end: isoDate(today) });
  if (label === "本月") return withinFormalRange({ start: `${year}-${String(month + 1).padStart(2, "0")}-01`, end: isoDate(today) });
  if (label === "上个月") return withinFormalRange({ start: isoDate(new Date(Date.UTC(year, month - 1, 1))), end: isoDate(new Date(Date.UTC(year, month, 0))) });
  return withinFormalRange({ start: `${year}-01-01`, end: isoDate(today) });
}

function display(value: unknown) {
  return value === "" || value == null ? "—" : String(value);
}

export default function FulfillmentWorkspace() {
  const [records, setRecords] = useState<FulfillmentRecord[]>([]);
  const [selected, setSelected] = useState<FulfillmentRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [quickRange, setQuickRange] = useState<QuickRange>("7天");
  const [range, setRange] = useState(() => rangeFor("7天"));
  const [status, setStatus] = useState("");

  const load = async (refresh = false) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ start: range.start, end: range.end, limit: "2000" });
      if (status) params.set("status", status);
      if (refresh) params.set("refresh", "1");
      const response = await fetch(`/api/fulfillment/orders?${params}`, { cache: "no-store" });
      const body = await response.json() as { records?: FulfillmentRecord[]; error?: string };
      if (!response.ok) throw new Error(body.error || "履约订单读取失败");
      setRecords(body.records || []);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "履约订单读取失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [range.start, range.end, status]);

  const overview = useMemo(() => ({
    total: records.length,
    tracked: records.filter((record) => record.trackingNumber).length,
    labels: records.filter((record) => record.labelObjectKey).length,
    incomplete: records.filter((record) => !record.labelObjectKey).length,
  }), [records]);

  const updateSelected = (field: keyof FulfillmentRecord, value: string) => {
    setSelected((current) => current ? { ...current, [field]: field === "quantity" ? Number(value) : value } : current);
  };

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const response = await fetch("/api/fulfillment/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(selected),
      });
      const body = await response.json() as { record?: FulfillmentRecord; error?: string };
      if (!response.ok || !body.record) throw new Error(body.error || "履约订单保存失败");
      setRecords((current) => current.map((record) => record.sourceKey === body.record?.sourceKey ? body.record : record));
      setSelected(body.record);
      setMessage(`已保存 ${body.record.orderNumber}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "履约订单保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={styles.workspace} aria-labelledby="fulfillment-title">
      <header className={styles.header}>
        <h1 id="fulfillment-title">订单履约</h1>
        <button className={styles.refresh} onClick={() => void load(true)} disabled={loading}>{loading ? "同步中…" : "API 同步订单"}</button>
      </header>

      <div className={styles.filters} aria-label="订单筛选">
        <div className={styles.quickRanges}>{quickRanges.map((item) => <button key={item} className={quickRange === item ? styles.activeRange : ""} onClick={() => { setQuickRange(item); setRange(rangeFor(item)); }}>{item}</button>)}</div>
        <label><span>开始日期</span><input type="date" min="2026-09-01" value={range.start} onChange={(event) => { setQuickRange("自定义"); setRange((current) => ({ ...current, start: event.target.value })); }} /></label>
        <label><span>结束日期</span><input type="date" min="2026-09-01" value={range.end} onChange={(event) => { setQuickRange("自定义"); setRange((current) => ({ ...current, end: event.target.value })); }} /></label>
        <label><span>订单状态</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option><option value="待获取面单">待获取面单</option><option value="SKU待映射">SKU待映射</option><option value="面单待核验">面单待核验</option><option value="已归档面单">已归档面单</option><option value="待出库">待出库</option><option value="已出库">已出库</option><option value="已发货">已发货</option><option value="异常">异常</option></select></label>
      </div>

      <div className={styles.metrics} aria-label="履约概况">
        <Metric label="拆分包裹" value={overview.total} />
        <Metric label="已有跟踪号" value={overview.tracked} />
        <Metric label="已归档面单" value={overview.labels} />
        <Metric label="待面单/补全" value={overview.incomplete} />
      </div>

      {message && <p className={styles.message} role="status">{message}</p>}
      <div className={styles.tableWrap}>
        <table>
          <thead><tr>{columns.map(([letter, label]) => <th key={letter}><small>{letter}</small>{label}</th>)}<th><small>附</small>面单</th><th>操作</th></tr></thead>
          <tbody>
            {!loading && records.length === 0 && <tr><td colSpan={18} className={styles.empty}>暂无可履约订单。订单同步后会自动展示可拆分的包裹。</td></tr>}
            {records.map((record) => <tr key={record.sourceKey}>
              {columns.map(([, , field]) => <td key={field}>{display(record[field])}</td>)}
              <td>{record.labelObjectKey ? record.labelFileName : "待回传"}</td>
              <td><button className={styles.edit} onClick={() => setSelected({ ...record })}>编辑</button></td>
            </tr>)}
          </tbody>
        </table>
      </div>

      {selected && <aside className={styles.drawer} aria-label={`编辑 ${selected.orderNumber}`}>
        <div className={styles.drawerHeader}>
          <div><p>原始订单：{selected.parentOrderNumber}</p><h2>{selected.orderNumber}</h2></div>
          <button aria-label="关闭编辑" onClick={() => setSelected(null)}>×</button>
        </div>
        <p className={styles.drawerHint}>单号和 SKU 是拆分锚点，不能在此修改；数量固定为 1，确保每个记录只对应一张面单。</p>
        <div className={styles.formGrid}>
          {editableFields.map(([label, field]) => <label key={String(field)}>
            <span>{label}</span>
            <input
              value={String(selected[field] ?? "")}
              type={field === "orderDate" ? "date" : "text"}
              readOnly={["orderNumber", "sku", "quantity"].includes(String(field))}
              onChange={(event) => updateSelected(field, event.target.value)}
            />
          </label>)}
          <label><span>发货状态</span><select value={selected.shippingStatus} onChange={(event) => updateSelected("shippingStatus", event.target.value)}>
            <option value="待获取面单">待获取面单</option><option value="SKU待映射">SKU待映射</option><option value="面单待核验">面单待核验</option><option value="已归档面单">已归档面单</option><option value="待出库">待出库</option><option value="已出库">已出库</option><option value="已发货">已发货</option><option value="异常">异常</option>
          </select></label>
          <label><span>面单文件名</span><input value={selected.labelFileName} readOnly /></label>
        </div>
        <div className={styles.actions}><button className={styles.cancel} onClick={() => setSelected(null)}>取消</button><button className={styles.save} onClick={() => void save()} disabled={saving}>{saving ? "保存中…" : "保存记录"}</button></div>
      </aside>}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <article><span>{label}</span><strong>{value}</strong></article>;
}
