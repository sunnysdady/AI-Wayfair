interface WayfairEnvBindings {
  ASSETS: Fetcher;
  DB: D1Database;
  FILES: R2Bucket;
  WAYFAIR_AD_CLIENT_ID?: string;
  WAYFAIR_AD_CLIENT_SECRET?: string;
  WAYFAIR_OPS_CLIENT_ID?: string;
  WAYFAIR_OPS_CLIENT_SECRET?: string;
  WAYFAIR_CATALOG_CLIENT_ID?: string;
  WAYFAIR_CATALOG_CLIENT_SECRET?: string;
  WAYFAIR_CATALOG_SUPPLIER_ID?: string;
  ALLOW_WAYFAIR_AD_LIVE_CHANGES?: string;
  ALLOW_WAYFAIR_LIVE_PUSH?: string;
  OUTLOOK_INGEST_TOKEN?: string;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface Env extends WayfairEnvBindings {}

declare namespace Cloudflare {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Env extends WayfairEnvBindings {}
}
