export type StaffAuthRole =
  | "owner"
  | "manager"
  | "cashier"
  | "kitchen"
  | "waiter"
  | "reception"
  | "inventory"
  | "inventory_officer";

export const STAFF_PASSWORD_MIN_LENGTH = 8;
export const STAFF_PASSWORD_MAX_LENGTH = 128;

export function staffAuthRoleLabel(role: StaffAuthRole) {
  if (role === "kitchen") return "Chef";
  if (role === "inventory_officer") return "Inventory Officer";
  return role.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function usesWaiterPin(role: StaffAuthRole) {
  return role === "waiter";
}

export function staffAuthEmailRequired(role: StaffAuthRole) {
  return !usesWaiterPin(role);
}

export function validateStaffPassword(password: string) {
  if (password.length < STAFF_PASSWORD_MIN_LENGTH || password.length > STAFF_PASSWORD_MAX_LENGTH) {
    return "Create a stronger password.";
  }
  return null;
}

export function validateStaffPasswordConfirmation(password: string, confirmation: string) {
  const passwordError = validateStaffPassword(password);
  if (passwordError) return passwordError;
  if (password !== confirmation) return "Passwords do not match.";
  return null;
}

export function validateWaiterPin(pin: string) {
  return /^\d{4}$/.test(pin) ? null : "Enter a 4-digit PIN.";
}
