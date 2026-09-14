import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { OrderService } from "@/modules/orders/order-service";
import { OrderFulfillmentService } from "@/modules/orders/order-fulfillment-service";
import {
  RECEIPT_BUCKET,
  getTransferWindowMinutes,
  validateReceiptFile,
} from "./transfer-config";

export class OrderNotPayableError extends Error {
  constructor(status: string) {
    super(`Este pedido no se puede pagar (estado actual: ${status})`);
    this.name = "OrderNotPayableError";
  }
}

export class TransferWindowExpiredError extends Error {
  constructor() {
    super(
      "Se venció el plazo para pagar este pedido y la reserva de stock ya se liberó. Armá el pedido de nuevo para volver a intentarlo."
    );
    this.name = "TransferWindowExpiredError";
  }
}

export class ReceiptAlreadyUploadedError extends Error {
  constructor() {
    super("Ya subiste un comprobante para este pedido. Un empleado lo está verificando.");
    this.name = "ReceiptAlreadyUploadedError";
  }
}

export class InvalidReceiptFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidReceiptFileError";
  }
}

/**
 * Pago por transferencia bancaria. Reemplaza a Mercado Pago, pero NO
 * reemplaza nada de lo que venía después de un pago aprobado: cuando un
 * empleado confirma la transferencia, se dispara exactamente el mismo
 * camino que disparaba un pago aprobado de MP —
 * OrderService.confirmPaid() (descuento real de stock) y
 * OrderFulfillmentService.fulfillPaidOrder() (factura ARCA + emails).
 * Esa lógica no se duplica acá ni se modifica.
 *
 * El pago se registra en la MISMA tabla `payments` que usaban MP y el
 * POS, con provider='transferencia'.
 */
export class TransferPaymentService {
  private readonly orderService: OrderService;

  constructor(private readonly adminDb: SupabaseClient) {
    this.orderService = new OrderService(adminDb);
  }

  /**
   * Sube el comprobante que mandó el cliente y deja el pedido
   * "esperando confirmación de pago" (payment_processing). El stock
   * sigue reservado — recién se descuenta cuando un empleado confirma.
   *
   * Valida, en este orden: que el pedido sea del cliente que sube, que
   * esté en un estado donde todavía se pueda pagar, que no se haya
   * vencido el plazo, que no haya ya un comprobante en revisión, y que
   * el archivo sea del tipo y tamaño permitidos. La validación del
   * archivo se repite acá aunque el navegador ya la haya hecho: la del
   * navegador es una comodidad para el cliente, no una garantía.
   */
  async registerReceipt(params: {
    orderId: string;
    customerId: string;
    file: File;
  }): Promise<{ receiptId: string }> {
    const { data: order, error: orderError } = await this.adminDb
      .from("orders")
      .select("id, order_number, status, total, customer_id, created_at")
      .eq("id", params.orderId)
      .maybeSingle();

    if (orderError) {
      throw new Error(`No se pudo leer el pedido: ${orderError.message}`);
    }
    if (!order || order.customer_id !== params.customerId) {
      // Mismo mensaje que un pedido inexistente a propósito: no se le
      // confirma a nadie que un pedido ajeno existe.
      throw new Error("Pedido no encontrado");
    }

    if (order.status !== "pending_payment") {
      throw new OrderNotPayableError(order.status);
    }

    if (this.isExpired(order.created_at)) {
      throw new TransferWindowExpiredError();
    }

    const { data: existingReceipt } = await this.adminDb
      .from("payment_receipts")
      .select("id")
      .eq("order_id", order.id)
      .eq("review_status", "pending")
      .maybeSingle();
    if (existingReceipt) {
      throw new ReceiptAlreadyUploadedError();
    }

    const fileError = validateReceiptFile({ type: params.file.type, size: params.file.size });
    if (fileError) {
      throw new InvalidReceiptFileError(fileError);
    }

    // El pago se registra recién acá, cuando hay un comprobante que
    // verificar. Antes de eso no hay nada que registrar: el pedido está
    // esperando que el cliente transfiera, y el código de referencia se
    // deriva del número de pedido (no de esta fila).
    const { data: payment, error: paymentError } = await this.adminDb
      .from("payments")
      .insert({
        order_id: order.id,
        provider: "transferencia",
        status: "pending",
        amount: order.total,
        // El índice único idx_payments_one_active_per_order (migración
        // 0007) ya impide dos pagos vivos para el mismo pedido, así que
        // esta clave solo necesita ser única, no determinística.
        idempotency_key: `transferencia-${randomUUID()}`,
      })
      .select("id")
      .single();

    if (paymentError) {
      if (paymentError.code === "23505") {
        throw new ReceiptAlreadyUploadedError();
      }
      throw new Error(`No se pudo registrar el pago: ${paymentError.message}`);
    }

    const storagePath = `${order.id}/${randomUUID()}${extensionFor(params.file)}`;

    const { error: uploadError } = await this.adminDb.storage
      .from(RECEIPT_BUCKET)
      .upload(storagePath, params.file, {
        contentType: params.file.type,
        upsert: false,
      });

    if (uploadError) {
      // El archivo no llegó a Storage: se deja el pago como rechazado
      // con el motivo, en vez de dejarlo "pending" para siempre
      // bloqueando (por el índice único) cualquier reintento del cliente.
      await this.adminDb
        .from("payments")
        .update({ status: "rejected", status_detail: `upload_error: ${uploadError.message}` })
        .eq("id", payment.id);
      throw new Error(`No se pudo guardar el comprobante: ${uploadError.message}`);
    }

    const { data: receipt, error: receiptError } = await this.adminDb
      .from("payment_receipts")
      .insert({
        order_id: order.id,
        payment_id: payment.id,
        storage_path: storagePath,
        file_mime: params.file.type,
        file_size: params.file.size,
        uploaded_by: params.customerId,
      })
      .select("id")
      .single();

    if (receiptError) {
      throw new Error(`No se pudo registrar el comprobante: ${receiptError.message}`);
    }

    // Recién ahora el pedido pasa a "esperando confirmación de pago":
    // hay un comprobante real para verificar. markProcessing() es el
    // mismo método que usaba el pago con tarjeta, sin cambios.
    await this.orderService.markProcessing(order.id);

    return { receiptId: receipt.id };
  }

