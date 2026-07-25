# Phase 8.3.1 — Recipe Management Foundation

## Scope

This phase provides standalone recipe master-data management only. Recipes have
no ingredient rows and no connection to Inventory, Menu, Kitchen, Ordering,
Purchasing, Reports, or stock deduction.

## Architecture

- `recipe_categories` stores custom, restaurant-scoped categories.
- `recipes` stores recipe identity, preparation metadata, yield, lifecycle, and
  audit ownership.
- `recipe_code_counters` atomically generates a separate code sequence for each
  restaurant (`REC-000001`, `REC-000002`, …).
- `manage_recipe` is the mutation boundary for create, update, duplicate,
  archive, restore, and soft delete.
- `list_recipes` is the read boundary for search, filters, sorting, and
  server-side pagination.
- The React Recipe module is independent of every operational module.

## Recipe lifecycle

Recipes start as Draft unless explicitly created Active. Active is the only
status eligible for a future Menu phase, but this phase performs no Menu
integration. Archive changes status to Archived. Restore returns an archived or
soft-deleted recipe to Draft. Soft delete sets `deleted_at`; physical deletion is
not exposed and normal lists exclude deleted rows.

Duplicate copies descriptive, category, preparation, and yield fields into a new
Draft recipe with a new immutable recipe code.

## Search, filters, and pagination

Search matches recipe name, recipe code, category name, or status. Filters cover
category, lifecycle status, and preparation bands (up to 15, 16–45, and over 45
minutes). Results sort Newest or Oldest and paginate at the database boundary.
The default page size is 12 and the API accepts 1–100.

## Permissions

| Role | Read | Create/Edit/Lifecycle |
|---|---:|---:|
| Owner | Yes | Yes |
| Manager | Yes | Yes |
| Inventory Officer | Yes | No |
| Kitchen, Cashier, Waiter, Customer | No | No |

RLS and SECURITY DEFINER functions both enforce the same role matrix. Every
query, category reference, code counter, and mutation is scoped by
`restaurant_id`. Cross-restaurant category assignment is blocked by a composite
foreign key.

## Routes

- `/owner/recipes`
- `/manager/recipes`
- `/inventory/recipes` for Inventory Officers (read-only)

The page supports desktop, tablet, and mobile layouts. Recipe changes are
published through the existing tenant-filtered realtime transport.

## Explicitly deferred

Ingredients, quantities by ingredient, costing, inventory linkage, menu linkage,
kitchen instructions, purchasing, reporting, and automatic stock deduction are
future phases and must not be added to this foundation.
