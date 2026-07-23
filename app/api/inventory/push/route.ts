import { loadSnapshotItems } from "@/lib/inventory";
import { getRuntimeBindings } from "@/lib/runtime-bindings.mjs";
import { assertLiveOperation } from "@/lib/operating-safety.mjs";
import { classifyInventoryFeed, summarizeInventoryFeeds } from "@/lib/wayfair-inventory-feed.mjs";

const MUTATION = `mutation saveInventory($inventory: [inventoryInput]!, $feedKind: inventoryFeedKind) { inventory { save(inventory: $inventory, feedKind: $feedKind) { id handle status submittedAt completedAt itemCount errorCount errors { key message } } } }`;

const bindings = getRuntimeBindings;
type FeedReceipt = {id?:string;handle?:string;status?:string;submittedAt?:string;completedAt?:string;itemCount?:number;errorCount?:number;errors?:{key?:string;message?:string}[]};

async function ensurePushTables(db:D1Database) {
  await db.prepare("CREATE TABLE IF NOT EXISTS inventory_push_runs (id TEXT PRIMARY KEY NOT NULL, snapshot_id TEXT NOT NULL, status TEXT NOT NULL, item_count INTEGER NOT NULL, batch_count INTEGER NOT NULL, completed_batches INTEGER NOT NULL DEFAULT 0, failed_batches INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS inventory_push_batches (push_id TEXT NOT NULL, batch_index INTEGER NOT NULL, feed_id TEXT, handle TEXT, status TEXT NOT NULL, state TEXT NOT NULL, expected_item_count INTEGER NOT NULL, item_count INTEGER, error_count INTEGER NOT NULL DEFAULT 0, errors TEXT NOT NULL DEFAULT '[]', submitted_at TEXT, completed_at TEXT, reason TEXT, PRIMARY KEY(push_id,batch_index))").run();
}

