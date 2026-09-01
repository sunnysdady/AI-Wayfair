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

function display(value: unknown) {
  return value === "" || value == null ? "—" : String(value);
}

export default function FulfillmentWorkspace() {
  const [records, setRecords] = useState<FulfillmentRecord[]>([]);
  const [selected, setSelected] = useState<FulfillmentRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/fulfillment/orders", { cache: "no-store" });
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

  useEffect(() => { void load(); }, []);

  const overview = useMemo(() => ({
    total: records.length,
    tracked: records.filter((record) => record.trackingNumber).length,
    labels: records.filter((record) => record.labelObjectKey).length,
    incomplete: records.filter((record) => record.shippingStatus === "待补全").length,
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
        <div>
          <p className={styles.eyebrow}>订单履约台账 · A–P 标准模板</p>
          <h1 id="fulfillment-title">订单履约</h1>
          <p>一单多件按订单行和数量拆成独立包裹：<b>原订单号-1、-2…</b>。每张面单也使用对应拆分单号命名。</p>
        </div>
        <button className={styles.refresh} onClick={() => void load()} disabled={loading}>{loading ? "加载中…" : "刷新订单"}</button>
      </header>

      <div className={styles.notice}>
        当前 Wayfair 订单接口已带入日期、订单号、SKU 和数量；收件信息、云仓 SKU、跟踪号和已生成面单将由履约/仓储接口回写。系统不会自动购买、打印或上传面单。
      </div>

      <div className={styles.metrics} aria-label="履约概况">
        <Metric label="拆分包裹" value={overview.total} />
        <Metric label="已有跟踪号" value={overview.tracked} />
        <Metric label="已归档面单" value={overview.labels} />
        <Metric label="待补全" value={overview.incomplete} />
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
            <option value="待补全">待补全</option><option value="待出库">待出库</option><option value="已出库">已出库</option><option value="已发货">已发货</option><option value="异常">异常</option>
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
