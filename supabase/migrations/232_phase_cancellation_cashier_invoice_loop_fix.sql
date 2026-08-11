-- Live repair for the Phase 2 handler's PL/pgSQL invoice-loop variable name.
-- Fresh databases receive the corrected function in migration 231; this migration
-- updates databases where the original 231 definition was already installed.

do $$
declare
  definition text;
begin
  select pg_get_functiondef(
    'public.cashier_handle_cancellation_request(uuid,text)'::regprocedure
  ) into definition;

  if position('invoice_id uuid;' in definition) > 0 then
    definition := replace(definition, 'invoice_id uuid;', 'target_invoice_id uuid;');
    definition := replace(definition, 'for invoice_id in', 'for target_invoice_id in');
    definition := replace(definition,
      'refresh_invoice_financial_totals(invoice_id)',
      'refresh_invoice_financial_totals(target_invoice_id)');
    definition := replace(definition,
      'remaining.invoice_id = invoice_id',
      'remaining.invoice_id = target_invoice_id');
    definition := replace(definition,
      'invoices.id = invoice_id',
      'invoices.id = target_invoice_id');
    execute definition;
  end if;
end;
$$;
