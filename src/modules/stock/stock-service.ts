import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ManualStockMovementType = "entrada_compra" | "ajuste" | "merma" | "devolucion";

export class InsufficientStockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsufficientStockError";
  }
}

/**
 * Ajustes de stock que origina un EMPLEADO desde el panel interno
 * (compra a proveedor, corrección de inventario, merma, devolución).
 *
 * El stock que se mueve durante el checkout web (reserva, confirmación
 * de venta, liberación) NO pasa por acá — vive en las funciones de
 * Postgres create_order / confirm_order_paid / release_order_reservation
 * (ver OrderService), porque ahí la reserva tiene que ir atada al mismo
 * bloqueo de fila que ya se usó para calcular el precio, dentro de la
 * misma transacción.
 */
export class StockService {
  constructor(private readonly adminDb: SupabaseClient) {}

  async manualAdjustment(params: {
    productId: string;
    quantityDelta: number;
    movementType: ManualStockMovementType;
    reason: string;
    employeeId: string;
  }) {
    const { data, error } = await this.adminDb.rpc("adjust_stock", {
      p_product_id: params.productId,
      p_quantity_delta: params.quantityDelta,
      p_reserved_delta: 0,
      p_movement_type: params.movementType,
      p_reference_type: "manual_adjustment",
      p_reference_id: null,
      p_reason: params.reason,
      p_created_by: params.employeeId,
    });

    if (error) {
      if (error.message?.includes("Stock insuficiente")) {
        throw new InsufficientStockError(error.message);
      }
      throw new Error(`Error al ajustar stock: ${error.message}`);
    }

    const row = Array.isArray(data) ? data[0] : data;
    return {
      newStockQuantity: row.new_stock_quantity as number,
      newStockReserved: row.new_stock_reserved as number,
    };
  }
}
