# Phase 8.2 Stock Operations

## Architecture

Phase 8.2 adds an isolated stock operation engine to the existing inventory module. It extends the Phase 8.1 master data foundation with an immutable `inventory_movements` ledger, stock-operation RPCs, service-layer validation, and inventory workspace screens.

Inventory item master data remains descriptive. Stock quantity is not stored as mutable item state. The authoritative balance is always derived from movement rows.

## Ledger Design

`inventory_movements` is append-only:

- Inserts create stock history.
- Updates are blocked by trigger.
- Deletes are blocked by trigger.
- Every movement carries `restaurant_id`.
- Composite foreign keys bind item, storage, unit, supplier, and staff references to the same restaurant.
- Movement rows store source metadata for later enterprise integrations without schema changes.

Supported movement types:

- Opening Balance
- Stock In
- Stock Out
- Transfer In
- Transfer Out
- Adjustment Increase
- Adjustment Decrease
- Waste
- Spoilage
- Manual Correction
- Closing Balance

## Balance Formula

Current stock is calculated from the ledger:

```text
Current Balance = Total Incoming - Total Outgoing
```

Incoming movement types are added. Outgoing movement types are subtracted. `get_inventory_current_stock`, `get_inventory_balances`, and `get_inventory_storage_balance` all use signed movement sums.

No Phase 8.2 code updates an item balance column.

## Movement Flow

1. UI submits a stock-operation draft.
2. Service validation checks item, unit, storage, supplier, quantity, reason, and available balance.
3. Repository calls a tenant-safe RPC.
4. Database validates access and same-restaurant references.
5. Database inserts immutable ledger rows.
6. Current stock and ledger screens reload from RPC-derived balances.

## Transfer Flow

Transfers are recorded in one database transaction through `record_inventory_transfer`.

```text
Transfer Group
  -> Transfer Out from source storage
  -> Transfer In to destination storage
```

The database requires exactly one `transfer_out` and one `transfer_in` per transfer group, with the same restaurant, item, and quantity, and two different storage locations.

## ER Diagram

```text
restaurants
  |-- inventory_items
  |-- inventory_units
  |-- inventory_storage_locations
  |-- inventory_suppliers
  |-- restaurant_staff
  |
  `-- inventory_movements
        |-- inventory_item_id
        |-- unit_id
        |-- storage_location_id
        |-- supplier_id
        `-- created_by_staff_id
```

All movement relationships include restaurant-scoped constraints.

## Permission Matrix

| Capability | Owner | Manager | Other authenticated users | Anonymous |
| --- | --- | --- | --- | --- |
| View movements | Yes | Yes | No | No |
| Insert stock movement | Yes | Yes | No | No |
| Run balance RPCs | Yes | Yes | No | No |
| Update movement history | No | No | No | No |
| Delete movement history | No | No | No | No |

Access is enforced with `inventory_admin_has_access(restaurant_id)` and `inventory_admin_actor(restaurant_id)`.

## Testing Summary

Added `tests/unit/inventory-stock-operations.test.ts`.

Coverage includes:

- Movement enum and ledger table contract.
- Immutable update/delete trigger contract.
- Balance derivation from signed movements.
- No item balance mutation.
- Tenant-scoped composite references.
- RLS and RPC grant contract.
- Transfer pairing and duplicate reference guards.
- Quantity, reason, storage, supplier, and tenant validation.
- Negative stock prevention.
- Opening balance uniqueness.

## Future Integration Points

The ledger includes neutral source metadata fields:

- `source_system`
- `source_record_id`
- `source_payload`
- `metadata`

These fields allow later stock-producing and stock-consuming workflows to append ledger rows while preserving the same balance formula, tenant model, and immutable history.
