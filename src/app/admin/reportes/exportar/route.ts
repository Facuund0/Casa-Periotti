import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/infrastructure/database/supabase-server";
import { getCurrentEmployee } from "@/modules/auth/current-user";
import { SalesReportService, todayInArgentina } from "@/modules/reports/sales-report-service";

/**
 * El mismo reporte en CSV, para abrirlo en Excel. Solo lectura, y con el
 * mismo permiso que la pantalla: admin y super_admin.
 *
 * Separador ";" y BOM al principio: así Excel en español lo abre en
 * columnas sin pedir nada, y no rompe los acentos.
 */
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function cell(value: string | number): string {
  const text = String(value);
  return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function amount(n: number): string {
  // Coma decimal, como espera Excel en español.
  return n.toFixed(2).replace(".", ",");
}

export async function GET(request: NextRequest) {
  const employee = await getCurrentEmployee();
  if (!employee || !["admin", "super_admin"].includes(employee.role)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const today = todayInArgentina();
  const fromParam = request.nextUrl.searchParams.get("from");
  const toParam = request.nextUrl.searchParams.get("to");
  const from = fromParam && DATE.test(fromParam) ? fromParam : today;
  const to = toParam && DATE.test(toParam) ? toParam : today;

  const report = await new SalesReportService(await createClient()).build({ from, to });

  const lines: string[] = [];
  const row = (...cells: (string | number)[]) => lines.push(cells.map(cell).join(";"));

  row("Reporte de ventas", `${from} a ${to}`);
  row("");
  row("Resumen");
  row("Ventas cobradas", report.totals.orders);
  row("Total cobrado", amount(report.totals.gross));
  row("Neto sin IVA", amount(report.totals.net));
  row("IVA", amount(report.totals.vat));
  row("Ticket promedio", amount(report.totals.averageTicket));
  row("");
  row("Cierre de caja (mostrador)");
  row("Medio de pago", "Ventas", "Total");
  for (const m of report.cashClose.byMethod) row(m.label, m.orders, amount(m.total));
  row("Ventas cobradas en el mostrador", report.cashClose.orders, amount(report.cashClose.total));
  row("Fiado en el mostrador (no entró)", report.cashClose.onCredit.orders, amount(report.cashClose.onCredit.total));
  row("");
  row("Cobranzas de cuenta corriente");
  row("Medio de pago", "Cobros", "Total");
  for (const m of report.cashClose.collections.byMethod) row(m.method, m.count, amount(m.amount));
  row("Total cobranzas", "", amount(report.cashClose.collections.total));
  row("");
  row("TOTAL QUE ENTRÓ (ventas + cobranzas)", "", amount(report.cashClose.totalIn));
  row("");
  row("Cuenta corriente");
  row("Se fió en el período", report.accounts.soldOnCreditSales, amount(report.accounts.soldOnCredit));
  row("Cobrado de cuentas", report.accounts.collectedPayments, amount(report.accounts.collected));
  row("Deuda total hoy (no depende del filtro)", "", amount(report.accounts.outstanding));
  row("");
  row("Medios de pago (todos los canales)");
  row("Medio de pago", "Pagos", "Total");
  for (const m of report.paymentMethods) row(m.label, m.orders, amount(m.total));
  row("");
  row("Por canal");
  row("Canal", "Ventas", "Total");
  for (const c of report.channels) row(c.label, c.orders, amount(c.total));
  row("");
  row("Margen estimado (con el costo actual de cada producto)");
  row("Venta sin IVA (productos con costo)", amount(report.margin.netRevenue));
  row("Costo", amount(report.margin.cost));
  row("Margen", amount(report.margin.margin));
  row("Margen %", amount(report.margin.marginPct));
  row("Productos con costo cargado", report.margin.productsWithCost);
  row("Productos sin costo cargado", report.margin.productsWithoutCost);
  row("");
  row("Productos vendidos");
  row("Producto", "Cantidad", "Total");
  for (const p of report.topProducts) row(p.name, p.quantity, amount(p.total));
  row("");
  row("Productos activos sin ventas en el período");
  row("Producto", "SKU", "Stock disponible");
  for (const p of report.idleProducts) row(p.name, p.sku, p.stockAvailable);
  row("");
  row("Facturas emitidas en el período");
  row("Autorizadas", report.invoices.authorized);
  row("Rechazadas", report.invoices.rejected);
  row("Otros estados", report.invoices.other);

  return new NextResponse(`﻿${lines.join("\r\n")}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ventas-${from}-a-${to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
