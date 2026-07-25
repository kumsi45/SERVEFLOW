# Phase 8.3.4 Menu–Recipe Linking

## Architecture

The linking engine adds one nullable `recipe_id` to each menu item. This establishes the future chain `Order → Menu Item → Recipe → Recipe Ingredients → Inventory` without consuming the relationship or changing any operational workflow.

All recipe discovery uses the centralized `list_active_menu_recipes` function. All Manager link changes use `link_menu_item_recipe`; Owner menu create/edit writes the same validated field through the existing menu workflow. A database trigger is the authoritative validation boundary for every write path. `get_recipe_used_by` supplies the reverse Recipe detail view.

## Relationship

Each menu item references zero or one recipe. A recipe may be reused by any number of menu items. Multiple recipes per menu item and recipe versioning are not supported.

The relationship is intentionally nullable. Unlinked items display **No Recipe Assigned** and **Recipe Required**, but saving remains allowed for bottled drinks and other sellable products that do not require preparation.

## Validation

- The composite `(restaurant_id, recipe_id)` foreign key prevents cross-tenant links.
- Only active, non-deleted recipes can be newly selected or linked.
- Archived recipes do not appear in search results.
- Owners and Managers can create, change, or remove links.
- Inventory Officers and Kitchen retain read-only data access; Cashier and Waiter receive no editing surface.
- Active-recipe search is bounded to 50 results and supports text search plus native keyboard selection.

Recipe details display a **Used By** count and linked menu-item names. Owners and Managers can open the corresponding menu editor directly from these links.

## Future Inventory Deduction

Phase 8.4 may resolve an ordered menu item through `menu_items.recipe_id`, then read that recipe's ingredient definitions. Phase 8.3.4 does not create inventory movements, inspect balances, or deduct quantities.

## Future Kitchen Integration

Kitchen workflows may consume recipe information in a future phase. This change does not modify kitchen routing, tickets, preparation state, ordering, purchasing, reports, profit, or menu pricing.

