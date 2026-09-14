import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { slugify } from "@/shared/utils/slugify";

const ROLES_QUE_PUEDEN_EDITAR_CATEGORIAS = ["admin", "super_admin", "stock"] as const;

export class UnauthorizedError extends Error {
  constructor(message = "Tu rol no tiene permiso para editar categorías") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class CategoryInUseError extends Error {
  constructor(productCount: number) {
    super(
      `Esta categoría tiene ${productCount} producto${
        productCount === 1 ? "" : "s"
      } asociado${productCount === 1 ? "" : "s"}, así que no se puede borrar. Si no la usás más, desactivala: deja de aparecer en la web pero los productos no quedan huérfanos.`
    );
    this.name = "CategoryInUseError";
  }
}

export class CategoryHasChildrenError extends Error {
  constructor() {
    super("Esta categoría tiene subcategorías. Borralas o movelas antes.");
    this.name = "CategoryHasChildrenError";
  }
}

export class DuplicateSlugError extends Error {
  constructor(slug: string) {
    super(`Ya existe una categoría con el slug "${slug}". Elegí otro.`);
    this.name = "DuplicateSlugError";
  }
}

export interface CategoryAdminRow {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  parentName: string | null;
  displayOrder: number;
  active: boolean;
  productCount: number;
}

export interface CategoryInput {
  name: string;
  /** Si viene vacío se genera del nombre. */
  slug?: string;
  parentId?: string | null;
  displayOrder?: number;
}

/**
 * Administración de categorías. Mismos roles que pueden editar
 * productos (admin, super_admin y stock).
 *
 * Una categoría con productos asociados NUNCA se borra: se desactiva.
 * Borrarla dejaría productos apuntando a una categoría inexistente —
 * la FK products.category_id no tiene ON DELETE, así que la base lo
 * rechazaría de todas formas, pero acá el error explica qué hacer en
 * lugar de mostrar una violación de clave ajena.
 */
export class CategoryAdminService {
  constructor(
    private readonly adminDb: SupabaseClient,
    private readonly employee: { id: string; role: string }
  ) {}

  private assertCanEdit() {
    if (!ROLES_QUE_PUEDEN_EDITAR_CATEGORIAS.includes(this.employee.role as never)) {
      throw new UnauthorizedError();
    }
  }

