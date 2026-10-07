// Pure P2 snapshot -> semantic document conversion. This module sends no bytes.
const widths = new Set([58, 80]);

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PrintDocumentError('RENDER_FAILED', `${label} must be an object`);
  }
  return value;
}

function text(value, label) {
  if (value === null || value === undefined || String(value).trim() === '') {
    throw new PrintDocumentError('RENDER_FAILED', `${label} is required`);
  }
  return String(value);
}

function optional(value) {
  return value === null || value === undefined || value === '' ? null : String(value);
}

function itemLines(value, includeMoney) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new PrintDocumentError('RENDER_FAILED', 'items must be a nonempty array');
  }
  return value.map((raw, index) => {
    const item = object(raw, `items[${index}]`);
    const quantity = Number(item.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new PrintDocumentError('RENDER_FAILED', `items[${index}].quantity is invalid`);
    }
    const line = {
      type: 'item', quantity, name: text(item.name, `items[${index}].name`),
      notes: optional(item.notes),
    };
    if (includeMoney) {
      line.unitPrice = text(item.unit_price, `items[${index}].unit_price`);
      line.lineTotal = text(item.line_total, `items[${index}].line_total`);
    }
    return line;
  });
}

export class PrintDocumentError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PrintDocumentError';
    this.code = code;
    this.retryable = false;
  }
}

export function buildPrintDocument(claim, { paperWidthMm = 80 } = {}) {
  const job = object(claim, 'claim');
  if (!widths.has(paperWidthMm)) {
    throw new PrintDocumentError('UNSUPPORTED_PRINTER', 'paper width must be 58 or 80 mm');
  }
  if (job.payload_version !== 1) {
    throw new PrintDocumentError('INVALID_PAYLOAD_VERSION', 'only P2 payload version 1 is supported');
  }
  const payload = object(job.payload, 'payload');
  const restaurant = object(payload.restaurant, 'restaurant');
  const order = object(payload.order, 'order');
  const invoice = object(payload.invoice, 'invoice');
  const creator = object(payload.creator, 'creator');
  const common = {
    version: 1,
    jobId: text(job.job_id, 'job_id'),
    targetPrinterId: text(job.target_printer_id, 'target_printer_id'),
    paperWidthMm,
    restaurantName: text(restaurant.display_name, 'restaurant.display_name'),
    orderReference: optional(order.display_number) ?? text(order.id, 'order.id'),
    table: optional(order.table_number),
    creatorRole: optional(creator.role_label),
    creatorName: optional(creator.display_name),
  };

  if (job.job_type === 'kitchen_ticket' && payload.schema === 'serveflow.kitchen_ticket.v1') {
    const station = object(payload.station, 'station');
    return {
      ...common, kind: 'kitchen_ticket', heading: 'KITCHEN TICKET',
      station: text(station.name, 'station.name'),
      time: text(payload.eligible_at, 'eligible_at'),
      invoiceNumber: optional(invoice.invoice_number),
      kitchenTicketNumber: optional(invoice.kitchen_ticket_number),
      batchKey: text(payload.kitchen_batch_key, 'kitchen_batch_key'),
      orderNote: optional(order.order_note),
      items: itemLines(payload.items, false),
    };
  }
  if (job.job_type === 'receipt' && payload.schema === 'serveflow.receipt.v1') {
    return {
      ...common, kind: 'receipt', heading: 'RECEIPT',
      time: text(invoice.paid_at, 'invoice.paid_at'),
      invoiceNumber: text(invoice.invoice_number, 'invoice.invoice_number'),
      referenceNumber: optional(invoice.reference_number),
      currencyCode: optional(restaurant.currency_code),
      currencySymbol: optional(restaurant.currency_symbol),
      paymentMethod: optional(invoice.payment_method),
      financialSnapshotVersion: invoice.financial_snapshot_version,
      totals: {
        subtotal: text(invoice.subtotal, 'invoice.subtotal'),
        vatRate: optional(invoice.vat_rate),
        vatAmount: optional(invoice.vat_amount),
        serviceChargeRate: optional(invoice.service_charge_rate),
        serviceChargeAmount: optional(invoice.service_charge_amount),
        discountAmount: optional(invoice.discount_amount),
        grandTotal: text(invoice.grand_total, 'invoice.grand_total'),
      },
      items: itemLines(payload.items, true),
    };
  }
  throw new PrintDocumentError('INVALID_PAYLOAD_VERSION', 'unsupported P2 job type or payload schema');
}
