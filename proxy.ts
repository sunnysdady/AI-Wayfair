import { NextRequest, NextResponse } from "next/server";

function unauthorized(status = 401) {
  return new NextResponse(
    status === 401 ? "Authentication required" : "Application access is not configured",
    {
      status,
      headers: status === 401
        ? { "WWW-Authenticate": 'Basic realm="Wayfair Ops", charset="UTF-8"' }
        : undefined,
    },
  );
}

export async function proxy(request: NextRequest) {
  if (
    request.nextUrl.pathname === "/api/cron/sync"
    || request.nextUrl.pathname === "/api/health"
  ) {
    return NextResponse.next();
  }
  const deployed = process.env.NODE_ENV === "production"
    || Boolean(process.env.VERCEL)
    || process.env.WAYFAIR_DEPLOYMENT_ENV === "production";
  if (!deployed) return NextResponse.next();

  const expectedUser = process.env.APP_ACCESS_USER;
  const expectedPassword = process.env.APP_ACCESS_PASSWORD;
  if (!expectedUser || !expectedPassword) return unauthorized(503);

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Basic ")) return unauthorized();
  try {
    const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    const user = decoded.slice(0, separator);
    const password = decoded.slice(separator + 1);
    if (separator < 0 || user !== expectedUser || password !== expectedPassword) {
      return unauthorized();
    }
  } catch {
    return unauthorized();
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
