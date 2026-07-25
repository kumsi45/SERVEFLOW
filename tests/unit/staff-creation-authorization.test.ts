import { describe, expect, it } from "vitest";
import { canCreateStaffRole, type CreatableStaffRole } from "../../supabase/functions/manage-staff/authorization";

describe("staff creation authorization", () => {
  it.each(["manager", "inventory_officer", "cashier", "kitchen", "waiter"] as const)(
    "allows an owner to create %s",
    (role) => expect(canCreateStaffRole("owner", role)).toBe(true),
  );

  it.each(["inventory_officer", "cashier", "kitchen", "waiter"] as const)(
    "allows a manager to create %s",
    (role) => expect(canCreateStaffRole("manager", role)).toBe(true),
  );

  it.each(["manager", "reception", "inventory"] as CreatableStaffRole[])(
    "does not allow a manager to create %s",
    (role) => expect(canCreateStaffRole("manager", role)).toBe(false),
  );
});
