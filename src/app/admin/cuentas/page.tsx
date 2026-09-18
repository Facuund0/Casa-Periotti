import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/infrastructure/database/supabase-admin";
import { getCurrentEmployee } from "@/modules/auth/current-user";
import { CustomerAccountService } from "@/modules/accounts/customer-account-service";
import { SmartSearch } from "@/app/_components/smart-search";
import { suggestCustomersAction } from "@/modules/search/suggest-actions";
import { formatDateTimeAR } from "@/shared/utils/argentina-time";
import { firstParam } from "@/shared/utils/search-params";
import { AdjustmentForm, CreditSettingsForm, RegisterPaymentForm } from "./account-forms";

export const dynamic = "force-dynamic";

/**
 * Cuentas corrientes: a quién se le fía, cuánto debe cada uno y qué fue
 * pagando. Solo mueve movimientos de cuenta: ninguna venta, ningún
 * stock, ninguna factura.
 *
 * La deuda aparece acá cuando una venta de mostrador se cobra con el
 * medio de pago "Cuenta corriente" (ver pos-service.ts).
 */

const KIND_LABEL: Record<string, string> = {
  venta: "Venta fiada",
  pago: "Pago recibido",
  ajuste: "Ajuste",
};

function money(n: number): string {
  return `$ ${n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default async function AdminCuentasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const employee = await getCurrentEmployee();
  if (!employee || !["admin", "super_admin", "ventas"].includes(employee.role)) {
    redirect("/admin");
  }
  const isAdmin = ["admin", "super_admin"].includes(employee.role);

  const q = firstParam((await searchParams).q)?.slice(0, 80);

  const adminDb = createAdminClient();
  const service = new CustomerAccountService(adminDb);

  const accounts = await service.listAccounts();
  const movements = await service.listRecentByCustomers(accounts.map((a) => a.customerId));

  // Búsqueda para habilitarle la cuenta a alguien que todavía no la tiene.
  // Dos ilike separados y con los comodines escapados, igual que en el
  // resto del panel: lo que se tipea nunca se arma dentro de un .or().
  const select = "id, full_name, email, credit_enabled, credit_limit";
  const pattern = q ? `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : "";
  const found = q
    ? await Promise.all([
        adminDb.from("customer_profiles").select(select).ilike("full_name", pattern).order("full_name").limit(10),
        adminDb.from("customer_profiles").select(select).ilike("email", pattern).order("full_name").limit(10),
      ]).then(([byName, byEmail]) => {
        const merged = new Map<string, NonNullable<typeof byName.data>[number]>();
        for (const c of [...(byName.data ?? []), ...(byEmail.data ?? [])]) merged.set(c.id, c);
        return [...merged.values()].slice(0, 10);
      })
    : null;

  const totalOwed = accounts.reduce((sum, a) => sum + Math.max(a.balance, 0), 0);
  const owing = accounts.filter((a) => a.balance > 0);

  return (
    <div className="space-y-8">
      <section>
        <h1 className="mb-1 text-lg font-bold text-ink">Cuentas corrientes</h1>
        <p className="mb-4 text-sm text-ink-muted">
          Lo que los clientes deben y lo que van pagando. Una venta entra acá cuando en el mostrador
          se elige el medio de pago <span className="font-medium">Cuenta corriente</span>: la
          mercadería sale y se factura igual, pero esa plata no entra a la caja.
        </p>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="neu-card p-4">
            <p className="text-xs text-ink-muted">Deuda total</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-brand">{money(totalOwed)}</p>
          </div>
          <div className="neu-card p-4">
            <p className="text-xs text-ink-muted">Clientes con deuda</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-ink">{owing.length}</p>
          </div>
          <div className="neu-card p-4">
            <p className="text-xs text-ink-muted">Cuentas habilitadas</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-ink">
              {accounts.filter((a) => a.creditEnabled).length}
            </p>
          </div>
        </div>
      </section>

      {isAdmin && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink">Habilitar un cliente</h2>
          <form
            method="get"
            action="/admin/cuentas"
            className="neu-card mb-3 flex flex-wrap items-end gap-2 p-4"
          >
            <label className="min-w-[220px] flex-1 text-xs text-ink-muted">
              <span className="mb-1 block">Buscar cliente</span>
              <SmartSearch
                id="cuentas-q"
                name="q"
                defaultValue={q ?? ""}
                placeholder="Nombre o email"
                suggest={suggestCustomersAction}
                submitOnSelect
                className="neu-input !py-1.5"
              />
            </label>
            <button className="neu-btn neu-btn-primary !px-4 !py-2 !text-xs">Buscar</button>
            {q && (
              <Link href="/admin/cuentas" className="px-1 py-2 text-xs text-ink-muted hover:underline">
                Limpiar
              </Link>
            )}
          </form>

          {found && found.length === 0 && (
            <p className="text-sm text-ink-subtle">Ningún cliente coincide con esa búsqueda.</p>
          )}
          {found && found.length > 0 && (
            <div className="neu-card">
              {found.map((c) => (
                <div key={c.id} className="neu-row flex flex-wrap items-center gap-4 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-ink">{c.full_name}</p>
                    <p className="text-xs text-ink-muted">{c.email}</p>
                  </div>
                  <div className="min-w-[240px]">
                    <CreditSettingsForm
                      customerId={c.id}
                      enabled={Boolean(c.credit_enabled)}
                      limit={c.credit_limit === null ? null : Number(c.credit_limit)}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink">Cuentas</h2>

        {accounts.length === 0 ? (
          <div className="neu-card p-6 text-center">
            <p className="text-sm text-ink">Todavía no hay ninguna cuenta corriente.</p>
            <p className="mt-1 text-xs text-ink-subtle">
              {isAdmin
                ? "Buscá un cliente arriba y habilitale el fiado."
                : "Un administrador tiene que habilitarle el fiado al cliente."}
            </p>
          </div>
        ) : (
          <div className="neu-card">
            {accounts.map((account) => {
              const overLimit =
                account.creditLimit !== null && account.balance > account.creditLimit;
              return (
                <div key={account.customerId} className="neu-row p-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink">{account.fullName}</p>
                      <p className="text-xs text-ink-muted">
                        {account.email}
                        {account.phone && (
                          <a href={`tel:${account.phone}`} className="ml-2 text-brand hover:underline">
                            {account.phone}
                          </a>
                        )}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {!account.creditEnabled && (
                          <span className="neu-badge bg-warning-soft text-warning">
                            Fiado deshabilitado
                          </span>
                        )}
                        {account.creditLimit !== null && (
                          <span className="neu-badge bg-surface-sunken text-ink-muted">
                            Límite {money(account.creditLimit)}
                          </span>
                        )}
                        {overLimit && (
                          <span className="neu-badge bg-danger-soft text-danger">
                            Pasó el límite
                          </span>
                        )}
                        {account.lastMovementAt && (
                          <span className="text-xs text-ink-subtle tabular-nums">
                            Último movimiento: {formatDateTimeAR(account.lastMovementAt)}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="text-right">
                      <p className="text-xs text-ink-muted">
                        {account.balance > 0 ? "Debe" : account.balance < 0 ? "A favor" : "Al día"}
                      </p>
                      <p
                        className={`text-xl font-bold tabular-nums ${
                          account.balance > 0 ? "text-brand" : "text-ink"
                        }`}
                      >
                        {money(Math.abs(account.balance))}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    <RegisterPaymentForm
                      customerId={account.customerId}
                      balance={account.balance}
                    />
                    {isAdmin && (
                      <CreditSettingsForm
                        customerId={account.customerId}
                        enabled={account.creditEnabled}
                        limit={account.creditLimit}
                      />
                    )}
                  </div>

                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs font-medium text-brand">
                      Ver los últimos movimientos
                    </summary>
                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full min-w-[420px] text-xs">
                        <thead className="text-ink-subtle">
                          <tr className="border-b border-[color:var(--hairline)]">
                            <th className="py-1.5 pr-2 text-left font-medium">Fecha</th>
                            <th className="px-2 py-1.5 text-left font-medium">Concepto</th>
                            <th className="px-2 py-1.5 text-right font-medium">Importe</th>
                            <th className="py-1.5 pl-2 text-left font-medium">Quién</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(movements.get(account.customerId) ?? []).map((m) => (
                            <tr
                              key={m.id}
                              className="border-b border-[color:var(--hairline)] last:border-0"
                            >
                              <td className="py-1.5 pr-2 tabular-nums text-ink-muted">
                                {formatDateTimeAR(m.createdAt)}
                              </td>
                              <td className="px-2 py-1.5 text-ink">
                                {KIND_LABEL[m.kind] ?? m.kind}
                                {m.method && ` · ${m.method}`}
                                {m.orderNumber && ` · pedido #${m.orderNumber}`}
                                {m.note && (
                                  <span className="block text-[11px] text-ink-subtle">{m.note}</span>
                                )}
                              </td>
                              <td
                                className={`px-2 py-1.5 text-right tabular-nums ${
                                  m.amount > 0 ? "text-ink" : "text-success"
                                }`}
                              >
                                {m.amount > 0 ? "+" : "−"}
                                {money(Math.abs(m.amount)).replace("$ ", "")}
                              </td>
                              <td className="py-1.5 pl-2 text-ink-muted">
                                {m.createdByName ?? "—"}
                              </td>
                            </tr>
                          ))}
                          {(movements.get(account.customerId) ?? []).length === 0 && (
                            <tr>
                              <td colSpan={4} className="py-2 text-ink-subtle">
                                Sin movimientos todavía.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    {isAdmin && (
                      <div className="mt-2">
                        <AdjustmentForm customerId={account.customerId} />
                      </div>
                    )}
                  </details>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
