import { parseStockWorkbook, saveInventorySnapshot } from "@/lib/inventory";
import { getRuntimeBindings } from "@/lib/runtime-bindings.mjs";

const bindings = getRuntimeBindings;

export async function GET() {
  try {
    const env=await bindings();
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS inventory_snapshots (id TEXT PRIMARY KEY NOT NULL, source_file TEXT NOT NULL, summary TEXT NOT NULL, created_at TEXT NOT NULL)").run();
    const row=await env.DB.prepare("SELECT id,source_file,summary,created_at FROM inventory_snapshots ORDER BY created_at DESC LIMIT 1").first<{id:string;source_file:string;summary:string;created_at:string}>();
    if(!row) return Response.json({snapshot:null});
    return Response.json({snapshotId:row.id,sourceFile:row.source_file,summary:JSON.parse(row.summary),createdAt:row.created_at,canPush:true,warnings:[],errors:[]});
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
    return Response.json({snapshotId:snapshot.id,createdAt:snapshot.createdAt,sourceFile:parsed.sourceFile,canPush:true,summary:parsed.summary,warnings:parsed.warnings,errors:[]});
  } catch (error) {
    return Response.json({error:error instanceof Error?error.message:"库存文件解析失败"},{status:400});
  }
}
