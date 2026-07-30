import {
  PRODUCT_OPERATING_AUDIT,
  validateProductOperatingAudit,
} from "@/lib/product-operating-audit.mjs";

export const dynamic = "force-static";

export async function GET() {
  const audit = validateProductOperatingAudit(PRODUCT_OPERATING_AUDIT);
  return Response.json(audit, {
    headers: {
      "Cache-Control": "private, max-age=300",
      "X-Product-Audit-Version": audit.version,
    },
  });
}
