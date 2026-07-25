-- ServeFlow inventory initialization tracking foundation.
-- This migration adds state only; it does not initialize Inventory or alter domain behavior.

alter table public.restaurants
  add column if not exists inventory_initialized boolean not null default false,
  add column if not exists inventory_initialized_at timestamptz,
  add column if not exists inventory_template text;

-- Completion time and completion state must be written together by the future
-- Inventory initialization transaction. A failed transaction therefore cannot
-- leave a partially completed state.
alter table public.restaurants
  drop constraint if exists restaurants_inventory_initialization_state_consistent;

alter table public.restaurants
  add constraint restaurants_inventory_initialization_state_consistent check (
    (inventory_initialized = false and inventory_initialized_at is null)
    or
    (inventory_initialized = true and inventory_initialized_at is not null)
  );

comment on column public.restaurants.inventory_initialized is
  'True only after the restaurant inventory preparation transaction completes successfully.';
comment on column public.restaurants.inventory_initialized_at is
  'Completion timestamp written in the same transaction as inventory_initialized.';
comment on column public.restaurants.inventory_template is
  'Optional identifier for the inventory preparation template used.';