async function persistRun(db:D1Database,pushId:string,snapshotId:string,itemCount:number,plannedBatchCount:number,batches:{index:number;expectedItemCount:number;feed?:FeedReceipt;state:string;reason:string}[]) {
  await ensurePushTables(db);
  const summary=summarizeInventoryFeeds(batches);
  const now=new Date().toISOString();
  await db.prepare("INSERT OR REPLACE INTO inventory_push_runs(id,snapshot_id,status,item_count,batch_count,completed_batches,failed_batches,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(pushId,snapshotId,summary.status,itemCount,plannedBatchCount,summary.completed,summary.failed,now,now).run();
  for(const batch of batches){
    const feed=batch.feed;
    await db.prepare("INSERT OR REPLACE INTO inventory_push_batches(push_id,batch_index,feed_id,handle,status,state,expected_item_count,item_count,error_count,errors,submitted_at,completed_at,reason) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(pushId,batch.index,feed?.id||null,feed?.handle||null,String(feed?.status||"UNKNOWN"),batch.state,batch.expectedItemCount,feed?.itemCount??null,Number(feed?.errorCount||0),JSON.stringify(feed?.errors||[]),feed?.submittedAt||null,feed?.completedAt||null,batch.reason||null).run();
  }
  return summary;
}

async function token(env: Pick<Env,"WAYFAIR_OPS_CLIENT_ID"|"WAYFAIR_OPS_CLIENT_SECRET">) {
  if(!env.WAYFAIR_OPS_CLIENT_ID||!env.WAYFAIR_OPS_CLIENT_SECRET) throw new Error("库存/订单API凭证未配置");
  const response = await fetch("https://sso.auth.wayfair.com/oauth/token",{method:"POST",headers:{"content-type":"application/json",accept:"application/json"},body:JSON.stringify({grant_type:"client_credentials",client_id:env.WAYFAIR_OPS_CLIENT_ID,client_secret:env.WAYFAIR_OPS_CLIENT_SECRET,audience:"https://api.wayfair.com/"})});
  if(!response.ok) throw new Error(`Wayfair OAuth失败（HTTP ${response.status}）`);
  const body=await response.json() as {access_token?:string};
  if(!body.access_token) throw new Error("Wayfair OAuth响应缺少access_token");
  return body.access_token;
}

export async function POST(request: Request) {
  try {
    const body=await request.json() as {snapshotId?:string;dryRun?:boolean;confirmation?:string;zeroStockConfirmed?:boolean};
    if(!body.snapshotId) return Response.json({error:"缺少库存快照"},{status:400});
    const env=await bindings();
    const items=await loadSnapshotItems(env.DB,body.snapshotId);
    if(!items.length) return Response.json({error:"库存快照不存在或为空"},{status:404});
    const batches=[]; for(let index=0;index<items.length;index+=100)batches.push(items.slice(index,index+100));
    if(body.dryRun!==false) return Response.json({mode:"dry-run",snapshotId:body.snapshotId,itemCount:items.length,batchCount:batches.length,zeroStockRows:items.filter((item)=>item.quantityOnHand===0).length});
    try { assertLiveOperation(env, "inventory", items.map((item)=>item.supplierId)); }
    catch(error){return Response.json({error:error instanceof Error?error.message:"库存生产写入被安全闸门阻止"},{status:403});}
    if(body.confirmation!=="正式推送") return Response.json({error:"确认文字必须是“正式推送”"},{status:400});
    const zeroRatio=items.filter((item)=>item.quantityOnHand===0).length/items.length;
    if(zeroRatio>=.5&&!body.zeroStockConfirmed) return Response.json({error:"零库存占比过高，需要单独确认"},{status:400});
    const accessToken=await token(env);
    const pushId=crypto.randomUUID();
    const receipts:{index:number;expectedItemCount:number;feed?:FeedReceipt;state:string;reason:string}[]=[];
    for(let index=0;index<batches.length;index++){
      const inventory=batches[index];
      try {
        const response=await fetch("https://api.wayfair.com/v1/graphql",{method:"POST",headers:{authorization:`Bearer ${accessToken}`,"content-type":"application/json",accept:"application/json"},body:JSON.stringify({query:MUTATION,variables:{inventory,feedKind:"TRUE_UP"}})});
        const result=await response.json() as {errors?:{message:string}[];data?:{inventory?:{save?:FeedReceipt}}};
        if(!response.ok||result.errors?.length){
          const reason=result.errors?.map((item)=>item.message).join("；")||`库存API失败（HTTP ${response.status}）`;
          receipts.push({index,expectedItemCount:inventory.length,state:"failed",reason});
          break;
        }
        const feed=result.data?.inventory?.save;
        const classified=classifyInventoryFeed(feed,inventory.length);
        receipts.push({index,expectedItemCount:inventory.length,feed,state:classified.state,reason:classified.reason});
        if(classified.state==="failed") break;
      } catch(error) {
        receipts.push({index,expectedItemCount:inventory.length,state:"failed",reason:error instanceof Error?error.message:"Wayfair 库存批次请求失败"});
        break;
      }
    }
    const summary=await persistRun(env.DB,pushId,body.snapshotId,items.length,batches.length,receipts);
    const payload={mode:"live",pushId,snapshotId:body.snapshotId,itemCount:items.length,batchCount:batches.length,status:summary.status,completedBatches:summary.completed,failedBatches:summary.failed,batches:receipts.map(({feed,...item})=>({...item,feedId:feed?.id||feed?.handle||null,status:feed?.status||"UNKNOWN",itemCount:feed?.itemCount??null,errorCount:feed?.errorCount??0,completedAt:feed?.completedAt||null}))};
    if(summary.status==="failed") return Response.json({...payload,error:"Wayfair 库存批次未全部成功，请检查批次错误后再处理"},{status:422});
    if(summary.status==="processing") return Response.json(payload,{status:202});
    return Response.json(payload);
  } catch(error){return Response.json({error:error instanceof Error?error.message:"库存推送失败"},{status:500});}
}
