"use client";

import { useEffect, useMemo, useState } from "react";
import { LINGXING_TIME_ZONE } from "@/lib/lingxing-business-time.mjs";
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

type FulfillmentSync = {
  records: number;
  labels: { archived: number; checked: number; matched?: number; ready?: number; unavailable?: number; requested?: number; errors?: number; cancelled?: number; failureReasons?: { parentOrderNumber: string; reason: string }[] };
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
const quickRanges = ["今天", "昨天", "7天", "14天", "本月", "上个月", "今年"] as const;
type QuickRange = typeof quickRanges[number] | "自定义";
const formalStart = "2026-09-01";

function isoDate(value: Date) { return value.toISOString().slice(0, 10); }

function businessToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: LINGXING_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
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
  const today = businessToday();
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  if (label === "今天") return withinFormalRange({ start: isoDate(today), end: isoDate(today) });
  if (label === "昨天") {
    const yesterday = isoDate(addDays(today, -1));
    return withinFormalRange({ start: yesterday, end: yesterday });
  }
  if (label === "7天") return withinFormalRange({ start: isoDate(addDays(today, -6)), end: isoDate(today) });
  if (label === "14天") return withinFormalRange({ start: isoDate(addDays(today, -13)), end: isoDate(today) });
  if (label === "本月") return withinFormalRange({ start: `${year}-${String(month + 1).padStart(2, "0")}-01`, end: isoDate(today) });
  if (label === "上个月") return withinFormalRange({ start: isoDate(new Date(Date.UTC(year, month - 1, 1))), end: isoDate(new Date(Date.UTC(year, month, 0))) });
  return withinFormalRange({ start: `${year}-01-01`, end: isoDate(today) });
}

function display(value: unknown) {
  return value === "" || value == null ? "—" : String(value);
}

