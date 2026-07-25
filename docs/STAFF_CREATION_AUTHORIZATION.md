# Staff Creation Authorization

Staff creation is authorized by the `manage-staff` Edge Function after it verifies an active Owner or Manager membership for the requested restaurant. The browser role selector is not an authorization boundary.

| Acting role | Roles it may create |
| --- | --- |
| Owner | Manager, Inventory Officer, Cashier, Kitchen Staff, Waiter (plus retained legacy Reception and Inventory roles) |
| Manager | Inventory Officer, Cashier, Kitchen Staff, Waiter |
| Inventory Officer, Kitchen, Cashier, Waiter | None |

Managers cannot create Owner or Manager accounts. Owner accounts are never accepted as a staff-creation target. Membership lookup, staff insertion, public-user assignment, and employee ID generation are scoped to the requested restaurant and the authenticated actor's membership in that same restaurant.

Inventory Officer accounts use the existing staff authentication flow and route to `/inventory/dashboard`. Their inventory permissions come from the existing restaurant-scoped Inventory Officer policies; staff-management access is not granted.
