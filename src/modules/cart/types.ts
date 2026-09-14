export interface CartItem {
  productId: string;
  slug: string;
  name: string;
  unitPrice: number; // precio mostrado en el momento de agregar — SOLO informativo
  quantity: number;
  /**
   * Imagen principal, solo para mostrarla en el carrito. Opcional
   * porque los carritos que ya estaban guardados en el navegador antes
   * de que existieran las imágenes no la tienen: en ese caso se
   * muestra el recuadro gris.
   */
  imagePath?: string | null;
}
