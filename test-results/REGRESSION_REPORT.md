# ServeFlow Production Regression Report

Generated: 2026-07-16T20:02:02.158Z

## Result

| PASS | FAIL | SKIP |
| ---: | ---: | ---: |
| 44 | 0 | 41 |

## Regressions

No failing regressions.

## Resolved regressions

- REG-001 - The public waiter Supabase client reused the default auth storage key, allowing multiple GoTrue clients in one browser context to contend for the same session. (assigned the client the isolated serveflow-waiter-public-auth storage key)
- REG-002 - Five deployed PL/pgSQL paths failed static runtime validation because of ambiguous identifiers or an enum type mismatch. (stabilized name resolution, waiter assignment conflict handling, and kitchen activity enum writes in migrations 140-141)
- REG-003 - Customer feedback photos were globally readable from a public storage bucket. (made the bucket private and restricted object reads and persisted paths to the owning restaurant in migration 142)
- REG-004 - Staff authentication was stored per tab and could not survive browser restart or restore in a new tab. (superseded by REG-006 because durable shared storage broke concurrent dashboard isolation)
- REG-005 - Manager pages duplicated subscriptions and did not consistently reload after reconnect, browser wake, or network recovery. (migrated all Manager data surfaces to the shared tenant realtime recovery hook)
- REG-006 - One durable staff auth key allowed a login in any tab to replace Owner, Manager, Cashier, or Kitchen sessions in every other tab. (assigned every browser tab an isolated sessionStorage-backed Supabase auth namespace)
- REG-007 - Opening a QR session for Restaurant B deleted Restaurant A QR cart and checkout state from shared localStorage. (scoped active QR markers and cleanup to the current restaurant slug)
- REG-008 - Waiter offline order queues were shared by every restaurant. (scoped queue storage and synchronization to the authenticated waiter restaurant)
- REG-009 - Owner AI insights could crash in PostgreSQL formatting with too few arguments. (removed PostgreSQL format calls and deployed typed concatenation in migration 143)

## Test cases

