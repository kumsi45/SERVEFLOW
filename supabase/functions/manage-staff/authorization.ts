export type StaffCreatorRole = "owner" | "manager";
export type CreatableStaffRole = "manager" | "cashier" | "kitchen" | "waiter" | "reception" | "inventory" | "inventory_officer";

const OWNER_CREATABLE_ROLES: readonly CreatableStaffRole[] = [
  "manager", "inventory_officer", "cashier", "kitchen", "waiter", "reception", "inventory",
];
const MANAGER_CREATABLE_ROLES: readonly CreatableStaffRole[] = [
  "inventory_officer", "cashier", "kitchen", "waiter",
];

export function canCreateStaffRole(actorRole: StaffCreatorRole, targetRole: CreatableStaffRole) {
  return (actorRole === "owner" ? OWNER_CREATABLE_ROLES : MANAGER_CREATABLE_ROLES).includes(targetRole);
}
