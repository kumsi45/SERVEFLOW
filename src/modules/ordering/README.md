# Ordering

Phase 3 customer ordering.

This module owns:

- customer cart state
- order checkout UI
- customer order submission service

The customer-facing ordering route is:

- `/r/:restaurantSlug/order`

Existing QR menu functionality remains owned by `src/modules/qr-menu`.
