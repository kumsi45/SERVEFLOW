# Phase 8.3.2 Recipe Ingredient Management

## Architecture

Recipe Ingredient Management extends the existing Recipe module with a dedicated `recipe_ingredients` table and a focused service/UI layer. Ingredients are definitions only: this phase does not read balances, write movements, deduct stock, calculate cost, or connect recipes to menu, order, kitchen, or purchasing workflows.

Recipe details load ingredient rows together with their inventory-item and unit display names. Owner and Manager mutations go through `manage_recipe_ingredient`; Inventory Officers receive the same tenant-scoped read model without mutation controls. Recipe duplication uses `duplicate_recipe_with_ingredients`, which duplicates the recipe and all ingredient definitions in one transaction.

## Ingredient Model

Each row contains a restaurant, recipe, active inventory item, positive required quantity, active inventory unit, optional notes, display order, and timestamps. A composite unique constraint allows an inventory item only once in each recipe. Composite foreign keys bind the recipe, item, and unit to the same restaurant.

Only `inventory_items` can be selected. The picker queries at most 50 matching active items at a time, supports typed search and native keyboard selection, and excludes archived or deleted items. Active units from the same restaurant are available for quantity definition.

## Restaurant Isolation

Every ingredient row carries `restaurant_id`. Database foreign keys prevent cross-restaurant recipe, item, or unit references. RLS uses the existing recipe permission functions, all UI queries include the active restaurant, and mutation functions verify the authenticated user's role in the target restaurant.

## Validation

- Inventory item is required and must be active in the recipe's restaurant.
- Unit is required and must be active in the recipe's restaurant.
- Quantity must be greater than zero.
- An inventory item cannot appear twice in one recipe.
- Notes are trimmed and limited to 500 characters.
- Only Owners and Managers can add, edit, remove, or duplicate ingredient definitions.
- Inventory Officers have read-only access.

Validation exists at both the UI boundary and database boundary. Database constraints and triggers remain authoritative.

## Future Connection

The recipe detail includes a cost placeholder for Phase 8.3.3, but performs no calculation. Ingredient rows provide the future input for Phase 8.4 Automatic Inventory Deduction. That phase must explicitly translate completed production or sales events into stock movements; no such behavior is present here.