- SKIP - auth-isolation.spec.ts / Restaurant A/B owner-manager-cashier-kitchen-waiter tabs remain isolated
- SKIP - auth-isolation.spec.ts / Restaurant A/B owner-manager-cashier-kitchen-waiter tabs remain isolated
- PASS - public-workflows.spec.ts / landing page production smoke with screenshot
- SKIP - public-workflows.spec.ts / refresh and browser restart retain customer tracking
- SKIP - public-workflows.spec.ts / offline and reconnect do not destroy tracking
- SKIP - public-workflows.spec.ts / two restaurants remain isolated in simultaneous devices
- PASS - public-workflows.spec.ts / landing page production smoke with screenshot
- SKIP - public-workflows.spec.ts / refresh and browser restart retain customer tracking
- SKIP - public-workflows.spec.ts / offline and reconnect do not destroy tracking
- SKIP - public-workflows.spec.ts / two restaurants remain isolated in simultaneous devices
- SKIP - staff-workflows.spec.ts / waiter workflow route is guarded and renderable
- SKIP - staff-workflows.spec.ts / cashier workflow route is guarded and renderable
- SKIP - staff-workflows.spec.ts / kitchen workflow route is guarded and renderable
- SKIP - staff-workflows.spec.ts / manager workflow route is guarded and renderable
- SKIP - staff-workflows.spec.ts / owner workflow route is guarded and renderable
- SKIP - staff-workflows.spec.ts / inventory workflow route is guarded and renderable
- SKIP - staff-workflows.spec.ts / reports workflow route is guarded and renderable
- SKIP - staff-workflows.spec.ts / ai workflow route is guarded and renderable
- SKIP - staff-workflows.spec.ts / waiter workflow route is guarded and renderable
- SKIP - staff-workflows.spec.ts / cashier workflow route is guarded and renderable
- SKIP - staff-workflows.spec.ts / kitchen workflow route is guarded and renderable
- SKIP - staff-workflows.spec.ts / manager workflow route is guarded and renderable
- SKIP - staff-workflows.spec.ts / owner workflow route is guarded and renderable
- SKIP - staff-workflows.spec.ts / inventory workflow route is guarded and renderable
- SKIP - staff-workflows.spec.ts / reports workflow route is guarded and renderable
- SKIP - staff-workflows.spec.ts / ai workflow route is guarded and renderable
- SKIP - guarded Supabase multi-tenant regression tenant A cannot read tenant B orders
- SKIP - guarded Supabase multi-tenant regression tenant A cannot read tenant B order_items
- SKIP - guarded Supabase multi-tenant regression tenant A cannot read tenant B order_invoices
- SKIP - guarded Supabase multi-tenant regression tenant A cannot read tenant B restaurant_staff
- SKIP - guarded Supabase multi-tenant regression tenant A cannot read tenant B inventory_items
- SKIP - guarded Supabase multi-tenant regression tenant A cannot read tenant B kitchen_inventory_requests
- SKIP - guarded Supabase multi-tenant regression isolates orders across four simultaneous restaurants
- SKIP - guarded Supabase multi-tenant regression isolates order_items across four simultaneous restaurants
- SKIP - guarded Supabase multi-tenant regression isolates order_invoices across four simultaneous restaurants
- SKIP - guarded Supabase multi-tenant regression isolates restaurant_staff across four simultaneous restaurants
- SKIP - guarded Supabase multi-tenant regression isolates notifications across four simultaneous restaurants
- SKIP - guarded Supabase multi-tenant regression isolates inventory_items across four simultaneous restaurants
- SKIP - guarded Supabase multi-tenant regression isolates kitchen_inventory_requests across four simultaneous restaurants
- SKIP - guarded Supabase multi-tenant regression tenant sessions cannot poison each other's analytics
- SKIP - guarded Supabase multi-tenant regression supports payment policy fixture pay_before_kitchen
- SKIP - guarded Supabase multi-tenant regression supports payment policy fixture hold_payment
- SKIP - guarded Supabase multi-tenant regression supports payment policy fixture mixed
- PASS - historical analytics windows uses restaurant midnight converted to UTC
- PASS - historical analytics windows makes custom end dates inclusive through an exclusive next midnight
- PASS - historical analytics windows handles DST 23-hour and 25-hour days
- PASS - historical analytics windows keeps cross-midnight events in their own canonical periods
- PASS - historical analytics windows builds completed-day history by calendar boundaries
- PASS - authentication and tenant isolation contracts isolates staff auth by browser tab instead of shared localStorage
- PASS - authentication and tenant isolation contracts keeps every active restaurant selection inside its role and tab
- PASS - authentication and tenant isolation contracts binds waiter authentication and offline orders to one restaurant
- PASS - authentication and tenant isolation contracts never clears another restaurant's QR browser state
- PASS - authentication and tenant isolation contracts contains no PostgreSQL format calls in the migration chain
- PASS - canonical lifecycle preserves operational state new
- PASS - canonical lifecycle preserves operational state accepted
- PASS - canonical lifecycle preserves operational state preparing
- PASS - canonical lifecycle preserves operational state ready
- PASS - canonical lifecycle preserves operational state served
- PASS - canonical lifecycle preserves operational state closed
- PASS - canonical lifecycle preserves payment state pending
- PASS - canonical lifecycle preserves payment state held
- PASS - canonical lifecycle preserves payment state paid
- PASS - canonical lifecycle preserves payment state refunded
- PASS - canonical lifecycle preserves payment state cancelled
- PASS - canonical lifecycle keeps operational and payment dimensions independent
- PASS - canonical lifecycle computes kitchen progress without payment input
- PASS - canonical lifecycle drives customer tracking presentation from canonical operational state
- PASS - payment methods normalizes Cash
- PASS - payment methods normalizes Card
- PASS - payment methods normalizes TeleBirr
- PASS - payment methods normalizes CBE Birr
- PASS - payment methods normalizes Chapa
- PASS - payment methods normalizes Mobile Banking
- PASS - payment methods normalizes Mixed
- PASS - payment policy matrix has a deterministic policy fixture for pay_before_kitchen
- PASS - payment policy matrix has a deterministic policy fixture for hold_payment
- PASS - payment policy matrix has a deterministic policy fixture for mixed
- PASS - production source contracts keeps all application realtime channels inside RestaurantEventService
- PASS - production source contracts keeps kitchen independent from payment and invoices
- PASS - production source contracts filters every realtime subscription by restaurant
- PASS - production source contracts defines canonical historical timestamps
- PASS - production source contracts uses one tenant realtime recovery implementation across manager surfaces
- PASS - production source contracts keeps feedback photos private and tenant-readable
- PASS - customer tracking persistence restores restaurant, session, order and invoice after browser restart
- PASS - customer tracking persistence never restores another restaurant's tracking record

## Screenshots

- [public-workflows-landing-p-a5377-ction-smoke-with-screenshot-desktop-chromium\landing.png](../artifacts/public-workflows-landing-p-a5377-ction-smoke-with-screenshot-desktop-chromium/landing.png)
- [public-workflows-landing-p-a5377-ction-smoke-with-screenshot-mobile-chromium\landing.png](../artifacts/public-workflows-landing-p-a5377-ction-smoke-with-screenshot-mobile-chromium/landing.png)