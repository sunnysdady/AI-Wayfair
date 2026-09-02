import archiver from "archiver";
import { PassThrough, Readable } from "node:stream";
import { safeLabelDownloadFileName, selectDownloadableLabelRecords } from "@/lib/fulfillment-downloads.mjs";
import { labelFileNameForOrder, listFulfillmentRecordsBySourceKeys } from "@/lib/fulfillment-ledger.mjs";
import { sameOrigin } from "@/lib/http-origin.mjs";
import { getRuntimeBindings } from "@/lib/runtime-bindings.mjs";

const MAX_SELECTED_LABELS = 100;

function sourceKeys(value: unknown) {
  if (!Array.isArray(value)) throw new Error("请选择要下载的面单");
  const keys = [...new Set(value.map((item) => String(item || "").trim()).filter((item) => item.startsWith("wayfair:")))];
  if (!keys.length) throw new Error("请选择已归档面单");
  if (keys.length > MAX_SELECTED_LABELS) throw new Error(`一次最多下载 ${MAX_SELECTED_LABELS} 张面单`);
  return keys;
}

function labelHeaders(fileName: string, contentType = "application/pdf") {
  return {
    "cache-control": "private, no-store",
    "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    "content-type": contentType,
    "x-content-type-options": "nosniff",
  };
}

async function storedLabelRecords(env: Awaited<ReturnType<typeof getRuntimeBindings>>, keys: string[]) {
  return selectDownloadableLabelRecords(await listFulfillmentRecordsBySourceKeys(env.DB, keys), keys);
}

async function createLabelZip(env: Awaited<ReturnType<typeof getRuntimeBindings>>, records: Awaited<ReturnType<typeof storedLabelRecords>>) {
  const files = await Promise.all(records.map(async (record) => {
    const object = await env.FILES.get(record.labelObjectKey);
    if (!object) throw new Error("所选面单文件不存在，请重新同步后再试");
    return {
      content: await new Response(object.body).arrayBuffer(),
      fileName: safeLabelDownloadFileName(record.labelFileName, labelFileNameForOrder(record.orderNumber)),
    };
  }));

  const zip = archiver("zip", { zlib: { level: 9 } });
  const output = new PassThrough();
  zip.on("error", (error) => output.destroy(error));
  zip.pipe(output);
  for (const file of files) zip.append(file.content, { name: file.fileName });
  void zip.finalize().catch((error: Error) => output.destroy(error));
  return Readable.toWeb(output) as ReadableStream;
}

export async function GET(request: Request) {
  try {
    const key = new URL(request.url).searchParams.get("sourceKey") || "";
    const env = await getRuntimeBindings();
    const [record] = await storedLabelRecords(env, sourceKeys([key]));
    if (!record) return Response.json({ error: "面单尚未归档，暂不能下载" }, { status: 404 });
    const object = await env.FILES.get(record.labelObjectKey);
    if (!object) return Response.json({ error: "已归档面单文件不存在，请重新同步后再试" }, { status: 404 });
    return new Response(object.body, { headers: labelHeaders(safeLabelDownloadFileName(record.labelFileName, labelFileNameForOrder(record.orderNumber))) });
  } catch (error) {
    return Response.json({ error: "面单下载失败，请重新同步后再试" }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: "请求来源无效" }, { status: 403 });
    const body = await request.json();
    const env = await getRuntimeBindings();
    const records = await storedLabelRecords(env, sourceKeys(body?.sourceKeys));
    if (!records.length) return Response.json({ error: "所选面单尚未归档，暂不能下载" }, { status: 404 });

    return new Response(await createLabelZip(env, records), {
      headers: labelHeaders(`Wayfair面单_${records.length}张.zip`, "application/zip"),
    });
  } catch (error) {
    return Response.json({ error: "面单下载失败，请重新同步后再试" }, { status: 400 });
  }
}
