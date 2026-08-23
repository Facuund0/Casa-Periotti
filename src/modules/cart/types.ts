export interface CartItem {
  productId: string;
  slug: string;
  name: string;
  unitPrice: number; // precio mostrado en el momento de agregar — SOLO informativo
  quantity: number;
}