  async list(): Promise<CategoryAdminRow[]> {
    const { data: categories, error } = await this.adminDb
      .from("categories")
      .select("id, name, slug, parent_id, display_order, active")
      .order("display_order")
      .order("name");

    if (error) throw new Error(`No se pudieron leer las categorías: ${error.message}`);

    // Cuántos productos cuelgan de cada categoría. Se traen los
    // category_id de una sola consulta y se cuentan acá: PostgREST no
    // hace GROUP BY, y una consulta de conteo por categoría serían
    // tantas idas y vueltas como categorías haya.
    const { data: products, error: productsError } = await this.adminDb
      .from("products")
      .select("category_id");

    if (productsError) {
      throw new Error(`No se pudieron contar los productos: ${productsError.message}`);
    }

    const counts = new Map<string, number>();
    for (const row of (products ?? []) as { category_id: string | null }[]) {
      if (row.category_id) counts.set(row.category_id, (counts.get(row.category_id) ?? 0) + 1);
    }

    const rows = (categories ?? []) as CategoryRecord[];
    const nameById = new Map(rows.map((c) => [c.id, c.name]));

    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      parentId: c.parent_id,
      parentName: c.parent_id ? nameById.get(c.parent_id) ?? null : null,
      displayOrder: c.display_order,
      active: c.active,
      productCount: counts.get(c.id) ?? 0,
    }));
  }

  async create(input: CategoryInput): Promise<string> {
    this.assertCanEdit();

    const slug = await this.resolveSlug(input);
    await this.assertParentIsValid(null, input.parentId ?? null);

    const { data, error } = await this.adminDb
      .from("categories")
      .insert({
        name: input.name.trim(),
        slug,
        parent_id: input.parentId || null,
        display_order: input.displayOrder ?? 0,
      })
      .select("id")
      .single();

    if (error) {
      if (error.code === "23505") throw new DuplicateSlugError(slug);
      throw new Error(`No se pudo crear la categoría: ${error.message}`);
    }

    await this.audit("create_category", data.id, null, { ...input, slug });
    return data.id as string;
  }

  async update(categoryId: string, input: CategoryInput): Promise<void> {
    this.assertCanEdit();

    const before = await this.findById(categoryId);
    if (!before) throw new Error("La categoría no existe");

    const slug = await this.resolveSlug(input, categoryId);
    await this.assertParentIsValid(categoryId, input.parentId ?? null);

    const { error } = await this.adminDb
      .from("categories")
      .update({
        name: input.name.trim(),
        slug,
        parent_id: input.parentId || null,
        display_order: input.displayOrder ?? before.display_order,
      })
      .eq("id", categoryId);

    if (error) {
      if (error.code === "23505") throw new DuplicateSlugError(slug);
      throw new Error(`No se pudo actualizar la categoría: ${error.message}`);
    }

    await this.audit("update_category", categoryId, before, { ...input, slug });
  }

  /**
   * Desactivar es la forma correcta de sacar una categoría de
   * circulación: deja de aparecer en la web (listCategories filtra por
   * active) pero los productos que la usan siguen intactos.
   */
  async setActive(categoryId: string, active: boolean): Promise<void> {
    this.assertCanEdit();

    const { error } = await this.adminDb
      .from("categories")
      .update({ active })
      .eq("id", categoryId);

    if (error) throw new Error(`No se pudo actualizar la categoría: ${error.message}`);

    await this.audit(active ? "activate_category" : "deactivate_category", categoryId, null, {
      active,
    });
  }

  /** Borrado real, permitido solo si no tiene productos ni subcategorías. */
  async remove(categoryId: string): Promise<void> {
    this.assertCanEdit();

    const { count: productCount, error: countError } = await this.adminDb
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("category_id", categoryId);

    if (countError) {
      throw new Error(`No se pudieron contar los productos: ${countError.message}`);
    }
    if ((productCount ?? 0) > 0) throw new CategoryInUseError(productCount ?? 0);

    const { count: childCount, error: childError } = await this.adminDb
      .from("categories")
      .select("id", { count: "exact", head: true })
      .eq("parent_id", categoryId);

    if (childError) {
      throw new Error(`No se pudieron contar las subcategorías: ${childError.message}`);
    }
    if ((childCount ?? 0) > 0) throw new CategoryHasChildrenError();

    const before = await this.findById(categoryId);

    const { error } = await this.adminDb.from("categories").delete().eq("id", categoryId);
    if (error) throw new Error(`No se pudo borrar la categoría: ${error.message}`);

    await this.audit("delete_category", categoryId, before, null);
  }

  /**
   * El slug sale del nombre si no se cargó a mano. Se verifica que no
   * esté tomado antes de escribir para poder dar un mensaje claro; el
   * UNIQUE de la base sigue siendo la garantía real (dos empleados
   * podrían crear la misma categoría al mismo tiempo), y ese caso lo
   * captura el 23505 de quien llama.
   */
  private async resolveSlug(input: CategoryInput, excludeId?: string): Promise<string> {
    const slug = slugify(input.slug?.trim() || input.name);
    if (!slug) {
      throw new Error("El nombre no genera un slug válido. Cargá el slug a mano.");
    }

    let query = this.adminDb.from("categories").select("id").eq("slug", slug);
    if (excludeId) query = query.neq("id", excludeId);

    const { data: taken } = await query.maybeSingle();
    if (taken) throw new DuplicateSlugError(slug);

    return slug;
  }

  /**
   * Evita que una categoría quede como su propio padre o dentro de su
   * propia descendencia, que dejaría un ciclo en el árbol. Se camina
   * hacia arriba desde el padre elegido; el tope de vueltas es una
   * red de seguridad por si ya hubiera un ciclo cargado de antes.
   */
  private async assertParentIsValid(categoryId: string | null, parentId: string | null) {
    if (!parentId) return;
    if (categoryId && parentId === categoryId) {
      throw new Error("Una categoría no puede ser su propia categoría padre");
    }
    if (!categoryId) return;

    let current: string | null = parentId;
    for (let hops = 0; current && hops < 20; hops++) {
      const parent = await this.findById(current);
      if (!parent) return;
      if (parent.parent_id === categoryId) {
        throw new Error(
          "No se puede elegir esa categoría padre: es una subcategoría de la que estás editando"
        );
      }
      current = parent.parent_id;
    }
  }

  private async findById(categoryId: string): Promise<CategoryRecord | null> {
    const { data } = await this.adminDb
      .from("categories")
      .select("id, name, slug, parent_id, display_order, active")
      .eq("id", categoryId)
      .maybeSingle();
    return (data as CategoryRecord) ?? null;
  }

  private async audit(action: string, categoryId: string, before: unknown, after: unknown) {
    await this.adminDb.from("audit_logs").insert({
      user_id: this.employee.id,
      action,
      entity_type: "category",
      entity_id: categoryId,
      data_before: before,
      data_after: after,
    });
  }
}

interface CategoryRecord {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  display_order: number;
  active: boolean;
}
