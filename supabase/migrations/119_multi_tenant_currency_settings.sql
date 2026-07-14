-- SERVEFLOW multi-tenant currency and regional settings.
-- Defaults keep existing restaurants on Ethiopian settings until owners change them.

alter table public.restaurants
  add column if not exists currency_code text not null default 'ETB',
  add column if not exists currency_symbol text not null default 'Br',
  add column if not exists locale text not null default 'am-ET',
  add column if not exists date_format text not null default 'medium',
  add column if not exists time_format text not null default '24h';

update public.restaurants
set
  currency_code = coalesce(nullif(currency_code, ''), 'ETB'),
  currency_symbol = coalesce(nullif(currency_symbol, ''), 'Br'),
  locale = coalesce(nullif(locale, ''), 'am-ET'),
  date_format = coalesce(nullif(date_format, ''), 'medium'),
  time_format = coalesce(nullif(time_format, ''), '24h');

alter table public.restaurants
  drop constraint if exists restaurants_currency_code_format,
  add constraint restaurants_currency_code_format
    check (currency_code ~ '^[A-Z]{3}$'),
  drop constraint if exists restaurants_currency_symbol_present,
  add constraint restaurants_currency_symbol_present
    check (length(trim(currency_symbol)) between 1 and 12),
  drop constraint if exists restaurants_locale_present,
  add constraint restaurants_locale_present
    check (length(trim(locale)) between 2 and 32),
  drop constraint if exists restaurants_time_format_valid,
  add constraint restaurants_time_format_valid
    check (time_format in ('12h', '24h'));
