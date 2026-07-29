import { loadAcceptedInventoryDryRun, loadInventoryPushRun, loadSnapshotItems, saveInventoryPushRun } from "@/lib/inventory";
import { getRuntimeBindings } from "@/lib/runtime-bindings.mjs";
import { assertLiveOperation } from "@/lib/operating-safety.mjs";
import { classifyInventoryFeed, isInventoryDryRunAccepted, summarizeInventoryFeeds } from "@/lib/wayfair-inventory-feed.mjs";

const FEED_FIELDS = `id handle status submittedAt completedAt itemCount errorCount completedCount processingCount errors(limit:100) { key message }`;
const MUTATION = `mutation saveInventory($inventory: [inventoryInput]!, $feedKind: inventoryFeedKind, $dryRun:Boolean!) { inventory { save(inventory: $inventory, feedKind: $feedKind, dryRun:$dryRun) { ${FEED_FIELDS} } } }`;
const STATUS_QUERY = `query InventoryTransaction($handle:String!) { transactions(filters:[{field:handle,equals:$handle}],limit:1) { ${FEED_FIELDS} } }`;
// Each snapshot contains every active supplier part across every production
// warehouse. Wayfair requires that baseline to be sent as one TRUE_UP feed.
const INVENTORY_FEED_KIND = "TRUE_UP";

const bindings = getRuntimeBindings;
type FeedReceipt = {id?:string;handle?:string;status?:string;submittedAt?:string;completedAt?:string;itemCount?:number;errorCount?:number;completedCount?:number;processingCount?:number;errors?:{key?:string;message?:string}[]};

async function token(env: Pick<Env,"WAYFAIR_OPS_CLIENT_ID"|"WAYFAIR_OPS_CLIENT_SECRET">) {
  if(!env.WAYFAIR_OPS_CLIENT_ID||!env.WAYFAIR_OPS_CLIENT_SECRET) throw new Error("库存/订单API凭证未配置");
  const response = await fetch("https://sso.auth.wayfair.com/oauth/token",{method:"POST",headers:{"content-type":"application/json",accept:"application/json"},body:JSON.stringify({grant_type:"client_credentials",client_id:env.WAYFAIR_OPS_CLIENT_ID,client_secret:env.WAYFAIR_OPS_CLIENT_SECRET,audience:"https://api.wayfair.com/"})});
  if(!response.ok) throw new Error(`Wayfair OAuth失败（HTTP ${response.status}）`);
  const body=await response.json() as {access_token?:string};
  if(!body.access_token) throw new Error("Wayfair OAuth响应缺少access_token");
  return body.access_token;
}

async function wayfairRequest(accessToken:string,query:string,variables:Record<string,unknown>={}) {
  const response=await fetch("https://api.wayfair.com/v1/graphql",{method:"POST",headers:{authorization:`Bearer ${accessToken}`,"content-type":"application/json",accept:"application/json"},body:JSON.stringify({query,variables})});
  const body=await response.json() as {errors?:{message:string}[];data?:unknown};
  if(!response.ok||body.errors?.length) throw new Error(body.errors?.map(item=>item.message).join("；")||`Wayfair API失败（HTTP ${response.status}）`);
  return body.data as Record<string,unknown>;
}

function publicBatches(receipts:{index:number;expectedItemCount:number;feed?:FeedReceipt;state:string;reason:string}[]) {
  return receipts.map(({feed,...item})=>({...item,feedId:feed?.id||feed?.handle||null,status:feed?.status||"UNKNOWN",itemCount:feed?.itemCount??null,errorCount:feed?.errorCount??0,completedCount:feed?.completedCount??null,processingCount:feed?.processingCount??null,completedAt:feed?.completedAt||null}));
}

export async function GET(request:Request) {
  try {
    const pushId=new URL(request.url).searchParams.get("pushId");
    if(!pushId)return Response.json({error:"缺少库存推送回执 ID"},{status:400});
    const env=await bindings();
    const run=await loadInventoryPushRun(env.DB,pushId);
    if(!run)return Response.json({error:"库存推送回执不存在"},{status:404});
    const dryRun=run.pushId.startsWith("dryrun-");
    const accessToken=await token(env);
    const receipts=[];
    for(const batch of run.batches){
      const handle=batch.feed.handle||batch.feed.id;
      if(!handle){receipts.push({...batch,state:"failed",reason:"Wayfair 回执缺少 feed handle"});continue;}
      try{
        const data=await wayfairRequest(accessToken,STATUS_QUERY,{handle}) as {transactions?:FeedReceipt[]};
        const feed=data.transactions?.[0];
        const classified=classifyInventoryFeed(feed,{allowIndefiniteProcessing:dryRun});
        receipts.push({...batch,feed:feed||batch.feed,state:classified.state,reason:classified.reason});
      }catch(error){receipts.push({...batch,state:"failed",reason:error instanceof Error?error.message:"Wayfair feed 状态查询失败"});}
    }
    const summary=summarizeInventoryFeeds(receipts);
    await saveInventoryPushRun(env.DB,{pushId:run.pushId,snapshotId:run.snapshotId,status:summary.status,itemCount:run.itemCount,batchCount:run.batchCount,completedBatches:summary.completed,failedBatches:summary.failed,batches:receipts,createdAt:run.createdAt});
    return Response.json({mode:dryRun?"dry-run":"live",pushId:run.pushId,snapshotId:run.snapshotId,itemCount:run.itemCount,batchCount:run.batchCount,status:summary.status,dryRunAccepted:dryRun&&isInventoryDryRunAccepted(receipts),completedBatches:summary.completed,failedBatches:summary.failed,batches:publicBatches(receipts)});
  } catch(error){return Response.json({error:error instanceof Error?error.message:"Wayfair feed 状态查询失败"},{status:500});}
}

