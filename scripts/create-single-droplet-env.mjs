import { randomBytes } from "node:crypto";
import { chmod, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const HOSTNAME_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

export function validateSingleDropletDomain(domain) {
  if (typeof domain !== "string" || !HOSTNAME_PATTERN.test(domain)) {
    throw new Error("domain must be a hostname without scheme, path, port, or whitespace");
  }
  return domain.toLowerCase();
}

function defaultRandomSecret() {
  return randomBytes(48).toString("base64url");
}

export function buildSingleDropletEnv({
  domain,
  randomSecret = defaultRandomSecret,
}) {
  const hostname = validateSingleDropletDomain(domain);
  const postgresPassword = randomSecret();
  const minioPassword = randomSecret();
  const cronSecret = randomSecret();
  const accessPassword = randomSecret();
  const postgresUser = "wayfair";
  const postgresDatabase = "wayfair";
  const minioUser = "wayfair-minio";

  return [
    "DATABASE_POOL_MAX=5",
    `POSTGRES_DB=${postgresDatabase}`,
    `POSTGRES_USER=${postgresUser}`,
    `POSTGRES_PASSWORD=${postgresPassword}`,
    `DATABASE_URL=postgresql://${postgresUser}:${encodeURIComponent(postgresPassword)}@postgres:5432/${postgresDatabase}`,
    `APP_DOMAIN=${hostname}`,
    `APP_ORIGIN=https://${hostname}`,
    `CRON_SECRET=${cronSecret}`,
    "WAYFAIR_DEPLOYMENT_ENV=production",
    "APP_ACCESS_USER=operator",
    `APP_ACCESS_PASSWORD=${accessPassword}`,
    "ENABLE_SCHEDULER=false",
    "",
    "S3_BUCKET=wayfair-ai-ops-prod",
    "S3_REGION=us-east-1",
    "S3_ENDPOINT=http://minio:9000",
    "S3_FORCE_PATH_STYLE=true",
    `S3_ACCESS_KEY_ID=${minioUser}`,
    `S3_SECRET_ACCESS_KEY=${minioPassword}`,
    "S3_USE_DEFAULT_CREDENTIAL_CHAIN=false",
    `MINIO_ROOT_USER=${minioUser}`,
    `MINIO_ROOT_PASSWORD=${minioPassword}`,
    "",
    "MICROSOFT_TENANT_ID=organizations",
    "MICROSOFT_CLIENT_ID=",
    "MICROSOFT_CLIENT_SECRET=",
    "MICROSOFT_REFRESH_TOKEN=",
    "OUTLOOK_MAILBOX_USER=",
    "OUTLOOK_MANUAL_SYNC_LOOKBACK_DAYS=45",
    "",
    "WAYFAIR_OPS_CLIENT_ID=",
    "WAYFAIR_OPS_CLIENT_SECRET=",
    "WAYFAIR_AD_CLIENT_ID=",
    "WAYFAIR_AD_CLIENT_SECRET=",
    "WAYFAIR_CATALOG_CLIENT_ID=",
    "WAYFAIR_CATALOG_CLIENT_SECRET=",
    "WAYFAIR_CATALOG_SUPPLIER_ID=",
    "WAYFAIR_EXPECTED_SUPPLIER_IDS=",
    "ALLOW_WAYFAIR_AD_LIVE_CHANGES=false",
    "ALLOW_WAYFAIR_LIVE_PUSH=false",
    "OUTLOOK_INGEST_TOKEN=",
    "",
  ].join("\n");
}

export async function writeSingleDropletEnv({
  domain,
  output = ".env.production",
  force = false,
}) {
  const contents = buildSingleDropletEnv({ domain });
  await writeFile(output, contents, {
    encoding: "utf8",
    flag: force ? "w" : "wx",
    mode: 0o600,
  });
  await chmod(output, 0o600);
  return output;
}

function cliArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const domain = cliArgument("--domain");
  const output = cliArgument("--output") || ".env.production";
  if (!domain) throw new Error("--domain is required");
  await writeSingleDropletEnv({
    domain,
    output,
    force: process.argv.includes("--force"),
  });
  process.stdout.write(`Created ${output} with mode 600; secrets were not printed.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
