import { pathToFileURL } from "node:url";

function syncEndpoint(origin) {
  if (!origin) throw new Error("APP_ORIGIN is required");
  const url = new URL(origin);
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new Error("APP_ORIGIN must use HTTPS");
  }
  return new URL("/api/cron/sync", url.origin);
}

export async function runScheduledSync({
  origin = process.env.APP_ORIGIN,
  secret = process.env.CRON_SECRET,
  fetchImpl = fetch,
  timeoutMs = 14 * 60 * 1000,
} = {}) {
  if (!secret) throw new Error("CRON_SECRET is required");
  const response = await fetchImpl(syncEndpoint(origin), {
    method: "GET",
    headers: { authorization: `Bearer ${secret}` },
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  await response.arrayBuffer();
  if (!response.ok) {
    throw new Error(`Scheduled sync failed with HTTP ${response.status}`);
  }
  return { status: response.status };
}

async function main() {
  try {
    const result = await runScheduledSync();
    process.stdout.write(`scheduled sync completed (HTTP ${result.status})\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Scheduled sync failed"}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
