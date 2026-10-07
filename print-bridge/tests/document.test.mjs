import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrintDocument, PrintDocumentError } from '../src/document.mjs';
import { MockPrinterTransport } from '../src/mockTransport.mjs';

const base = {
  job_id: 'job-1', target_printer_id: 'printer-1', payload_version: 1,
  payload: {
    restaurant: { display_name: 'ServeFlow', currency_code: 'ETB' },
    order: { id: 'order-1', display_number: '42', table_number: '7', order_note: 'No rush' },
    creator: { role_label: 'Waiter', display_name: 'Aster' },
  },
};

test('Kitchen document picks only the immutable Kitchen snapshot and excludes money', () => {
  const claim = structuredClone(base);
  claim.job_type = 'kitchen_ticket';
  Object.assign(claim.payload, {
    schema: 'serveflow.kitchen_ticket.v1', eligible_at: '2026-10-07T10:00:00Z',
    station: { name: 'Kitchen' }, kitchen_batch_key: 'initial',
    invoice: { invoice_number: 'INV-1', kitchen_ticket_number: 'K-1', grand_total: 999 },
    items: [{ name: 'Burger', quantity: 2, notes: 'No onion', unit_price: 500 }],
  });
  const document = buildPrintDocument(claim, { paperWidthMm: 58 });
  assert.equal(document.kind, 'kitchen_ticket');
  assert.equal(document.paperWidthMm, 58);
  assert.deepEqual(document.items, [{ type: 'item', quantity: 2, name: 'Burger', notes: 'No onion' }]);
  assert.doesNotMatch(JSON.stringify(document), /grand_total|unit_price|999|500/);
});

test('Receipt preserves source monetary fields at 80 mm without recomputing', () => {
  const claim = structuredClone(base);
  claim.job_type = 'receipt';
  Object.assign(claim.payload, {
    schema: 'serveflow.receipt.v1',
    invoice: { invoice_number: 'INV-2', paid_at: '2026-10-07T10:05:00Z',
      subtotal: '100.00', vat_amount: '15.00', grand_total: '115.00',
      payment_method: 'Cash', financial_snapshot_version: 2 },
    items: [{ name: 'Buna', quantity: 1, unit_price: '100.00', line_total: '100.00' }],
  });
  const document = buildPrintDocument(claim);
  assert.equal(document.paperWidthMm, 80);
  assert.equal(document.totals.grandTotal, '115.00');
  assert.equal(document.totals.vatAmount, '15.00');
  assert.equal(document.items[0].unitPrice, '100.00');
});

test('Unsupported payload and width fail closed', () => {
  assert.throws(() => buildPrintDocument({ ...base, payload_version: 2 }),
    (error) => error instanceof PrintDocumentError && error.code === 'INVALID_PAYLOAD_VERSION');
  assert.throws(() => buildPrintDocument(base, { paperWidthMm: 72 }),
    (error) => error.code === 'UNSUPPORTED_PRINTER');
});

test('Semantic document preserves Afaan Oromo and Amharic for later raster rendering', () => {
  const claim = structuredClone(base);
  claim.job_type = 'kitchen_ticket';
  Object.assign(claim.payload, {
    schema: 'serveflow.kitchen_ticket.v1', eligible_at: '2026-10-07T10:00:00Z',
    station: { name: 'Kushiinaa' }, kitchen_batch_key: 'initial',
    invoice: { invoice_number: 'INV-3' },
    items: [{ name: 'Qaxxaamuraa ቡና', quantity: 1, notes: 'በጥንቃቄ' }],
  });
  const document = buildPrintDocument(claim);
  assert.equal(document.items[0].name, 'Qaxxaamuraa ቡና');
  assert.equal(document.items[0].notes, 'በጥንቃቄ');
});

test('Mock transport captures output and never reports physical acceptance', async () => {
  const document = { kind: 'kitchen_ticket', items: [{ name: 'Coffee' }] };
  const mock = new MockPrinterTransport();
  assert.deepEqual(await mock.send(document),
    { simulated: true, physicalAcceptance: false, documentCount: 1 });
  document.items[0].name = 'changed';
  assert.equal(mock.captured[0].items[0].name, 'Coffee');
  for (const [mode, code] of [['timeout', 'CONNECTION_TIMEOUT'],
    ['offline', 'PRINTER_OFFLINE'], ['retryable', 'NETWORK_UNREACHABLE']]) {
    await assert.rejects(new MockPrinterTransport(mode).send(document),
      (error) => error.code === code && error.retryable && error.simulated);
  }
});
