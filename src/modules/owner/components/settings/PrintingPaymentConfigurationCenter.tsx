import { useEffect, useMemo, useState } from "react";
import { createBrowserUuid } from "../../../../core/browser/createBrowserUuid";
import { SfButton, SfDialog, SfErrorState, SfSkeleton } from "../design-system";
import {
  loadPaymentConfiguration,
  savePaymentAccount,
  savePaymentConfiguration,
  softDeletePaymentAccount,
  type BusinessPaymentAccount,
  type PaymentConfiguration,
  type PaymentPolicyCode,
} from "../../services/printingPaymentConfigurationService";
import "./printingPaymentConfigurationCenter.css";

type Props = {
  restaurantId: string;
  businessName: string;
  currencySymbol: string;
};

function providerForMethod(code: string) {
  if (code === "telebirr") return "telebirr";
  if (code === "cbe_birr") return "commercial_bank_of_ethiopia";
  return "other_bank";
}

function supportsPaymentAccount(code: string) {
  return !["cash", "credit_card", "card", "qr"].includes(code);
}

function accountIdentifierLabel(code?: string) {
  if (code === "telebirr") return "Telebirr phone number";
  if (code === "cbe_birr") return "CBE Birr account number";
  if (code === "mobile_banking") return "Mobile banking account number";
  return "Account number";
}

function accountIdentifier(account: BusinessPaymentAccount) {
  return account.phone_number || account.account_number || "Not configured";
}

