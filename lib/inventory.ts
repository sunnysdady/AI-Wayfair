import ExcelJS from "exceljs";
import mapping from "./inventory-mapping.json";
import { calculateInventoryValueRisk } from "./inventory-value-risk.mjs";

const MAX_XLSX_SIZE = 20 * 1024 * 1024;

type StockRow = { rowNumber:number; lingxingSku:string; warehouse:string; productName:string; available:number; locked:number; incoming:number; transferInTransit:number };
type InventoryItem = { discontinued:false; supplierPartNumber:string; quantityOnHand:number; quantityOnOrder:number; supplierId:number; quantityBackordered:0 };

function clean(value: unknown) { return String(value ?? "").trim(); }

function integer(value: unknown, label: string, row: number, errors: {row:number;field:string;message:string}[]) {
  const parsed = typeof value === "number" ? value : Number(clean(value));
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    errors.push({ row, field: label, message: `${label}必须是非负整数` });
    return 0;
  }
  return parsed;
}

function cellValue(value: ExcelJS.CellValue) {
  if (value && typeof value === "object" && "result" in value) return (value as {result?:unknown}).result;
  if (value && typeof value === "object" && "text" in value) return (value as {text?:unknown}).text;
  return value;
}

export async function parseStockWorkbook(file: File) {
  if (!file.name.toLowerCase().endsWith(".xlsx")) throw new Error("请选择领星库存 XLSX 文件");
  if (!file.size || file.size > MAX_XLSX_SIZE) throw new Error("库存文件为空或超过20MB");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) throw new Error("文件不是有效的XLSX");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  const sheet = workbook.getWorksheet("sheet1") ?? workbook.worksheets[0];
  if (!sheet) throw new Error("工作簿没有可读工作表");
  const headers = new Map<string, number>();
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, column) => headers.set(clean(cell.text || cell.value), column));
  const required = ["品名", "SKU", "仓库", "可用量", "可用锁定量", "待到货量", "调拨在途"];
  const missing = required.filter((name) => !headers.has(name));
  if (missing.length) throw new Error(`库存工作表缺少列：${missing.join("、")}`);
  const errors: {row:number;field:string;message:string}[] = [];
  const stockRows: StockRow[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const get = (name:string) => cellValue(row.getCell(headers.get(name)!).value);
    const lingxingSku = clean(get("SKU"));
    const warehouse = clean(get("仓库"));
    if (!lingxingSku && !warehouse) return;
    if (!lingxingSku) errors.push({row:rowNumber,field:"SKU",message:"SKU不能为空"});
    if (!warehouse) errors.push({row:rowNumber,field:"仓库",message:"仓库不能为空"});
    stockRows.push({
      rowNumber, lingxingSku, warehouse, productName:clean(get("品名")),
      available:integer(get("可用量"),"可用量",rowNumber,errors),
      locked:integer(get("可用锁定量"),"可用锁定量",rowNumber,errors),
      incoming:integer(get("待到货量"),"待到货量",rowNumber,errors),
      transferInTransit:integer(get("调拨在途"),"调拨在途",rowNumber,errors),
    });
  });
  const duplicateKeys = new Map<string, number[]>();
  for (const row of stockRows) {
    const key = `${row.lingxingSku}\u0000${row.warehouse}`;
    duplicateKeys.set(key, [...(duplicateKeys.get(key) || []), row.rowNumber]);
  }
  for (const [key, rows] of duplicateKeys) if (rows.length > 1) errors.push({row:rows[0],field:"仓库库存",message:`重复SKU+仓库：${key.replace("\u0000"," / ")}（行${rows.join("、")}）`});
  const stockByKey = new Map(stockRows.map((row)=>[`${row.lingxingSku}\u0000${row.warehouse}`,row]));
  const items: InventoryItem[] = [];
  const rows: {item:InventoryItem;source:StockRow}[] = [];
  const warnings: {field:string;message:string}[] = [];
  let missingCombinations = 0;
  for (const sku of mapping.skuMappings) for (const warehouse of mapping.warehouseMappings) {
    const source = stockByKey.get(`${sku.lingxingSku}\u0000${warehouse.warehouse}`);
    if (!source) { missingCombinations += 1; continue; }
    const item:InventoryItem = {discontinued:false,supplierPartNumber:sku.supplierPartNumber,quantityOnHand:source.available,quantityOnOrder:source.incoming,supplierId:warehouse.supplierId,quantityBackordered:0};
    items.push(item); rows.push({item,source});
  }
  if (missingCombinations) warnings.push({field:"映射",message:`${missingCombinations}个SKU×仓库组合在本次源文件中没有记录，已跳过且未补零`});
  const zeroStockRows = items.filter((item)=>item.quantityOnHand===0).length;
  const mappedSkus = new Set(mapping.skuMappings.map((item)=>item.lingxingSku));
  const mappedWarehouses = new Set(mapping.warehouseMappings.map((item)=>item.warehouse));
  const summary = {
    totalRows:items.length, validRows:errors.length?0:items.length, errorRows:new Set(errors.map((item)=>item.row)).size,
    zeroStockRows, zeroStockRatio:items.length?zeroStockRows/items.length:0,
    totalQuantityOnHand:items.reduce((sum,item)=>sum+item.quantityOnHand,0), supplierCount:new Set(items.map((item)=>item.supplierId)).size,
    skuMappings:mapping.skuMappings.length, warehouseMappings:mapping.warehouseMappings.length, stockRows:stockRows.length, missingCombinations,
    ignoredStockRows:stockRows.filter((row)=>!mappedSkus.has(row.lingxingSku)||!mappedWarehouses.has(row.warehouse)).length,
  };
  return { items:errors.length?[]:items, rows, errors, warnings, summary, canPush:errors.length===0&&items.length>0, sourceFile:file.name };
}

