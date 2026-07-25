# Kitchen Routing Engine

## Architecture

The Kitchen Routing Engine is the database boundary that maps each ordered menu
item to exactly one tenant-owned kitchen station. The customer order and dining
session remain whole; only the internal `order_items` are grouped into
station-local tickets.

The canonical resolver is:

```text
public.resolve_kitchen_station_route(restaurant_id, menu_item_id)
```

`order_items.kitchen_station_id` is a routing snapshot. It is assigned by the
`route_order_item_kitchen_station` trigger before insertion and consumed by the
canonical station queue. Order-creation RPCs do not choose stations.

## Routing flow

```text
Owner/Manager assignment
        ↓
menu_items.kitchen_station_id
        ↓
Customer/Waiter/POS creates one order
        ↓
Workflow Engine releases eligible items
        ↓
Kitchen Routing Engine resolves every item
        ↓
order_items.kitchen_station_id snapshot
        ↓
Station-scoped queue RPC
        ↓
Kitchen dashboard refreshes from realtime event
```

For Burger, Juice, and Cake, the customer retains one order ID. Three internal
station batches can be returned because the queue groups by order, invoice,
station, and append batch.

## Resolution rules

1. Use the active menu-item assignment in the same restaurant.
2. If it is missing or inactive, use that restaurant's explicit `is_default`
   active station.
3. For a legacy tenant without an explicit default, use its highest-priority
   active station deterministically.
4. If the restaurant has no active station, reject the write visibly. An item
   must never be silently inserted without a queue destination.

Station names, menu names, category IDs, restaurant IDs, and keyword guesses do
not participate in routing. Foreign keys and resolver joins enforce tenant
isolation.

## Assignment changes

Owners and managers can assign an active station belonging to their restaurant.
Other roles are rejected by the validation trigger. A changed assignment applies
to newly ordered items. Existing completed history retains its routing snapshot;
the repair migration only corrects currently active work created under the old
router.

Kitchen staff assignment determines which station queue a staff member sees. It
does not give that staff member permission to change menu routing.

## Realtime behavior

`order_items` and `kitchen_stations` are in the central tenant realtime stream.
An eligible routed item insertion/update emits a restaurant-filtered event. The
Kitchen Dashboard invalidates and reloads `get_canonical_station_kitchen_orders`,
which filters by the staff member's assigned station. Mixed orders therefore
refresh every affected station without a page reload.

Realtime transports the routed database state; it does not calculate a station.

## Future extension points

Category-level defaults or station capabilities may be added as explicit,
tenant-scoped database assignments ahead of the default fallback. Such additions
must remain inside `resolve_kitchen_station_route`, preserve exactly-one-station
output, avoid name/keyword inference, and add routing and tenant-isolation tests.

Delivery, online ordering, Hotel PMS, and corporate integrations require no
special routing path: after they create canonical `order_items`, the same trigger
resolves their station snapshots.
