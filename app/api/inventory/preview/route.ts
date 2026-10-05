import { loadInventoryValueRisk, parseStockWorkbook, saveInventorySnapshot } from "@/lib/inventory";
import { getRuntimeBindings } from "@/lib/runtime-bindings.mjs";

const bindings = getRuntimeBindings;

// 定时任务（lib/scheduled-inventory-sync.mjs）写入的最近一次拉取/推送状态，供页面展示。
async function loadAutoState(db: D1Database) {
  try {
    const row=await db.prepare("SELECT value FROM sync_state WHERE key=?").bind("server:inventory-auto:last-run").first<{value:string}>();
    if(!row?.value) return null;
    const state=JSON.parse(row.value);
    return {pulledAt:state.pulledAt||null,lastPushAt:state.lastPushAt||null,nextPushAfter:state.nextPushAfter||null,push:state.push||null,pullError:state.pullError||null};
  } catch { return null; }
}

export async function GET() {
  try {
    const env=await bindings();
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS inventory_snapshots (id TEXT PRIMARY KEY NOT NULL, source_file TEXT NOT NULL, summary TEXT NOT NULL, created_at TEXT NOT NULL)").run();
    const row=await env.DB.prepare("SELECT id,source_file,summary,created_at FROM inventory_snapshots ORDER BY created_at DESC LIMIT 1").first<{id:string;source_file:string;summary:string;created_at:string}>();
    const auto=await loadAutoState(env.DB);
    if(!row) return Response.json({snapshot:null,auto});
    const valueRisk=await loadInventoryValueRisk(env.DB,row.id);
    return Response.json({snapshotId:row.id,sourceFile:row.source_file,summary:JSON.parse(row.summary),valueRisk,createdAt:row.created_at,canPush:true,warnings:[],errors:[],auto});
  } catch(error){return Response.json({error:error instanceof Error?error.message:"库存快照读取失败"},{status:500});}
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({error:"请选择库存XLSX文件"},{status:400});
    const parsed = await parseStockWorkbook(file);
    if (!parsed.canPush) return Response.json({error:"库存校验未通过",errors:parsed.errors.slice(0,50),warnings:parsed.warnings,summary:parsed.summary},{status:422});
    const env = await bindings();
    const snapshot = await saveInventorySnapshot(env.DB, parsed);
    const valueRisk=await loadInventoryValueRisk(env.DB,snapshot.id);
    const valueWarnings=valueRisk.costCoverage<.8?[{field:"成本覆盖",message:`库存价值风险仅覆盖 ${Math.round(valueRisk.costCoverage*100)}% 件数；未覆盖成本的库存不计入金额变化`}]:[];
    return Response.json({snapshotId:snapshot.id,createdAt:snapshot.createdAt,sourceFile:parsed.sourceFile,canPush:true,summary:parsed.summary,valueRisk,warnings:[...parsed.warnings,...valueWarnings],errors:[]});
  } catch (error) {
    return Response.json({error:error instanceof Error?error.message:"库存文件解析失败"},{status:400});
  }
}
