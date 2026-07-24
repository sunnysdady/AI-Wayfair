export type RuntimeBindings = Env & {
  RUNTIME_PLATFORM: "node";
};

export function getRuntimeBindings(
  options?: {
    processEnv?: Record<string, string | undefined>;
    createDatabase?: (env: Record<string, string | undefined>) => Promise<D1Database> | D1Database;
    createFiles?: (env: Record<string, string | undefined>) => Promise<R2Bucket> | R2Bucket;
  },
): Promise<RuntimeBindings>;
