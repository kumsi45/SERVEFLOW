export type StaffCreationRole =
  | "manager"
  | "cashier"
  | "kitchen"
  | "waiter"
  | "reception"
  | "inventory"
  | "inventory_officer";

export function staffCreationEmailRequired(role: StaffCreationRole) {
  return role !== "waiter";
}

export function initialKitchenStationId(
  actorRole: "owner" | "manager",
  targetRole: StaffCreationRole,
  requestedStationId: unknown,
) {
  if (targetRole !== "kitchen" || actorRole === "manager") return null;
  return typeof requestedStationId === "string" && requestedStationId.trim()
    ? requestedStationId.trim()
    : null;
}
