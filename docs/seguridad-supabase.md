# Revisor de seguridad de Supabase: qué se resolvió y qué queda

Estado de los avisos del panel de Supabase (Advisors → Security).

## Resueltos

| Aviso | Cómo se resolvió |
|---|---|
| **Crítico** — `products_available_stock` con SECURITY DEFINER | Migración 0023: `security_invoker = on`. La vista mostraba a cualquier visitante anónimo todos los productos, incluidos los desactivados. La vista no la usa ninguna parte del código. |
| **Function Search Path Mutable** (9 funciones) | Migración 0023: `search_path = public, pg_temp` en todas las funciones de `public`, recorriéndolas con un bloque que se puede volver a correr. |
| **SECURITY DEFINER expuesta** — `handle_new_customer()`, `prevent_customer_type_self_change()` | Migración 0024: `revoke execute` a `public`, `anon` y `authenticated`. Son funciones de trigger; revocar no las afecta, porque el permiso se controla al crear el trigger. |
| **SECURITY DEFINER expuesta** — `has_employee_role(...)` | Migraciones 0024 y 0025: revocada a `PUBLIC` y a `anon`, con `grant` explícito a `authenticated` y `service_role`. La 0024 solo se la revocó a `anon` y seguía accesible: Postgres otorga EXECUTE a `PUBLIC` al crear la función, y `PUBLIC` incluye a `anon`. |

## Aceptado a conciencia: `is_employee()`

El revisor sigue marcando que `is_employee()` se puede llamar desde la
API. **No se revoca**, y el motivo es concreto: las policies de lectura
del catálogo público la llaman.

```sql
create policy "Productos activos son públicos" on products
  for select using (active = true or is_employee());
```

Una policy se evalúa con los permisos de quien consulta. Si `anon` pierde
`EXECUTE`, el catálogo deja de cargar con un error de permisos.

Dejarla expuesta no filtra nada: no toma parámetros y devuelve un
booleano sobre **quien llama** ("¿soy empleado?"). No revela datos de
otras personas ni permite escribir.

**Cómo se saca del todo, si alguna vez se quiere:** mover `is_employee()`
y `has_employee_role()` a un esquema no expuesto (por ejemplo
`app_private`) y reescribir las cerca de 35 policies que las usan. Es un
cambio grande sobre el control de acceso completo de la base: conviene
hacerlo con tiempo y probando tabla por tabla, no junto con otra cosa.

## Pendiente de configuración (no es SQL)

**Protección contra contraseñas filtradas.** Supabase puede rechazar
contraseñas que aparecen en filtraciones conocidas, consultando
HaveIBeenPwned. Se activa en el panel:

Authentication → **Sign In / Providers** → Email → **Prevent use of leaked
passwords**.

Afecta solo a los registros y cambios de contraseña nuevos: nadie pierde
la suya. Conviene activarlo.
