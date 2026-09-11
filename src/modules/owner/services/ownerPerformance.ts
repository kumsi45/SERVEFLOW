export type OwnerCoreResource =
  | "orders"
  | "tableSessions"
  | "staff"
  | "menu"
  | "categories"
  | "restaurant"
  | "tables"
  | "shifts"
  | "payments"
  | "stations";

export type OwnerCoreResourceStatus = "loading" | "ready" | "error";

export type OwnerCoreWorkspace =
  | "overview"
  | "orders"
  | "qr"
  | "analytics"
  | "menu";

export const OWNER_CORE_RESOURCES: readonly OwnerCoreResource[] = [
  "orders",
  "tableSessions",
  "staff",
  "menu",
  "categories",
  "restaurant",
  "tables",
  "shifts",
  "payments",
  "stations",
] as const;

export const INITIAL_OWNER_CORE_STATUS: Record<
  OwnerCoreResource,
  OwnerCoreResourceStatus
> = Object.fromEntries(
  OWNER_CORE_RESOURCES.map((resource) => [resource, "loading"]),
) as Record<OwnerCoreResource, OwnerCoreResourceStatus>;

const WORKSPACE_REQUIREMENTS: Record<
  OwnerCoreWorkspace,
  readonly OwnerCoreResource[]
> = {
  overview: ["orders", "staff", "tables"],
  orders: ["orders"],
  qr: ["tables", "tableSessions"],
  analytics: [],
  menu: ["menu", "categories", "stations"],
};

export function isOwnerWorkspaceLoading(
  workspace: OwnerCoreWorkspace,
  status: Readonly<Record<OwnerCoreResource, OwnerCoreResourceStatus>>,
) {
  return WORKSPACE_REQUIREMENTS[workspace].some(
    (resource) => status[resource] === "loading",
  );
}

export function isOwnerWorkspaceAvailable(
  workspace: OwnerCoreWorkspace,
  status: Readonly<Record<OwnerCoreResource, OwnerCoreResourceStatus>>,
) {
  return WORKSPACE_REQUIREMENTS[workspace].every(
    (resource) => status[resource] === "ready",
  );
}

export function hasAuthoritativeOwnerConfig(
  configRestaurantId: string | null | undefined,
  restaurantId: string,
) {
  return Boolean(configRestaurantId && configRestaurantId === restaurantId);
}

export function startOwnerCoreLoads(
  loaders: Record<OwnerCoreResource, () => Promise<void>>,
  onFailure: (resource: OwnerCoreResource, cause: unknown) => void,
) {
  return OWNER_CORE_RESOURCES.map((resource) =>
    Promise.resolve()
      .then(loaders[resource])
      .catch((cause) => onFailure(resource, cause)),
  );
}
