import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { PaymentMethodRuntime } from "../../../core/printing-payment/runtime";
import type { PublicQrPaymentMethod } from "../types";
import { formatMenuPrice } from "../../qr-menu/components/menuPresentation";
import "./publicPaymentPopup.css";
import "./publicPaymentPopupHotfix.css";

export type PublicPaymentProof = { referenceNumber: string; screenshot: File | null };

export async function copyPaymentValue(value: string) {
  if (!value) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch { /* Fall through for restricted mobile webviews. */ }
  try {
    const input = document.createElement("textarea");
    input.value = value;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    input.setSelectionRange(0, input.value.length);
    const copied = document.execCommand("copy");
    input.remove();
    return copied;
  } catch {
    return false;
  }
}

type Props = {
  open: boolean; businessName: string; total: number; methods: PaymentMethodRuntime[];
  selectedMethod: PublicQrPaymentMethod | ""; submitting: boolean; error?: string;
  persistenceKey: string; successMessage?: string; loading?: boolean; onRetry: () => void;
  onViewOrders?: () => void;
  onSelect: (method: PublicQrPaymentMethod) => void; onBack: () => void;
  onConfirm: (proof: PublicPaymentProof) => void;
};

const methodMeta: Record<string, { icon: string; detail: string }> = {
  cash: { icon: "CO", detail: "Pay at the cashier" }, telebirr: { icon: "TW", detail: "Mobile Wallet" },
  cbe_birr: { icon: "CB", detail: "Commercial Bank of Ethiopia" }, mobile_banking: { icon: "MB", detail: "Mobile Banking" },
  bank_transfer: { icon: "BT", detail: "Direct Deposit" }, credit_card: { icon: "CC", detail: "Card payment" },
};

