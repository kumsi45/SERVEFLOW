export type RecipeRole = "owner" | "manager" | "inventory_officer";

export function canReadRecipes(role: string): role is RecipeRole {
  return role === "owner" || role === "manager" || role === "inventory_officer";
}

export function canManageRecipes(role: string): role is "owner" | "manager" {
  return role === "owner" || role === "manager";
}
