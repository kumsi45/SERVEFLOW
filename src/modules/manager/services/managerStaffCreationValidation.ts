import type { ManagerStaffRole } from "./managerStaffOperationsService";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function creationRoleLabel(role: ManagerStaffRole) {
  if (role === "kitchen") return "Chef";
  if (role === "inventory_officer") return "Inventory Officer";
  return role.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function managerStaffEmailRequired(role: ManagerStaffRole) {
  return role !== "waiter";
}

export function validateManagerStaffCreation(input: {
  fullName: string;
  email: string;
  pin: string;
  role: ManagerStaffRole;
}) {
  const fullName = input.fullName.trim();
  const email = input.email.trim();

  if (fullName.length < 2) return "Enter the staff member's full name.";
  if (managerStaffEmailRequired(input.role) && !email) {
    return `${creationRoleLabel(input.role)} email is required.`;
  }
  if (email && (!EMAIL_PATTERN.test(email) || email.length > 254)) {
    return "Enter a valid email address.";
  }
  if (!/^\d{4}$/.test(input.pin)) return "PIN must be exactly 4 digits.";
  return null;
}