export function PublicPaymentPopup({ open, businessName, total, methods, selectedMethod, submitting, error, persistenceKey, successMessage, loading, onRetry, onSelect, onBack, onViewOrders, onConfirm }: Props) {
  const [proofOpen, setProofOpen] = useState(() => { try { return window.localStorage.getItem(`${persistenceKey}:proof`) === "open"; } catch { return false; } });
  const [referenceNumber, setReferenceNumber] = useState(() => { try { return window.localStorage.getItem(`${persistenceKey}:reference`) ?? ""; } catch { return ""; } });
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [showAllMethods, setShowAllMethods] = useState(!selectedMethod);
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    try {
      window.localStorage.setItem(`${persistenceKey}:proof`, proofOpen ? "open" : "closed");
      if (referenceNumber) window.localStorage.setItem(`${persistenceKey}:reference`, referenceNumber);
      else window.localStorage.removeItem(`${persistenceKey}:reference`);
    } catch { /* Persistence is optional in restricted webviews. */ }
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open, persistenceKey, proofOpen, referenceNumber]);
  if (!open || typeof document === "undefined") return null;
  const selected = methods.find((method) => method.displayName === selectedMethod);
  const account = selected?.accounts[0];
  const isCash = selected?.code === "cash";
  const copyValue = account?.accountNumber || account?.phoneNumber || "";
  const visibleMethods = selected && !showAllMethods ? [selected] : methods;

  return createPortal(<div className="public-payment-overlay" role="presentation">
    <button type="button" className="public-payment-dismiss" aria-label="Close payment methods" onClick={onBack} />
    <section className="public-payment-sheet" role="dialog" aria-modal="true" aria-labelledby="public-payment-title">
      <div className="public-payment-handle" aria-hidden="true" />
      <header><h2 id="public-payment-title">Payment Method</h2><button type="button" aria-label="Close payment methods" onClick={onBack}>×</button></header>
      {successMessage ? <div className="public-payment-success" role="status"><span>✓</span><strong>Your Order Has Been Sent</strong><p>{successMessage}</p><div className="public-payment-success-actions"><button type="button" onClick={onViewOrders ?? onBack}>View Orders</button><button type="button" className="secondary" onClick={onBack}>Back To Menu</button></div></div> : <div className="public-payment-methods">
        {selected && !showAllMethods && !proofOpen ? <div className="public-payment-selection-bar"><span>Selected payment method</span><button type="button" onClick={() => { setShowAllMethods(true); setProofOpen(false); }}>Change</button></div> : null}
        {loading ? <div className="public-payment-empty" role="status"><strong>Loading payment methods…</strong><span>Please wait a moment.</span></div> : error && methods.length === 0 ? <div className="public-payment-empty" role="alert"><strong>Payment methods could not be loaded.</strong><button type="button" onClick={onRetry}>Try Again</button></div> : methods.length === 0 ? <div className="public-payment-empty"><strong>No payment method is currently available.</strong><span>Please contact {businessName}.</span></div> : visibleMethods.map((method) => {
          const active = method.displayName === selectedMethod;
          const details = method.accounts[0];
          return <article className={`${active ? "selected" : ""}${active && proofOpen ? " proof-open" : ""}`} key={method.code}>
            <button type="button" className="public-payment-method-head" onClick={() => { onSelect(method.displayName as PublicQrPaymentMethod); setShowAllMethods(false); setProofOpen(false); setCopyStatus("idle"); }} aria-pressed={active}>
              <span>{methodMeta[method.code]?.icon ?? "PM"}</span><span><strong>{method.displayName}</strong><small>{methodMeta[method.code]?.detail ?? "Payment method"}</small></span><i>{active ? "✓" : ""}</i>
            </button>
            {active ? <div className="public-payment-details">
              {method.code === "cash" ? <p className="public-payment-cash">Please pay at the cashier.</p> : <>
                {!proofOpen ? <dl>
                  {method.code === "bank_transfer" && details?.provider ? <div><dt>Bank Name</dt><dd>{details.provider.replace(/_/g, " ")}</dd></div> : null}
                  <div><dt>Owner Name</dt><dd>{details?.accountName || details?.businessName || businessName}</dd></div>
                  {copyValue ? <div><dt>{method.code === "bank_transfer" ? "Account Number" : "Number"}</dt><dd>{copyValue}</dd></div> : null}
                </dl> : null}
                {!proofOpen ? <div className="public-payment-actions">
                  <button type="button" disabled={!copyValue} onClick={() => void copyPaymentValue(copyValue).then((copied) => setCopyStatus(copied ? "copied" : "failed"))}>{copyStatus === "copied" ? "Copied" : details?.accountNumber ? "Copy Account Number" : "Copy Number"}</button>
                  <button type="button" className="primary" onClick={() => setProofOpen(true)}>I Have Paid</button>
                </div> : <div className="public-payment-proof">
                  <strong>Confirm your payment</strong><p>A transaction reference is preferred. The screenshot is optional.</p>
                  <label><span>Transaction Reference Number <small>(Optional)</small></span><input value={referenceNumber} maxLength={120} onChange={(event) => setReferenceNumber(event.target.value)} placeholder="Enter reference number" /></label>
                  <span className="public-payment-or">OR</span>
                  <label className="public-payment-file"><span>Upload Payment Screenshot</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setScreenshot(event.target.files?.[0] ?? null)} /><small>{screenshot?.name || "JPG, PNG or WebP"}</small></label>
                  <div className="public-payment-actions"><button type="button" onClick={() => setProofOpen(false)}>Cancel</button><button type="button" className="primary" disabled={submitting} onClick={() => onConfirm({ referenceNumber: referenceNumber.trim(), screenshot })}>{submitting ? "Submitting…" : "Confirm Payment"}</button></div>
                </div>}
                {!proofOpen && method.code === "telebirr" ? <button type="button" className="public-payment-future" disabled>Open Telebirr · Coming Soon</button> : null}
                {!proofOpen ? <button type="button" className="public-payment-cancel" onClick={onBack}>Cancel</button> : null}
                {copyStatus !== "idle" ? <p className={`public-payment-copy-status ${copyStatus}`} role="status" aria-live="polite">{copyStatus === "copied" ? "Payment number copied to your clipboard." : "Could not copy automatically. Press and hold the number to copy it."}</p> : null}
              </>}
              {isCash ? <div className="public-payment-actions"><button type="button" onClick={onBack}>Cancel</button><button type="button" className="primary" disabled={submitting} onClick={() => onConfirm({ referenceNumber: "", screenshot: null })}>{submitting ? "Placing order…" : "Place Order"}</button></div> : null}
            </div> : null}
          </article>;
        })}
      </div>}
      {error ? <p className="public-payment-error" role="alert">{error}</p> : null}
      <footer><span>Order Total</span><strong>{formatMenuPrice(total)}</strong></footer>
    </section>
  </div>, document.body);
}
