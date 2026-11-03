/** Linha de material (filamento ou componente) da ficha simplificada de item pontual e de orçamento. */
export interface MaterialRow {
  uid: string;
  itemId: number | null;
  qty: string | null;
}

export const emptyMaterialRow = (): MaterialRow => ({ uid: crypto.randomUUID(), itemId: null, qty: null });