function displayOrderDateTime(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw || /^\d{4}-\d{2}-\d{2}$/.test(raw)) return display(raw);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: LINGXING_TIME_ZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(parsed);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")}`;
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
  const [selectedLabelKeys, setSelectedLabelKeys] = useState<string[]>([]);
  const [downloadingLabels, setDownloadingLabels] = useState(false);

  const load = async (refresh = false) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ start: range.start, end: range.end, limit: "2000" });
      if (status) params.set("status", status);
      if (refresh) params.set("refresh", "1");
      const response = await fetch(`/api/fulfillment/orders?${params}`, { cache: "no-store" });
      const body = await response.json() as { records?: FulfillmentRecord[]; sync?: FulfillmentSync | null; error?: string };
      if (!response.ok) throw new Error(body.error || "履约订单读取失败");
      setRecords(body.records || []);
      setSelectedLabelKeys((current) => current.filter((key) => (body.records || []).some((record) => record.sourceKey === key && record.labelObjectKey)));
      if (refresh && body.sync) {
        const { checked, archived, matched = 0, requested = 0, errors = 0, cancelled = 0, failureReasons = [] } = body.sync.labels;
        if (errors) {
          const details = failureReasons.map(({ parentOrderNumber, reason }) => `${parentOrderNumber}：${reason}`).join("；");
          setMessage(`已更新 ${body.sync.records} 个包裹；${errors} 个面单处理异常${details ? `：${details}` : "，请稍后重试"}${cancelled ? `；${cancelled} 个订单已取消` : ""}`);
        }
        else if (cancelled) setMessage(`已更新 ${body.sync.records} 个包裹；${cancelled} 个订单已取消`);
        else if (archived) setMessage(`已更新 ${body.sync.records} 个包裹，并获取 ${archived} 张面单`);
        else if (requested) setMessage(`已通过 Wayfair API 发起 ${requested} 个订单的面单生成；平台事件返回后系统会自动逐单校验并归档。`);
        else if (checked) setMessage(`已检查 ${checked} 个未归档订单，命中 ${matched} 个可校验的 Wayfair 面单事件；未返回下载文件的订单会由系统继续自动同步。`);
        else setMessage(`已更新 ${body.sync.records} 个包裹，暂无待获取面单`);
      } else {
        setMessage("");
      }
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
    incomplete: records.filter((record) => !record.labelObjectKey && record.shippingStatus !== "已取消").length,
  }), [records]);
  const downloadableRecords = useMemo(() => records.filter((record) => Boolean(record.labelObjectKey)), [records]);
  const selectedDownloadableKeys = useMemo(() => selectedLabelKeys.filter((key) => downloadableRecords.some((record) => record.sourceKey === key)), [downloadableRecords, selectedLabelKeys]);

  const downloadOrders = () => {
    const params = new URLSearchParams({ start: range.start, end: range.end });
    if (status) params.set("status", status);
    window.location.assign(`/api/fulfillment/orders/export?${params}`);
  };

  const toggleLabel = (sourceKey: string, checked: boolean) => {
    setSelectedLabelKeys((current) => checked ? [...new Set([...current, sourceKey])] : current.filter((key) => key !== sourceKey));
  };

  const toggleAllLabels = (checked: boolean) => {
    setSelectedLabelKeys(checked ? downloadableRecords.map((record) => record.sourceKey) : []);
  };

  const downloadSelectedLabels = async () => {
    if (!selectedDownloadableKeys.length) return;
    setDownloadingLabels(true);
    try {
      const response = await fetch("/api/fulfillment/labels/download", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceKeys: selectedDownloadableKeys }),
      });
      if (!response.ok) {
        const body = await response.json() as { error?: string };
        throw new Error(body.error || "面单下载失败");
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `Wayfair面单_${selectedDownloadableKeys.length}张.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setMessage(`已下载 ${selectedDownloadableKeys.length} 张面单压缩包`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "面单下载失败");
    } finally {
      setDownloadingLabels(false);
    }
  };

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
        <div className={styles.headerActions}>
          <button className={styles.export} onClick={downloadOrders} disabled={loading}>下载订单</button>
          <button className={styles.export} onClick={() => void downloadSelectedLabels()} disabled={downloadingLabels || !selectedDownloadableKeys.length}>{downloadingLabels ? "下载中…" : `下载已选面单（ZIP）${selectedDownloadableKeys.length ? ` (${selectedDownloadableKeys.length})` : ""}`}</button>
          <button className={styles.refresh} onClick={() => void load(true)} disabled={loading}>{loading ? "获取中…" : "手动获取订单信息+面单信息"}</button>
        </div>
      </header>

      <div className={styles.filters} aria-label="订单筛选">
        <div className={styles.quickRanges}>{quickRanges.map((item) => <button key={item} className={quickRange === item ? styles.activeRange : ""} onClick={() => { setQuickRange(item); setRange(rangeFor(item)); }}>{item}</button>)}</div>
        <label><span>开始日期</span><input type="date" min="2026-09-01" value={range.start} onChange={(event) => { setQuickRange("自定义"); setRange((current) => ({ ...current, start: event.target.value })); }} /></label>
        <label><span>结束日期</span><input type="date" min="2026-09-01" value={range.end} onChange={(event) => { setQuickRange("自定义"); setRange((current) => ({ ...current, end: event.target.value })); }} /></label>
        <label><span>订单状态</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option><option value="待获取面单">待获取面单</option><option value="待平台生成面单">待平台生成面单</option><option value="SKU待映射">SKU待映射</option><option value="已归档面单">已归档面单</option><option value="待出库">待出库</option><option value="已出库">已出库</option><option value="已发货">已发货</option><option value="已取消">已取消</option><option value="异常">异常</option></select></label>
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
          <thead><tr><th className={styles.selection}><input type="checkbox" aria-label="全选已归档面单" checked={downloadableRecords.length > 0 && selectedDownloadableKeys.length === downloadableRecords.length} onChange={(event) => toggleAllLabels(event.target.checked)} disabled={!downloadableRecords.length} /></th>{columns.map(([letter, label]) => <th key={letter}><small>{letter}</small>{label}</th>)}<th><small>附</small>面单</th><th>操作</th></tr></thead>
          <tbody>
            {!loading && records.length === 0 && <tr><td colSpan={19} className={styles.empty}>暂无可履约订单。订单同步后会自动展示可拆分的包裹。</td></tr>}
            {records.map((record) => {
              const hasLabel = Boolean(record.labelObjectKey);
              return <tr key={record.sourceKey}>
                <td className={styles.selection}><input type="checkbox" aria-label={`选择 ${record.orderNumber} 面单`} checked={selectedLabelKeys.includes(record.sourceKey)} onChange={(event) => toggleLabel(record.sourceKey, event.target.checked)} disabled={!hasLabel} /></td>
                {columns.map(([, , field]) => <td key={field}>{field === "orderDate" ? displayOrderDateTime(record[field]) : display(record[field])}</td>)}
                <td>{hasLabel ? <a className={styles.labelLink} href={`/api/fulfillment/labels/download?sourceKey=${encodeURIComponent(record.sourceKey)}`}>{record.labelFileName}</a> : "未归档"}</td>
                <td><button className={styles.edit} onClick={() => setSelected({ ...record })}>编辑</button></td>
              </tr>;
            })}
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
              type="text"
              readOnly={["orderDate", "orderNumber", "sku", "quantity"].includes(String(field))}
              onChange={(event) => updateSelected(field, event.target.value)}
            />
          </label>)}
          <label><span>发货状态</span><select value={selected.shippingStatus} onChange={(event) => updateSelected("shippingStatus", event.target.value)}>
            <option value="待获取面单">待获取面单</option><option value="待平台生成面单">待平台生成面单</option><option value="SKU待映射">SKU待映射</option><option value="已归档面单">已归档面单</option><option value="待出库">待出库</option><option value="已出库">已出库</option><option value="已发货">已发货</option><option value="已取消">已取消</option><option value="异常">异常</option>
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
