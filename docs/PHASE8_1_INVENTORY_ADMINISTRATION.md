# Phase 8.1 Inventory Administration

## Architecture

Phase 8.1 adds an isolated Inventory Administration module for restaurant owners and managers. It is administrative master data only.

Frontend entry:

- `/inventory/dashboard`
- `/inventory/items`
- `/inventory/categories`
- `/inventory/suppliers`
- `/inventory/storage-locations`
- `/inventory/units`

Module files:

- `src/modules/inventory/pages/InventoryDashboardPage.tsx`
- `src/modules/inventory/services/inventoryRepository.ts`
- `src/modules/inventory/services/inventoryAdminService.ts`
- `src/modules/inventory/services/inventoryValidation.ts`
- `src/modules/inventory/types.ts`
- `src/modules/inventory/styles/inventoryDashboard.css`

Database migration:

- `supabase/migrations/158_phase8_1_inventory_administration.sql`

The module does not use kitchen services, realtime subscriptions, reports, stock movements, recipes, purchasing, automatic deduction, or barcode scanning.

## CRUD Flow

The UI loads all inventory administration master data for the active restaurant through `loadInventoryAdminData`.

Repository layer:

- Reads and writes Supabase tables with `.eq("restaurant_id", restaurantId)` on all tenant-scoped operations.
- Uses insert/update only.
- Uses status updates for archive, restore, and soft delete.

Service layer:

- Runs validation before writes.
- Resolves unit display names for compatibility with the existing `inventory_items.unit` column.
- Supports duplicate item creation with a unique copy name.
- Supports bulk item archive, restore, and soft delete.

UI layer:

- Dashboard summary cards.
- Global instant search across item name, SKU, barcode, category, supplier, and storage.
- Item filters by category, supplier, storage, status, archived, recently added, and sort mode.
- Pagination and row selection.
- Forms for items, categories, suppliers, storage locations, and units.

## Permissions

Inventory Administration is available only to active `owner` and `manager` staff records for the selected restaurant.

Access is checked in:

- `RoleNamespaceRoute.tsx`, where `/inventory/...` resolves only through owner or manager memberships.
- `ProtectedInventoryRoute.tsx`, where the staff record must match the active restaurant and role.
- Database RLS through `public.inventory_admin_has_access(restaurant_id)`.

RLS grants select, insert, and update only. There is no permanent delete grant.

Tenant isolation is maintained by:

- Restaurant-scoped frontend queries.
- Restaurant-scoped RLS policies.
- Database triggers validating item references belong to the same restaurant.

## Validation Rules

Categories:

- Name is required.
- Duplicate category names are prevented inside the same restaurant.
- Sort order must be a whole number.
- Archive, restore, and soft delete are supported.

Suppliers:

- Name is required.
- Duplicate supplier names are prevented inside the same restaurant.
- Phone, address, contact person, and notes are stored for future purchasing compatibility.

Storage Locations:

- Name is required.
- Duplicate storage location names are prevented inside the same restaurant.
- Each restaurant manages its own locations.

Units:

- Name is required.
- Duplicate unit names are prevented inside the same restaurant.
- Soft deleting units already used by active inventory items is blocked by database trigger.

Items:

- Name is required.
- Category, unit, and storage location are required.
- Supplier is optional but must be valid when provided.
- References must belong to the same restaurant.
- Duplicate item names, SKU values, and barcode values are prevented inside the same restaurant.
- Minimum stock must be zero or greater.
- Maximum stock must be zero or greater and cannot be less than minimum stock.

## Testing Summary

Added `tests/unit/inventory-administration.test.ts`.

Coverage includes:

- CRUD schema contract.
- Owner/manager RLS contract.
- No permanent delete grant.
- Tenant-safe reference validation.
- Unit-in-use delete prevention.
- Route permission checks.
- Isolation from kitchen, realtime, and request workflows.
- Category, item, storage, and unit validation behavior.

Build verification:

- `npm run build`

## Known Extension Points

Later phases can add stock movement, purchasing, supplier orders, low-stock alerts, reports, barcode scanner support, recipe integration, food cost, or kitchen consumption from this master-data foundation.

Phase 8.1 intentionally stops before those workflows.
