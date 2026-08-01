export type PaymentPolicy = "pay_before_kitchen" | "kitchen_before_payment" | "mixed";
export type KitchenOutputMode = "single_kitchen_printer" | "station_printers" | "kds" | "kds_and_printers";

export type PaymentAccountRuntime = {
  provider: string;
  businessName: string | null;
  accountName: string | null;
  accountNumber: string | null;
  phoneNumber: string | null;
  referenceFormat: string | null;
  qrImageUrl: string | null;
  instructions: string | null;
};

export type PaymentMethodRuntime = {
  code: string;
  displayName: string;
  isDefault: boolean;
  accounts: PaymentAccountRuntime[];
};

export type PublicPaymentRuntime = {
  restaurantId: string;
  businessName: string;
  paymentPolicy: PaymentPolicy;
  methods: PaymentMethodRuntime[];
};

export function paymentPolicyDecision(policy: PaymentPolicy) {
  if (policy === "kitchen_before_payment") {
    return { createBeforePayment: true, releaseToKitchen: true, paymentDue: true };
  }
  if (policy === "mixed") {
    return { createBeforePayment: false, releaseToKitchen: false, paymentDue: false, unsupported: true };
  }
  return { createBeforePayment: false, releaseToKitchen: false, paymentDue: false };
}

export type ReceiptCopyType = "customer" | "merchant" | "duplicate" | "refund" | "daily_closing";
export type ReceiptLine = { name: string; quantity: number; unitPrice: number; lineTotal: number };
export type ReceiptPayload = {
  copyType: ReceiptCopyType; businessName: string; orderNumber: string; issuedAt: string;
  customerName?: string | null; table?: string | null; cashier?: string | null;
  lines: ReceiptLine[]; subtotal: number; vat: number; serviceCharge: number;
  discount: number; total: number; paymentMethod?: string | null; referenceNumber?: string | null;
};

export function generateReceiptPayload(input: ReceiptPayload): Readonly<ReceiptPayload> {
  return Object.freeze({ ...input, lines: input.lines.map((line) => Object.freeze({ ...line })) });
}

export type KitchenTicketItem = { name: string; quantity: number; modifiers?: string[]; station?: string | null };
export type KitchenTicketPayload = {
  orderNumber: string; table?: string | null; customerName?: string | null; items: KitchenTicketItem[];
  priority: "normal" | "high" | "urgent"; station?: string | null; createdAt: string; waiter?: string | null;
};

export function generateKitchenTicketPayload(input: KitchenTicketPayload): Readonly<KitchenTicketPayload> {
  return Object.freeze({ ...input, items: input.items.map((item) => Object.freeze({ ...item })) });
}

export type RuntimePrinter = { id: string; purpose: string; enabled: boolean; status: string; priority: number };
export type RuntimeStationMapping = { kitchenStationId: string; printerId: string; active: boolean };
export type KitchenRoute = { channel: "kds" | "printer"; printerId?: string; stationId?: string | null };

function firstReady(printers: RuntimePrinter[], purpose: string) {
  return printers
    .filter((printer) => printer.enabled && printer.status === "online" && printer.purpose === purpose)
    .sort((a, b) => a.priority - b.priority)[0];
}

export function routeKitchenOutput(input: {
  mode: KitchenOutputMode; stationId?: string | null; printers: RuntimePrinter[]; mappings: RuntimeStationMapping[];
}): KitchenRoute[] {
  const routes: KitchenRoute[] = [];
  if (input.mode === "kds" || input.mode === "kds_and_printers") routes.push({ channel: "kds", stationId: input.stationId });
  if (input.mode === "single_kitchen_printer" || input.mode === "kds_and_printers") {
    const printer = firstReady(input.printers, "kitchen_order");
    if (printer) routes.push({ channel: "printer", printerId: printer.id, stationId: input.stationId });
  }
  if (input.mode === "station_printers") {
    const mapping = input.mappings.find((entry) => entry.active && entry.kitchenStationId === input.stationId);
    const printer = mapping && input.printers.find((entry) => entry.id === mapping.printerId && entry.enabled && entry.status === "online");
    if (printer) routes.push({ channel: "printer", printerId: printer.id, stationId: input.stationId });
  }
  return routes;
}

export interface PrinterService {
  enqueueReceipt(printerId: string, payload: ReceiptPayload): Promise<void>;
  enqueueKitchenTicket(printerId: string, payload: KitchenTicketPayload): Promise<void>;
}

export class PayloadOnlyPrinterService implements PrinterService {
  async enqueueReceipt(): Promise<void> { throw new Error("Printer hardware runtime is not installed."); }
  async enqueueKitchenTicket(): Promise<void> { throw new Error("Printer hardware runtime is not installed."); }
}

export function runtimeHealth(input: {
  receiptPrinters: RuntimePrinter[]; kitchenRoutes: KitchenRoute[]; enabledPaymentMethods: number;
  activePaymentAccounts: number; menuPublished: boolean; qrOrderingReady: boolean; inventoryReady: boolean; staffReady: boolean;
}) {
  return {
    receiptPrinterReady: Boolean(firstReady(input.receiptPrinters, "receipt")),
    kitchenOutputReady: input.kitchenRoutes.length > 0,
    paymentMethodReady: input.enabledPaymentMethods > 0,
    businessAccountReady: input.activePaymentAccounts > 0,
    menuPublished: input.menuPublished, qrOrderingReady: input.qrOrderingReady,
    inventoryReady: input.inventoryReady, staffReady: input.staffReady,
  };
}