export async function POST(request: Request) {
  try {
    const body=await request.json() as {snapshotId?:string;dryRun?:boolean;confirmation?:string;zeroStockConfirmed?:boolean;resumePushId?:string};
    if(!body.snapshotId) return Response.json({error:"缺少库存快照"},{status:400});
    const env=await bindings();
    const items=await loadSnapshotItems(env.DB,body.snapshotId);
    if(!items.length) return Response.json({error:"库存快照不存在或为空"},{status:404});
    const batches=[items];
    const dryRun=body.dryRun!==false;
    if(!dryRun){
      try { assertLiveOperation(env, "inventory", items.map((item)=>item.supplierId)); }
      catch(error){return Response.json({error:error instanceof Error?error.message:"库存生产写入被安全闸门阻止"},{status:403});}
      if(body.confirmation!=="正式推送") return Response.json({error:"确认文字必须是“正式推送”"},{status:400});
      const zeroRatio=items.filter((item)=>item.quantityOnHand===0).length/items.length;
      if(zeroRatio>=.5&&!body.zeroStockConfirmed) return Response.json({error:"零库存占比过高，需要单独确认"},{status:400});
      if(!await loadAcceptedInventoryDryRun(env.DB,body.snapshotId)) return Response.json({error:"当前库存快照尚未获得 Wayfair 无错误 Dry-run 回执，禁止正式推送"},{status:409});
    }
    const accessToken=await token(env);
    const resumed=body.resumePushId?await loadInventoryPushRun(env.DB,body.resumePushId):null;
    if(body.resumePushId&&!resumed)return Response.json({error:"续传回执不存在"},{status:404});
    if(resumed&&(resumed.snapshotId!==body.snapshotId||resumed.batchCount!==batches.length))return Response.json({error:"续传回执与当前库存快照不一致"},{status:409});
    if(resumed&&resumed.pushId.startsWith("dryrun-")!==dryRun)return Response.json({error:"续传回执类型与当前操作不一致"},{status:409});
    if(resumed?.batches.some(batch=>batch.state==="failed"||!batch.feed.id&&!batch.feed.handle))return Response.json({error:"前序批次存在失败或缺失回执，不能自动续传"},{status:409});
    const pushId=resumed?.pushId||`${dryRun?"dryrun-":""}${crypto.randomUUID()}`;
    const receipts:{index:number;expectedItemCount:number;feed?:FeedReceipt;state:string;reason:string}[]=resumed?.batches||[];
    for(let index=receipts.length;index<batches.length;index++){
      const inventory=batches[index];
      try {
        const data=await wayfairRequest(accessToken,MUTATION,{inventory,feedKind:INVENTORY_FEED_KIND,dryRun}) as {inventory?:{save?:FeedReceipt}};
        const feed=data.inventory?.save;
        const classified=classifyInventoryFeed(feed,{allowIndefiniteProcessing:dryRun});
        receipts.push({index,expectedItemCount:inventory.length,feed,state:classified.state,reason:classified.reason});
        if(classified.state==="failed") break;
      } catch(error) {
        receipts.push({index,expectedItemCount:inventory.length,state:"failed",reason:error instanceof Error?error.message:"Wayfair 库存批次请求失败"});
        break;
      }
    }
    const summary=summarizeInventoryFeeds(receipts);
    await saveInventoryPushRun(env.DB,{pushId,snapshotId:body.snapshotId,status:summary.status,itemCount:items.length,batchCount:batches.length,completedBatches:summary.completed,failedBatches:summary.failed,batches:receipts,createdAt:resumed?.createdAt});
    const payload={mode:dryRun?"dry-run":"live",feedKind:INVENTORY_FEED_KIND,pushId,snapshotId:body.snapshotId,itemCount:items.length,batchCount:batches.length,zeroStockRows:items.filter((item)=>item.quantityOnHand===0).length,status:summary.status,dryRunAccepted:dryRun&&isInventoryDryRunAccepted(receipts),completedBatches:summary.completed,failedBatches:summary.failed,batches:publicBatches(receipts)};
    if(summary.status==="failed") return Response.json({...payload,error:"Wayfair 库存批次未全部成功，请检查批次错误后再处理"},{status:422});
    if(summary.status==="processing") return Response.json(payload,{status:202});
    return Response.json(payload);
  } catch(error){return Response.json({error:error instanceof Error?error.message:"库存推送失败"},{status:500});}
}
