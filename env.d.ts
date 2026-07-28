interface D1Result<T = Record<string, unknown>> {
  success: boolean;
  results: T[];
  meta?: Record<string, unknown>;
}

interface D1PreparedStatement {
  readonly sql?: string;
  readonly values?: unknown[];
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

interface R2ObjectBody {
  body: ReadableStream<Uint8Array> | null;
  httpMetadata?: { contentType?: string };
}

interface R2Bucket {
  put(key: string, value: unknown, options?: { httpMetadata?: { contentType?: string } }): Promise<void>;
  get(key: string): Promise<R2ObjectBody | null>;
  delete(key: string): Promise<void>;
}

interface WayfairEnvBindings {
  DB: D1Database;
  FILES: R2Bucket;
  DATABASE_URL?: string;
  DATABASE_POOL_MAX?: string;
  APP_ORIGIN?: string;
  CRON_SECRET?: string;
  APP_ACCESS_USER?: string;
  APP_ACCESS_PASSWORD?: string;
  CATALOG_SYNC_PAGE_BUDGET?: string;
  CATALOG_SYNC_PAGE_DELAY_MS?: string;
  S3_BUCKET?: string;
  S3_REGION?: string;
  S3_ENDPOINT?: string;
  S3_FORCE_PATH_STYLE?: string;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
  S3_USE_DEFAULT_CREDENTIAL_CHAIN?: string;
  MICROSOFT_TENANT_ID?: string;
  MICROSOFT_CLIENT_ID?: string;
  MICROSOFT_CLIENT_SECRET?: string;
  MICROSOFT_REFRESH_TOKEN?: string;
  OUTLOOK_MAILBOX_USER?: string;
  WAYFAIR_AD_CLIENT_ID?: string;
  WAYFAIR_AD_CLIENT_SECRET?: string;
  WAYFAIR_OPS_CLIENT_ID?: string;
  WAYFAIR_OPS_CLIENT_SECRET?: string;
  WAYFAIR_CATALOG_CLIENT_ID?: string;
  WAYFAIR_CATALOG_CLIENT_SECRET?: string;
  WAYFAIR_CATALOG_SUPPLIER_ID?: string;
  WAYFAIR_DEPLOYMENT_ENV?: string;
  WAYFAIR_EXPECTED_SUPPLIER_IDS?: string;
  ALLOW_WAYFAIR_AD_LIVE_CHANGES?: string;
  ALLOW_WAYFAIR_LIVE_PUSH?: string;
  OUTLOOK_INGEST_TOKEN?: string;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface Env extends WayfairEnvBindings {}
