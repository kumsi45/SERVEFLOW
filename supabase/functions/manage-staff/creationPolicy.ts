import { staffAuthEmailRequired } from "../_shared/staffAuthPolicy.ts";

export type StaffCreationRole =
  | "manager"
  | "cashier"
  | "kitchen"
  | "waiter"
  | "reception"
  | "inventory"
  | "inventory_officer";

export function staffCreationEmailRequired(role: StaffCreationRole) {
  return staffAuthEmailRequired(role);
}

export function initialKitchenStationId(
  _actorRole: "owner" | "manager",
  _targetRole: StaffCreationRole,
  _requestedStationId: unknown,
) {
  // Account creation and station assignment are separate workflows.
  // New Chefs must remain explicitly unassigned.
  return null;
}