  /**
   * Un empleado verificó la transferencia en el homebanking y la
   * confirma. Dispara el MISMO camino que un pago aprobado de Mercado
   * Pago: confirmPaid() descuenta el stock de verdad y
   * fulfillPaidOrder() factura con ARCA y manda los emails.
   */
  async confirmTransfer(params: {
    orderId: string;
    employeeId: string;
  }): Promise<{ alreadyPaid: boolean }> {
    const { data: order } = await this.adminDb
      .from("orders")
      .select("id, status")
      .eq("id", params.orderId)
      .maybeSingle();

    if (!order) throw new Error("Pedido no encontrado");

    // Idempotencia: si dos empleados confirman el mismo pedido casi al
    // mismo tiempo, el segundo no vuelve a facturar ni a descontar
    // stock (confirm_order_paid ya es idempotente del lado de la base,
    // pero fulfillPaidOrder no tiene por qué correr dos veces).
    if (order.status === "paid") {
      return { alreadyPaid: true };
    }

    if (order.status !== "payment_processing") {
      throw new OrderNotPayableError(order.status);
    }

    const payment = await this.findLivePayment(params.orderId);

    await this.adminDb
      .from("payments")
      .update({ status: "approved", status_detail: "transferencia_verificada" })
      .eq("id", payment.id);

    await this.adminDb
      .from("payment_receipts")
      .update({
        review_status: "approved",
        reviewed_by: params.employeeId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("payment_id", payment.id);

    // Mismo RPC que usaban el webhook de MP y el POS: descuenta stock
    // real y pasa el pedido a 'paid'. Idempotente.
    await this.orderService.confirmPaid(params.orderId);

    await this.adminDb.from("audit_logs").insert({
      user_id: params.employeeId,
      action: "confirm_transfer_payment",
      entity_type: "order",
      entity_id: params.orderId,
      data_after: { payment_id: payment.id },
    });

    // Facturación ARCA + emails. Igual que en el flujo de MP y el POS,
    // fulfillPaidOrder() nunca revierte la venta si algo de esto falla:
    // el cliente ya pagó y el stock ya se descontó.
    await new OrderFulfillmentService(this.adminDb).fulfillPaidOrder(params.orderId);

    return { alreadyPaid: false };
  }

  /**
   * El empleado no encontró la transferencia (o el comprobante no
   * corresponde): se rechaza y se libera la reserva de stock, igual que
   * hacía un pago rechazado de Mercado Pago.
   */
  async rejectTransfer(params: {
    orderId: string;
    employeeId: string;
    reason: string;
  }): Promise<void> {
    const { data: order } = await this.adminDb
      .from("orders")
      .select("id, status")
      .eq("id", params.orderId)
      .maybeSingle();

    if (!order) throw new Error("Pedido no encontrado");
    if (order.status === "paid") {
      throw new Error("Este pedido ya está pagado — no se puede rechazar el comprobante.");
    }
    if (order.status !== "payment_processing") {
      throw new OrderNotPayableError(order.status);
    }

    const payment = await this.findLivePayment(params.orderId);

    await this.adminDb
      .from("payments")
      .update({ status: "rejected", status_detail: "transferencia_rechazada" })
      .eq("id", payment.id);

    await this.adminDb
      .from("payment_receipts")
      .update({
        review_status: "rejected",
        reviewed_by: params.employeeId,
        reviewed_at: new Date().toISOString(),
        rejection_reason: params.reason,
      })
      .eq("payment_id", payment.id);

    // Mismo RPC de siempre: libera la reserva sin vender.
    await this.orderService.releaseReservation(params.orderId, "payment_failed");

    await this.adminDb.from("audit_logs").insert({
      user_id: params.employeeId,
      action: "reject_transfer_payment",
      entity_type: "order",
      entity_id: params.orderId,
      data_after: { payment_id: payment.id, reason: params.reason },
    });
  }

  /**
   * URL firmada y de vida corta para que un empleado pueda abrir el
   * comprobante desde el panel. El bucket es privado: nunca se expone
   * una URL pública del archivo.
   */
  async getSignedReceiptUrl(storagePath: string, expiresInSeconds = 300): Promise<string | null> {
    const { data, error } = await this.adminDb.storage
      .from(RECEIPT_BUCKET)
      .createSignedUrl(storagePath, expiresInSeconds);

    if (error) {
      console.error(`[TransferPaymentService] No se pudo firmar la URL de ${storagePath}:`, error);
      return null;
    }
    return data?.signedUrl ?? null;
  }

  /**
   * El pago vivo (no rechazado ni cancelado) de un pedido. Es el que
   * tiene el comprobante en revisión.
   */
  private async findLivePayment(orderId: string): Promise<{ id: string }> {
    const { data: payment } = await this.adminDb
      .from("payments")
      .select("id")
      .eq("order_id", orderId)
      .in("status", ["pending", "processing"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!payment) {
      throw new Error(
        `El pedido ${orderId} está esperando confirmación de pago pero no tiene un pago registrado — revisar a mano antes de continuar.`
      );
    }
    return payment;
  }

  private isExpired(orderCreatedAt: string): boolean {
    return Date.now() > transferDeadline(orderCreatedAt).getTime();
  }
}

/**
 * Momento exacto en que vence el plazo para pagar. Se calcula sobre
 * created_at del pedido (cuando el cliente vio el reloj por primera
 * vez), con la ventana que devuelve getTransferWindowMinutes() — la
 * misma que usa el cron, para que el reloj del cliente y el cancelado
 * del servidor nunca digan cosas distintas.
 */
export function transferDeadline(orderCreatedAt: string): Date {
  return new Date(new Date(orderCreatedAt).getTime() + getTransferWindowMinutes() * 60 * 1000);
}

/**
 * ¿Ya venció el plazo de pago de este pedido? Vive acá y no en la
 * página del panel para no hacer cuentas con la hora actual dentro del
 * render de un componente (además de que la política de vencimiento es
 * de este módulo, no de la vista).
 */
export function isTransferExpired(orderCreatedAt: string): boolean {
  return Date.now() > transferDeadline(orderCreatedAt).getTime();
}

function extensionFor(file: File): string {
  if (file.type === "application/pdf") return ".pdf";
  if (file.type === "image/png") return ".png";
  if (file.type === "image/webp") return ".webp";
  if (file.type === "image/heic") return ".heic";
  return ".jpg";
}
