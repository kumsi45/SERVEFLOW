export const managerPageLoaders = {
  dashboard: () => import("./pages/ManagerDashboardPage"),
  tables: () => import("./pages/ManagerOperationsCenterPage"),
  kitchen: () => import("./pages/ManagerKitchenSupervisionPage"),
  staff: () => import("./pages/ManagerStaffOperationsPage"),
  customers: () => import("./pages/ManagerCustomerExperiencePage"),
  reports: () => import("./pages/ManagerOperationalReportsPage"),
  intelligence: () => import("./pages/ManagerRestaurantIntelligencePage"),
  recipes: () => import("./pages/ManagerRecipeWorkspacePage"),
  menu: () => import("./pages/ManagerMenuWorkspacePage"),
  inventory: () => import("./pages/ManagerInventoryWorkspacePage"),
} as const;

export function preloadManagerSection(section: string) {
  const key = section === "cashier" ? "tables" : section as keyof typeof managerPageLoaders;
  return managerPageLoaders[key]?.();
}
