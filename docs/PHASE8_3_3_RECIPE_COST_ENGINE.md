# Phase 8.3.3 Recipe Cost Engine

## Architecture

Recipe cost is a derived read model owned by the centralized `get_recipe_cost` database function. It reads recipe ingredients, each inventory item's current `purchase_price`, the item's priced inventory unit, and the ingredient quantity/unit. No recipe cost is stored and no manual cost field exists, so every request reflects the latest inventory price.

`purchase_price` is precise inventory-item metadata representing the price of one quantity of the item's configured unit. Owners and Managers maintain it through the existing Inventory Item form. Recipe readers call the cost engine through `fetchRecipeCost`. Inventory-item realtime changes refresh an open recipe detail automatically.

## Calculation Rules

For each ingredient:

1. Convert one ingredient unit into the inventory item's priced unit.
2. `unit cost = current purchase price × conversion ratio`.
3. `ingredient cost = quantity required × unit cost`.
4. `recipe cost = SUM(ingredient costs)`.

The engine supports compatible mass (kilogram/gram), volume (liter/milliliter), and count (dozen/piece) conversions. Identical custom units use a 1:1 ratio. Incompatible units make the calculation incomplete instead of guessing. Archived items and units remain readable for existing historical recipe definitions; only the ingredient picker requires active records.

Database calculations retain `numeric(18,6)` precision and are not rounded for storage. The UI formats unit, ingredient, and recipe totals to two decimal places in ETB.

Recipe cost contains raw ingredient cost only. It excludes labour, utilities, packaging, tax, profit, selling price, and all other overhead.

## Security and Isolation

The engine requires existing Recipe read permission and scopes the recipe, ingredients, inventory items, and units to the requested restaurant. Owners, Managers, and read-only Inventory Officers can view costs. No role can manually edit a recipe cost.

## Future Profit Engine

A later profit engine may compare this derived production cost with selling revenue and explicitly add other approved cost inputs. Phase 8.3.3 performs no margin or profit calculation.

## Future Menu Pricing

Menu pricing may consume recipe cost in a later phase. This engine does not connect recipes to menu items, suggest prices, or update selling prices.

## Future Inventory Deduction

Ingredient quantities may later drive inventory movements after an authorized operational event. This phase never reads stock balances, creates movements, deducts stock, or connects to kitchen and ordering workflows.