export async function ensureInventoryTables(db: D1Database) {
  await db.prepare("CREATE TABLE IF NOT EXISTS inventory_snapshots (id TEXT PRIMARY KEY NOT NULL, source_file TEXT NOT NULL, summary TEXT NOT NULL, created_at TEXT NOT NULL)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS inventory_snapshot_rows (snapshot_id TEXT NOT NULL, part_number TEXT NOT NULL, supplier_id INTEGER NOT NULL, quantity_on_hand INTEGER NOT NULL, quantity_on_order INTEGER NOT NULL, warehouse TEXT NOT NULL, source_sku TEXT NOT NULL, PRIMARY KEY(snapshot_id, part_number, supplier_id))").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS inventory_snapshot_rows_part_idx ON inventory_snapshot_rows(part_number)").run();
}

export async function saveInventorySnapshot(db: D1Database, parsed: Awaited<ReturnType<typeof parseStockWorkbook>>) {
  await ensureInventoryTables(db);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const statements = [db.prepare("INSERT INTO inventory_snapshots(id,source_file,summary,created_at) VALUES(?,?,?,?)").bind(id,parsed.sourceFile,JSON.stringify(parsed.summary),now)];
  for (const row of parsed.rows) statements.push(db.prepare("INSERT INTO inventory_snapshot_rows(snapshot_id,part_number,supplier_id,quantity_on_hand,quantity_on_order,warehouse,source_sku) VALUES(?,?,?,?,?,?,?)").bind(id,row.item.supplierPartNumber,row.item.supplierId,row.item.quantityOnHand,row.item.quantityOnOrder,row.source.warehouse,row.source.lingxingSku));
  for (let index=0; index<statements.length; index+=80) await db.batch(statements.slice(index,index+80));
  await db.prepare("DELETE FROM sync_state WHERE key LIKE 'ads-analysis:%'").run();
  return {id,createdAt:now};
}

export async function loadSnapshotItems(db: D1Database, snapshotId: string) {
  await ensureInventoryTables(db);
  const result = await db.prepare("SELECT part_number,supplier_id,quantity_on_hand,quantity_on_order FROM inventory_snapshot_rows WHERE snapshot_id=? ORDER BY part_number,supplier_id").bind(snapshotId).all<{part_number:string;supplier_id:number;quantity_on_hand:number;quantity_on_order:number}>();
  return (result.results||[]).map((row)=>({discontinued:false,supplierPartNumber:row.part_number,quantityOnHand:Number(row.quantity_on_hand),quantityOnOrder:Number(row.quantity_on_order),supplierId:Number(row.supplier_id),quantityBackordered:0}));
}

