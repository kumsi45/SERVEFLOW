export type PublicQrCartItem = {
  menuItemId: string;
  name: string;
  price: number;
  quantity: number;
  notes?: string;
};

export type AddPublicQrCartItemInput = {
  menuItemId: string;
  name: string;
  price: number;
  quantity?: number;
  notes?: string;
};