export function PrintingPaymentConfigurationCenter({ restaurantId, businessName, currencySymbol }: Props) {
  const [config, setConfig] = useState<PaymentConfiguration | null>(null);
  const [savedConfig, setSavedConfig] = useState<PaymentConfiguration | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [accountDraft, setAccountDraft] = useState<BusinessPaymentAccount | null>(null);
  const [accountFormError, setAccountFormError] = useState<string | null>(null);
  const [accountSaving, setAccountSaving] = useState(false);
  const [expandedAccountId, setExpandedAccountId] = useState<string | null>(null);
  const [editingCharge, setEditingCharge] = useState<"vat" | "service" | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  async function load() {
    try {
      setLoading(true);
      setError(null);
      const loaded = await loadPaymentConfiguration(restaurantId);
      setConfig(loaded);
      setSavedConfig(loaded);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Payment configuration could not be loaded.");
      setConfig(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setAccountDraft(null);
    setAccountFormError(null);
    void load();
  }, [restaurantId]);

  const methodById = useMemo(
    () => new Map((config?.methods ?? []).map((method) => [method.id, method])),
    [config?.methods],
  );

  async function save() {
    if (!config) return;
    try {
      setSaving(true);
      setError(null);
      setNotice(null);
      await savePaymentConfiguration(restaurantId, config);
      setSavedConfig(config);
      setNotice("Payment settings saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Payment configuration could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  function setDefaultMethod(id: string) {
    setConfig((current) => current ? {
      ...current,
      methods: current.methods.map((method) => ({
        ...method,
        enabled: method.id === id ? true : method.enabled,
        is_default: method.id === id,
      })),
    } : current);
  }

  function openNewAccount() {
    if (!config) return;
    setAccountFormError(null);
    setAccountDraft({
      id: createBrowserUuid(),
      restaurant_id: restaurantId,
      payment_method_id: "",
      provider_code: "other_bank",
      business_name: businessName,
      account_name: null,
      account_number: null,
      phone_number: null,
      reference_format: "Order number",
      qr_image_url: null,
      instructions: "Include the order number as the payment reference.",
      status: "active",
      display_order: config.accounts.length * 10 + 10,
      deleted_at: null,
    });
  }

  function closeAccountEditor() {
    if (accountSaving) return;
    setAccountDraft(null);
    setAccountFormError(null);
  }

  async function commitAccount() {
    if (!config || !accountDraft) return;
    if (accountDraft.restaurant_id !== restaurantId) {
      setAccountFormError("This account draft belongs to a different business. Please reopen Add account.");
      return;
    }
    const method = config.methods.find((item) => item.id === accountDraft.payment_method_id);
    if (!method || !supportsPaymentAccount(method.method_code)) {
      setAccountFormError("Select a supported payment method.");
      return;
    }
    if (!accountDraft.account_number?.trim() && !accountDraft.phone_number?.trim()) {
      setAccountFormError(`Enter ${accountIdentifierLabel(method.method_code).toLowerCase()}.`);
      return;
    }
    try {
      setAccountSaving(true);
      setAccountFormError(null);
      await savePaymentAccount(restaurantId, accountDraft);
      const withSavedAccount = (current: PaymentConfiguration | null) => current ? {
        ...current,
        accounts: [...current.accounts.filter((account) => account.id !== accountDraft.id), accountDraft],
      } : current;
      setConfig(withSavedAccount);
      setSavedConfig(withSavedAccount);
      setAccountDraft(null);
      setNotice("Payment account saved.");
    } catch (cause) {
      setAccountFormError(cause instanceof Error ? cause.message : "Payment account could not be saved.");
    } finally {
      setAccountSaving(false);
    }
  }

  async function deleteAccount(account: BusinessPaymentAccount) {
    try {
      await softDeletePaymentAccount(restaurantId, account.id);
      const withoutAccount = (current: PaymentConfiguration | null) => current ? {
        ...current,
        accounts: current.accounts.filter((item) => item.id !== account.id),
      } : current;
      setConfig(withoutAccount);
      setSavedConfig(withoutAccount);
      setExpandedAccountId(null);
      setNotice("Payment account removed.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Payment account could not be removed.");
    }
  }

  if (loading) return <div className="ppcc-shell" aria-label="Loading payment configuration"><SfSkeleton lines={8} /></div>;
  if (error && !config) return <SfErrorState description={error} retry={() => void load()} />;
  if (!config) return null;

  const enabledMethods = config.methods.filter((method) => method.enabled);
  const dirty = JSON.stringify(config) !== JSON.stringify(savedConfig);
  function discard() { if (savedConfig) setConfig(savedConfig); setError(null); setNotice(null); }

  return <div className="ppcc-shell">
    <div className="ppcc-intro"><div><span>Payments</span><h2>Payment configuration</h2><p>Choose when customers pay, which methods they can use, and the charges applied to order totals.</p></div><SfButton onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save payment settings"}</SfButton></div>
    {(error || notice) ? <div className={error ? "ppcc-message error" : "ppcc-message success"} role={error ? "alert" : "status"}>{error || notice}</div> : null}

    <section className="ppcc-section" id="customer-payments">
      <SectionHeader number="01" title="Payment Flow" detail="Choose when an order becomes eligible for kitchen preparation." />
      <div className="ppcc-flow-row"><Field label="Order flow"><select value={config.paymentPolicy} onChange={(event) => setConfig({ ...config, paymentPolicy: event.target.value as PaymentPolicyCode })}><option value="pay_before_kitchen">Customer pays before kitchen</option><option value="kitchen_before_payment">Waiter payment due</option></select></Field><p>{config.paymentPolicy === "pay_before_kitchen" ? "Payment is required before preparation starts." : "A waiter places the order and payment remains due."}</p></div>
    </section>

    <section className="ppcc-section">
      <SectionHeader number="02" title="Payment Methods" detail="Enable the methods customers can use and choose one default." />
      <div className="ppcc-method-grid">{config.methods.map((method) => <article className={method.enabled ? "enabled" : ""} key={method.id}><div><span>{method.display_name.slice(0, 2).toUpperCase()}</span><div><strong>{method.display_name}</strong><small>{method.method_code === "qr" ? "Recorded by staff at checkout" : method.is_default ? "Default payment method" : method.enabled ? "Available at checkout" : "Disabled"}</small></div></div><input className="od-switch" type="checkbox" checked={method.enabled} aria-label={`Enable ${method.display_name}`} onChange={(event) => setConfig({ ...config, methods: config.methods.map((item) => item.id === method.id ? { ...item, enabled: event.target.checked, is_default: event.target.checked ? item.is_default : false } : item) })} />{method.enabled ? method.is_default ? <span className="ppcc-default-badge">Default</span> : <button type="button" onClick={() => setDefaultMethod(method.id)}>Make default</button> : null}</article>)}</div>
    </section>

    <section className="ppcc-section" id="payment-accounts">
      <div className="ppcc-subhead"><div><h3>Payment Accounts</h3><p>Settlement details shown to customers when they choose a supported digital payment method.</p></div><SfButton type="button" variant="secondary" onClick={openNewAccount}>Add account</SfButton></div>
      {config.accounts.length === 0 ? <EmptySetup title="No payment accounts" detail="Add mobile-money or bank details for customer payment instructions." action="Add payment account" onClick={openNewAccount} /> : <div className="ppcc-account-grid">{config.accounts.map((account) => { const method = methodById.get(account.payment_method_id); const expanded = expandedAccountId === account.id; return <article key={account.id}><div className="ppcc-account-summary"><div><span>{method?.display_name ?? account.provider_code}</span><strong>{account.business_name || account.account_name || "Business account"}</strong><small>{accountIdentifierLabel(method?.method_code)} · {accountIdentifier(account)}</small></div><button type="button" aria-expanded={expanded} onClick={() => setExpandedAccountId(expanded ? null : account.id)}>{expanded ? "Close" : "Manage"}</button></div>{expanded ? <div className="ppcc-account-details"><p>{account.instructions || "No payment instructions added."}</p><div className="ppcc-account-actions"><button type="button" onClick={() => setAccountDraft(account)}>Edit</button><button type="button" onClick={() => setConfig({ ...config, accounts: config.accounts.map((item) => item.id === account.id ? { ...item, status: item.status === "active" ? "inactive" : "active" } : item) })}>{account.status === "active" ? "Disable" : "Enable"}</button><button type="button" className="danger" onClick={() => void deleteAccount(account)}>Delete</button></div></div> : null}</article>; })}</div>}
    </section>

    <section className="ppcc-section">
      <SectionHeader number="03" title="Order Charges" detail="Configure the percentage-based charges used by current order totals." />
      <div className="ppcc-financial-grid">
        <FinancialCard title="VAT" enabled={config.vatEnabled} editing={editingCharge === "vat"} onEdit={() => setEditingCharge(editingCharge === "vat" ? null : "vat")} onToggle={(enabled) => setConfig({ ...config, vatEnabled: enabled })}><Field label="Percentage"><input type="number" min="0" max="100" value={config.vatPercentage} disabled={!config.vatEnabled} onChange={(event) => setConfig({ ...config, vatPercentage: Number(event.target.value) })} /></Field></FinancialCard>
        <FinancialCard title="Service Charge" enabled={config.serviceChargeEnabled} editing={editingCharge === "service"} onEdit={() => setEditingCharge(editingCharge === "service" ? null : "service")} onToggle={(enabled) => setConfig({ ...config, serviceChargeEnabled: enabled })}><Field label="Percentage"><input type="number" min="0" max="100" value={config.serviceChargePercentage} disabled={!config.serviceChargeEnabled} onChange={(event) => setConfig({ ...config, serviceChargePercentage: Number(event.target.value) })} /></Field></FinancialCard>
      </div>
      <PaymentPreview businessName={businessName} currencySymbol={currencySymbol} methods={enabledMethods.map((method) => method.display_name)} open={previewOpen} onToggle={() => setPreviewOpen(!previewOpen)} />
    </section>

    {dirty ? <div className="ppcc-actions" role="status"><span>Unsaved changes</span><div><SfButton variant="secondary" onClick={discard} disabled={saving}>Discard</SfButton><SfButton onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save changes"}</SfButton></div></div> : null}
    <SfDialog open={Boolean(accountDraft)} title={accountDraft?.id && config.accounts.some((account) => account.id === accountDraft.id) ? "Edit payment account" : "Add payment account"} onClose={closeAccountEditor}>{accountDraft ? (() => { const method = methodById.get(accountDraft.payment_method_id); const code = method?.method_code; const usesPhone = code === "telebirr"; const identifier = usesPhone ? accountDraft.phone_number : accountDraft.account_number; return <div className="ppcc-account-form"><Field label="Payment Method" error={accountFormError?.startsWith("Select") ? accountFormError : undefined}><select value={accountDraft.payment_method_id} disabled={accountSaving} onChange={(event) => { const next = config.methods.find((item) => item.id === event.target.value); setAccountFormError(null); setAccountDraft({ ...accountDraft, payment_method_id: event.target.value, provider_code: providerForMethod(next?.method_code ?? ""), account_number: null, phone_number: null }); }}><option value="">Select payment method</option>{config.methods.filter((method) => supportsPaymentAccount(method.method_code)).map((method) => <option key={method.id} value={method.id}>{method.display_name}</option>)}</select></Field><Field label="Business Name"><input disabled={accountSaving} value={accountDraft.business_name ?? ""} onChange={(event) => setAccountDraft({ ...accountDraft, business_name: event.target.value })} /></Field><Field label="Account holder (optional)"><input disabled={accountSaving} value={accountDraft.account_name ?? ""} onChange={(event) => setAccountDraft({ ...accountDraft, account_name: event.target.value })} /></Field>{code ? <Field label={accountIdentifierLabel(code)} error={accountFormError?.startsWith("Enter") ? accountFormError : undefined}><input disabled={accountSaving} value={identifier ?? ""} onChange={(event) => { setAccountFormError(null); setAccountDraft({ ...accountDraft, account_number: usesPhone ? null : event.target.value, phone_number: usesPhone ? event.target.value : null }); }} /></Field> : <p className="ppcc-account-method-hint">Select a payment method to enter settlement details.</p>}<Field label="Instructions"><textarea disabled={accountSaving} rows={3} value={accountDraft.instructions ?? ""} onChange={(event) => setAccountDraft({ ...accountDraft, instructions: event.target.value })} /></Field>{accountFormError && !accountFormError.startsWith("Select") && !accountFormError.startsWith("Enter") ? <p className="ppcc-account-form-error" role="alert">{accountFormError}</p> : null}<div className="ppcc-dialog-actions"><SfButton variant="secondary" onClick={closeAccountEditor} disabled={accountSaving}>Cancel</SfButton><SfButton onClick={() => void commitAccount()} disabled={accountSaving}>{accountSaving ? "Saving…" : "Save account"}</SfButton></div></div>; })() : null}</SfDialog>
  </div>;
}

function SectionHeader({ number, title, detail }: { number: string; title: string; detail: string }) {
  return <header className="ppcc-section-head"><span>{number}</span><div><h2>{title}</h2><p>{detail}</p></div></header>;
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return <label className={`ppcc-field${error ? " invalid" : ""}`}><span>{label}</span>{children}{error ? <small role="alert">{error}</small> : null}</label>;
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="ppcc-toggle"><strong>{label}</strong><input className="od-switch" type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /></label>;
}

function EmptySetup({ title, detail, action, onClick }: { title: string; detail: string; action: string; onClick: () => void }) {
  return <div className="ppcc-empty"><span>+</span><h3>{title}</h3><p>{detail}</p><SfButton variant="secondary" onClick={onClick}>{action}</SfButton></div>;
}

function FinancialCard({ title, enabled, editing, onEdit, onToggle, children }: { title: string; enabled: boolean; editing: boolean; onEdit: () => void; onToggle: (enabled: boolean) => void; children: React.ReactNode }) {
  return <article className={`ppcc-financial-card ${enabled ? "enabled" : ""}`}><ToggleRow label={title} checked={enabled} onChange={onToggle} /><div className="ppcc-financial-summary"><span>{enabled ? "Enabled" : "Disabled"}</span><button type="button" onClick={onEdit}>{editing ? "Done" : "Edit"}</button></div>{editing ? <div>{children}</div> : null}</article>;
}

function PaymentPreview({ businessName, currencySymbol, methods, open, onToggle }: { businessName: string; currencySymbol: string; methods: string[]; open: boolean; onToggle: () => void }) {
  return <aside className="ppcc-payment-preview"><button className="ppcc-preview-toggle" type="button" aria-expanded={open} onClick={onToggle}><span>Customer payment preview</span><small>Sample only · {open ? "Hide" : "Show"}</small></button>{open ? <div><small>Sample payment options</small><h3>Pay {businessName}</h3><strong>{currencySymbol} 560.00</strong><p>Choose a payment method</p>{methods.length ? methods.slice(0, 4).map((method, index) => <button type="button" key={method} className={index === 0 ? "selected" : ""}>{method}{index === 0 ? <em>Default</em> : null}</button>) : <div className="ppcc-no-method">No payment methods enabled</div>}<footer>Available methods and account instructions are shown at checkout.</footer></div> : null}</aside>;
}
