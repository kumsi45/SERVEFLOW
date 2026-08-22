import type { ManagerStaffRole } from "./managerStaffOperationsService";
import {
  staffAuthEmailRequired,
  staffAuthRoleLabel,
  usesWaiterPin,
  validateStaffPasswordConfirmation,
  validateWaiterPin,
} from "../../../../supabase/functions/_shared/staffAuthPolicy";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function managerStaffEmailRequired(role: ManagerStaffRole) {
  return staffAuthEmailRequired(role);
}

export function validateManagerStaffCreation(input: {
  fullName: string;
  email: string;
  password: string;
  confirmPassword: string;
  pin: string;
  role: ManagerStaffRole;
}) {
  const fullName = input.fullName.trim();
  const email = input.email.trim();

  if (fullName.length < 2) return "Enter the staff member's full name.";
  if (managerStaffEmailRequired(input.role) && !email) {
    return `Email is required for ${staffAuthRoleLabel(input.role)} accounts.`;
  }
  if (email && (!EMAIL_PATTERN.test(email) || email.length > 254)) {
    return "Enter a valid email address.";
  }
  if (usesWaiterPin(input.role)) return validateWaiterPin(input.pin);
  return validateStaffPasswordConfirmation(input.password, input.confirmPassword);
}