type InventoryPushBatchReceipt = {
  index:number;
  expectedItemCount:number;
  feed?:{id?:string;handle?:string;status?:string;submittedAt?:string;completedAt?:string;itemCount?:number;errorCount?:number;errors?:{key?:string;message?:string}[]};
  state:string;
  reason:string;
};

export async function saveInventoryPushRun(db:D1Database,input:{pushId:string;snapshotId:string;status:string;itemCount:number;batchCount:number;completedBatches:number;failedBatches:number;batches:InventoryPushBatchReceipt[]}) {
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS inventory_push_runs (id TEXT PRIMARY KEY NOT NULL, snapshot_id TEXT NOT NULL, status TEXT NOT NULL, item_count INTEGER NOT NULL, batch_count INTEGER NOT NULL, completed_batches INTEGER NOT NULL DEFAULT 0, failed_batches INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS inventory_push_runs_snapshot_idx ON inventory_push_runs(snapshot_id)"),
    db.prepare("CREATE TABLE IF NOT EXISTS inventory_push_batches (push_id TEXT NOT NULL, batch_index INTEGER NOT NULL, feed_id TEXT, handle TEXT, status TEXT NOT NULL, state TEXT NOT NULL, expected_item_count INTEGER NOT NULL, item_count INTEGER, error_count INTEGER NOT NULL DEFAULT 0, errors TEXT NOT NULL DEFAULT '[]', submitted_at TEXT, completed_at TEXT, reason TEXT, PRIMARY KEY(push_id,batch_index))"),
    db.prepare("CREATE INDEX IF NOT EXISTS inventory_push_batches_push_idx ON inventory_push_batches(push_id)"),
  ]);
  const now=new Date().toISOString();
  await db.prepare("INSERT OR REPLACE INTO inventory_push_runs(id,snapshot_id,status,item_count,batch_count,completed_batches,failed_batches,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(input.pushId,input.snapshotId,input.status,input.itemCount,input.batchCount,input.completedBatches,input.failedBatches,now,now).run();
  for(const batch of input.batches){
    const feed=batch.feed;
    await db.prepare("INSERT OR REPLACE INTO inventory_push_batches(push_id,batch_index,feed_id,handle,status,state,expected_item_count,item_count,error_count,errors,submitted_at,completed_at,reason) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(input.pushId,batch.index,feed?.id||null,feed?.handle||null,String(feed?.status||"UNKNOWN"),batch.state,batch.expectedItemCount,feed?.itemCount??null,Number(feed?.errorCount||0),JSON.stringify(feed?.errors||[]),feed?.submittedAt||null,feed?.completedAt||null,batch.reason||null).run();
  }
}

export async function loadInventoryValueRisk(db: D1Database, snapshotId: string) {
  await ensureInventoryTables(db);
  await db.prepare("CREATE TABLE IF NOT EXISTS sku_costs (part_number TEXT PRIMARY KEY NOT NULL, unit_cost_cents INTEGER NOT NULL, source TEXT DEFAULT 'manual' NOT NULL, updated_at TEXT NOT NULL)").run();
  const snapshot = await db.prepare("SELECT created_at FROM inventory_snapshots WHERE id=?").bind(snapshotId).first<{created_at:string}>();
  if (!snapshot) return calculateInventoryValueRisk();
  const previous = await db.prepare("SELECT id FROM inventory_snapshots WHERE created_at<? ORDER BY created_at DESC LIMIT 1").bind(snapshot.created_at).first<{id:string}>();
  const [currentRows, previousRows, costs] = await Promise.all([
    db.prepare("SELECT part_number,quantity_on_hand FROM inventory_snapshot_rows WHERE snapshot_id=?").bind(snapshotId).all<{part_number:string;quantity_on_hand:number}>(),
    previous?.id
      ? db.prepare("SELECT part_number,quantity_on_hand FROM inventory_snapshot_rows WHERE snapshot_id=?").bind(previous.id).all<{part_number:string;quantity_on_hand:number}>()
      : Promise.resolve({ results: [] as {part_number:string;quantity_on_hand:number}[] }),
    db.prepare("SELECT part_number,unit_cost_cents FROM sku_costs").all<{part_number:string;unit_cost_cents:number}>(),
  ]);
  return calculateInventoryValueRisk(
    currentRows.results || [],
    previousRows.results || [],
    new Map((costs.results || []).map((row) => [row.part_number, Number(row.unit_cost_cents)])),
  );
}
