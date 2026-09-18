import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/infrastructure/database/supabase-server";
import { getCurrentEmployee } from "@/modules/auth/current-user";
import {
  SalesReportService,
  daysAgoInArgentina,
  todayInArgentina,
} from "@/modules/reports/sales-report-service";
import { formatDateTimeAR } from "@/shared/utils/argentina-time";
import { formatQuantity } from "@/shared/utils/quantity";
import { firstParam } from "@/shared/utils/search-params";

export const dynamic = "force-dynamic";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function money(n: number): string {
  return `$ ${n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Reportes de ventas y cierre de caja. Solo lectura: no toca ninguna
 * venta ni facturación (ver sales-report-service.ts).
 *
 * Roles: admin y super_admin. Son números de plata (totales, medios de
 * pago, márgenes de qué se vende), no información operativa.
 */
export default async function AdminReportesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const employee = await getCurrentEmployee();
  if (!employee || !["admin", "super_admin"].includes(employee.role)) {
    redirect("/admin");
  }

  const raw = await searchParams;
  const today = todayInArgentina();
  const fromParam = firstParam(raw.from);
  const toParam = firstParam(raw.to);
  const from = fromParam && DATE.test(fromParam) ? fromParam : today;
  const to = toParam && DATE.test(toParam) ? toParam : today;

  const report = await new SalesReportService(await createClient()).build({ from, to });

  const presets = [
    { label: "Hoy", from: today, to: today },
    { label: "Ayer", from: daysAgoInArgentina(1), to: daysAgoInArgentina(1) },
    { label: "Últimos 7 días", from: daysAgoInArgentina(6), to: today },
    { label: "Últimos 30 días", from: daysAgoInArgentina(29), to: today },
  ];

  const exportUrl = `/admin/reportes/exportar?from=${from}&to=${to}`;

  return (
    <div>
      <h1 className="mb-1 text-lg font-bold text-ink">Reportes de ventas</h1>
      <p className="mb-4 text-sm text-ink-muted">
        Hay dos cosas distintas en esta pantalla y conviene no mezclarlas:{" "}
        <span className="font-medium text-ink">lo que se vendió</span> (los números de acá arriba) y{" "}
        <span className="font-medium text-ink">la plata que entró</span> (el cierre de caja, más
        abajo). Una venta fiada cuenta como venta el día que se hizo, aunque el cliente pague
        después; y cuando paga, esa plata aparece en el cierre de caja, no como una venta nueva.
      </p>
      <p className="mb-4 text-sm text-ink-muted">
        No entran los pedidos esperando pago, los rechazados ni los cancelados.
      </p>

      <form method="get" action="/admin/reportes" className="neu-card mb-4 flex flex-wrap items-end gap-3 p-4">
        <label className="text-xs text-ink-muted">
          <span className="mb-1 block">Desde</span>
          <input type="date" name="from" defaultValue={from} className="neu-input !px-2 !py-1.5" />
        </label>
        <label className="text-xs text-ink-muted">
          <span className="mb-1 block">Hasta</span>
          <input type="date" name="to" defaultValue={to} className="neu-input !px-2 !py-1.5" />
        </label>
        <button className="neu-btn neu-btn-primary !px-4 !py-2 !text-xs">Ver</button>
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => (
            <Link
              key={p.label}
              href={`/admin/reportes?from=${p.from}&to=${p.to}`}
              className={`neu-chip !text-xs ${
                p.from === from && p.to === to ? "neu-chip-active font-semibold" : ""
              }`}
            >
              {p.label}
            </Link>
          ))}
        </div>
        <a href={exportUrl} className="neu-btn !px-3 !py-2 !text-xs">
          Exportar a Excel
        </a>
      </form>

      {/* Lo que se vendió. La plata que entró va en el cierre de caja:
          una venta fiada suma acá el día que se hizo, no cuando la pagan. */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Ventas" value={String(report.totals.orders)} />
        <Tile
          label="Total vendido"
          value={money(report.totals.gross)}
          hint="Incluye lo fiado, esté cobrado o no"
          strong
        />
        <Tile label="Ticket promedio" value={money(report.totals.averageTicket)} />
        <Tile label="IVA del período" value={money(report.totals.vat)} hint={`Neto: ${money(report.totals.net)}`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Block title="Cierre de caja — la plata que entró">
          {report.cashClose.orders === 0 ? (
            <Empty>No hubo ventas de mostrador en este período.</Empty>
          ) : (
            <>
              <Rows
                rows={report.cashClose.byMethod.map((m) => ({
                  label: m.label,
                  detail: `${m.orders} ${m.orders === 1 ? "venta" : "ventas"}`,
                  value: money(m.total),
                }))}
              />
              <div className="flex items-center justify-between border-t border-[color:var(--hairline)] pt-2 text-sm font-semibold text-ink">
                <span>Ventas cobradas en el mostrador</span>
                <span className="tabular-nums">{money(report.cashClose.total)}</span>
              </div>
              {/* Las cobranzas de deudas también son plata que entró: van
                  al total, pero separadas de las ventas del día. */}
              {report.cashClose.collections.total > 0 && (
                <div className="mt-3 border-t border-[color:var(--hairline)] pt-2">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-ink-subtle">
                    Cobranzas de cuenta corriente
                  </p>
                  <Rows
                    rows={report.cashClose.collections.byMethod.map((m) => ({
                      label: m.method.charAt(0).toUpperCase() + m.method.slice(1),
                      detail: `${m.count} ${m.count === 1 ? "cobro" : "cobros"}`,
                      value: money(m.amount),
                    }))}
                  />
                </div>
              )}

              <div className="mt-2 flex items-center justify-between border-t border-[color:var(--hairline)] pt-2 text-base font-bold text-brand">
                <span>Total que entró</span>
                <span className="tabular-nums">{money(report.cashClose.totalIn)}</span>
              </div>

              {report.cashClose.onCredit.total > 0 && (
                <p className="mt-2 text-xs text-warning">
                  Además se fiaron {money(report.cashClose.onCredit.total)} en{" "}
                  {report.cashClose.onCredit.orders}{" "}
                  {report.cashClose.onCredit.orders === 1 ? "venta" : "ventas"}: esa plata no está en
                  la caja, quedó en la cuenta del cliente.
                </p>
              )}
              {report.cashClose.firstSaleAt && (
                <p className="mt-2 text-xs text-ink-subtle">
                  Primera venta: {formatDateTimeAR(report.cashClose.firstSaleAt)} · Última:{" "}
                  {formatDateTimeAR(report.cashClose.lastSaleAt!)}
                </p>
              )}
            </>
          )}
        </Block>

        <Block title="Cómo pagaron">
          {report.paymentMethods.length === 0 ? (
            <Empty>Sin pagos registrados en este período.</Empty>
          ) : (
            <Rows
              rows={report.paymentMethods.map((m) => ({
                label: m.label,
                detail: `${m.orders} ${m.orders === 1 ? "pago" : "pagos"}`,
                value: money(m.total),
              }))}
            />
          )}
          <div className="mt-4 border-t border-[color:var(--hairline)] pt-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-subtle">
              Por canal
            </p>
            <Rows
              rows={report.channels.map((c) => ({
                label: c.label,
                detail: `${c.orders} ${c.orders === 1 ? "venta" : "ventas"}`,
                value: money(c.total),
              }))}
            />
          </div>
        </Block>

        <Block title="Cuenta corriente">
          <Rows
            rows={[
              {
                label: "Se fió en el período",
                detail: `${report.accounts.soldOnCreditSales} ${report.accounts.soldOnCreditSales === 1 ? "venta" : "ventas"}`,
                value: money(report.accounts.soldOnCredit),
              },
              {
                label: "Cobrado de cuentas",
                detail: `${report.accounts.collectedPayments} ${report.accounts.collectedPayments === 1 ? "pago" : "pagos"}`,
                value: money(report.accounts.collected),
              },
            ]}
          />
          <div className="mt-2 flex items-center justify-between border-t border-[color:var(--hairline)] pt-2 text-sm font-semibold text-ink">
            <span>Deuda total hoy</span>
            <span className="tabular-nums">{money(report.accounts.outstanding)}</span>
          </div>
          <p className="mt-2 text-xs text-ink-subtle">
            La deuda total no depende del filtro de fechas: es lo que los clientes deben ahora.{" "}
            <Link href="/admin/cuentas" className="text-brand hover:underline">
              Ver cuentas
            </Link>
          </p>
        </Block>

        <Block title="Margen estimado">
          {report.margin.productsWithCost === 0 ? (
            <Empty>
              Ningún producto vendido tiene el costo cargado. Completá &quot;Costo sin IVA&quot; en la
              ficha del producto y el margen aparece acá.
            </Empty>
          ) : (
            <>
              <Rows
                rows={[
                  { label: "Venta sin IVA", detail: "de los productos con costo cargado", value: money(report.margin.netRevenue) },
                  { label: "Costo", detail: "costo actual por las unidades vendidas", value: money(report.margin.cost) },
                ]}
              />
              <div className="mt-2 flex items-center justify-between border-t border-[color:var(--hairline)] pt-2 text-sm font-semibold text-ink">
                <span>Margen</span>
                <span className="tabular-nums">
                  {money(report.margin.margin)} · {report.margin.marginPct.toFixed(1)}%
                </span>
              </div>
              <p className="mt-2 text-xs text-ink-subtle">
                Calculado con el costo actual de cada producto, no con el del día de la venta.
                {report.margin.productsWithoutCost > 0 &&
                  ` Quedan afuera ${report.margin.productsWithoutCost} ${
                    report.margin.productsWithoutCost === 1 ? "producto" : "productos"
                  } sin costo cargado.`}
              </p>
            </>
          )}
        </Block>

        <Block title="Lo que más se vendió">
          {report.topProducts.length === 0 ? (
            <Empty>Sin ventas en este período.</Empty>
          ) : (
            <Rows
              rows={report.topProducts.slice(0, 10).map((p) => ({
                label: p.name,
                detail: `${formatQuantity(p.quantity)} ${p.quantity === 1 ? "unidad" : "unidades"}`,
                value: money(p.total),
              }))}
            />
          )}
        </Block>

        <Block title="Productos activos sin ventas">
          {report.idleProducts.length === 0 ? (
            <Empty>Todos los productos activos se vendieron al menos una vez.</Empty>
          ) : (
            <>
              <Rows
                rows={report.idleProducts.slice(0, 10).map((p) => ({
                  label: p.name,
                  detail: `SKU ${p.sku}`,
                  value: `${formatQuantity(p.stockAvailable)} disp.`,
                }))}
              />
              {report.idleProducts.length > 10 && (
                <p className="mt-2 text-xs text-ink-subtle">
                  Y {report.idleProducts.length - 10} más. Están todos en el archivo exportado.
                </p>
              )}
            </>
          )}
        </Block>
      </div>

      <div className="neu-card mt-6 p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-subtle">
          Facturas emitidas en el período
        </p>
        <p className="text-sm text-ink">
          <span className="font-semibold text-success">{report.invoices.authorized}</span> autorizadas ·{" "}
          <span className="font-semibold text-danger">{report.invoices.rejected}</span> rechazadas ·{" "}
          <span className="font-semibold text-ink-muted">{report.invoices.other}</span> en otro estado
        </p>
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
  strong,
}: {
  label: string;
  value: string;
  hint?: string;
  strong?: boolean;
}) {
  return (
    <div className="neu-card p-4">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className={`mt-1 tabular-nums ${strong ? "text-2xl font-bold text-brand" : "text-xl font-semibold text-ink"}`}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-ink-subtle tabular-nums">{hint}</p>}
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="neu-card p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-subtle">{title}</h2>
      {children}
    </section>
  );
}

function Rows({ rows }: { rows: { label: string; detail: string; value: string }[] }) {
  return (
    <ul className="space-y-2">
      {rows.map((row, i) => (
        <li key={i} className="flex items-start justify-between gap-3 text-sm">
          <span className="min-w-0">
            <span className="block text-ink">{row.label}</span>
            <span className="text-xs text-ink-muted">{row.detail}</span>
          </span>
          <span className="whitespace-nowrap tabular-nums text-ink">{row.value}</span>
        </li>
      ))}
    </ul>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-ink-subtle">{children}</p>;
}
