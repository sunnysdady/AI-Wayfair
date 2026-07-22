import { loadSnapshotItems } from "@/lib/inventory";
import { getRuntimeBindings } from "@/lib/runtime-bindings.mjs";
import { assertLiveOperation } from "@/lib/operating-safety.mjs";

const MUTATION = `mutation saveInventory($inventory: [inventoryInput]!, $feedKind: inventoryFeedKind) { inventory { save(inventory: $inventory, feedKind: $feedKind) { id handle status submittedAt completedAt itemCount errorCount errors { key message } } } }`;

const bindings = getRuntimeBindings;

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
    const results=[];
    for(const inventory of batches){
      const response=await fetch("https://api.wayfair.com/v1/graphql",{method:"POST",headers:{authorization:`Bearer ${accessToken}`,"content-type":"application/json",accept:"application/json"},body:JSON.stringify({query:MUTATION,variables:{inventory,feedKind:"TRUE_UP"}})});
      const result=await response.json() as {errors?:{message:string}[];data?:unknown};
      if(!response.ok||result.errors?.length) throw new Error(result.errors?.map((item)=>item.message).join("；")||`库存API失败（HTTP ${response.status}）`);
      results.push(result.data);
    }
    return Response.json({mode:"live",snapshotId:body.snapshotId,itemCount:items.length,results});
  } catch(error){return Response.json({error:error instanceof Error?error.message:"库存推送失败"},{status:500});}
}
