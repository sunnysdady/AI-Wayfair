export type RuntimeBindings = Env & {
  RUNTIME_PLATFORM: "cloudflare" | "vercel";
};

export function getRuntimeBindings(
  loadCloudflare?: () => Promise<{ env: Env }>,
): Promise<RuntimeBindings>;
