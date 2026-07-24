export type InventoryAccessRole = "owner" | "manager" | "inventory_officer";

export function canAccessInventory(role: string | null | undefined): role is InventoryAccessRole {
  return role === "owner" || role === "manager" || role === "inventory_officer";
}
