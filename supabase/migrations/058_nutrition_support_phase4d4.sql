-- SERVEFLOW Phase 4D.4 Nutrition Support.
-- Storage-only nutrition fields with manual owner edits and public menu display.
-- No AI, automatic calculations, kitchen, cashier, payment, or ordering changes.

alter table public.menu_items
  add column if not exists calories integer,
  add column if not exists protein_g numeric(8, 2),
  add column if not exists carbohydrates_g numeric(8, 2),
  add column if not exists fat_g numeric(8, 2),
  add column if not exists fiber_g numeric(8, 2),
  add column if not exists sugar_g numeric(8, 2),
  add column if not exists sodium_mg numeric(8, 2);

alter table public.menu_items
  drop constraint if exists menu_items_nutrition_non_negative,
  add constraint menu_items_nutrition_non_negative
    check (
      (calories is null or calories >= 0)
      and (protein_g is null or protein_g >= 0)
      and (carbohydrates_g is null or carbohydrates_g >= 0)
      and (fat_g is null or fat_g >= 0)
      and (fiber_g is null or fiber_g >= 0)
      and (sugar_g is null or sugar_g >= 0)
      and (sodium_mg is null or sodium_mg >= 0)
    );

comment on column public.menu_items.calories is 'Optional owner-maintained nutrition value. No automatic calculation.';
comment on column public.menu_items.protein_g is 'Optional owner-maintained protein grams. No automatic calculation.';
comment on column public.menu_items.carbohydrates_g is 'Optional owner-maintained carbohydrate grams. No automatic calculation.';
comment on column public.menu_items.fat_g is 'Optional owner-maintained fat grams. No automatic calculation.';
comment on column public.menu_items.fiber_g is 'Optional owner-maintained fiber grams. No automatic calculation.';
comment on column public.menu_items.sugar_g is 'Optional owner-maintained sugar grams. No automatic calculation.';
comment on column public.menu_items.sodium_mg is 'Optional owner-maintained sodium milligrams. No automatic calculation.';
