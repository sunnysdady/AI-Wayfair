import { NextResponse } from "next/server";
import { proxySitesApi } from "./lib/sites-api-proxy.mjs";

export async function proxy(request: Request) {
  if (!process.env.VERCEL) return NextResponse.next();
  return proxySitesApi(request);
}

export const config = {
  matcher: "/api/:path*",
};
