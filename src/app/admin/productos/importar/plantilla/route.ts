import { NextResponse } from "next/server";
import { getCurrentEmployee } from "@/modules/auth/current-user";
import { ProductImportService } from "@/modules/products/import-service";

/** Plantilla de importación, con los encabezados y una fila de ejemplo. */
export async function GET() {
  const employee = await getCurrentEmployee();
  if (!employee || !["admin", "super_admin", "stock"].includes(employee.role)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  return new NextResponse(ProductImportService.template(), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="plantilla-productos.csv"',
      "Cache-Control": "no-store",
    },
  });
}
