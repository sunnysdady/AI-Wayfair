const unavailableD1 = new Proxy({}, {
  get() {
    return () => {
      throw new Error("D1 binding is unavailable on Vercel; this operation remains read-only until persistent storage is configured.");
    };
  },
});

const unavailableR2 = new Proxy({}, {
  get() {
    return async () => {
      throw new Error("R2 binding is unavailable on Vercel; report storage is disabled until persistent storage is configured.");
    };
  },
});

export async function getRuntimeBindings(loadCloudflare = () => import("cloudflare:workers")) {
  try {
    const cloudflare = await loadCloudflare();
    return { ...cloudflare.env, RUNTIME_PLATFORM: "cloudflare" };
  } catch {
    return {
      ...process.env,
      DB: unavailableD1,
      FILES: unavailableR2,
      RUNTIME_PLATFORM: "vercel",
    };
  }
}
