import { useEffect, useMemo, useState } from "react";
import { SfButton, SfDialog, SfErrorState, SfSkeleton } from "../design-system";
import {
  loadPaymentConfiguration,
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

export function PrintingPaymentConfigurationCenter({ restaurantId, businessName, currencySymbol }: Props) {
  const [config, setConfig] = useState<PaymentConfiguration | null>(null);
  const [savedConfig, setSavedConfig] = useState<PaymentConfiguration | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [accountDraft, setAccountDraft] = useState<BusinessPaymentAccount | null>(null);

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
    const method = config.methods.find((item) => item.enabled && item.method_code !== "cash")
      ?? config.methods.find((item) => item.method_code !== "cash");
    if (!method) {
      setError("Enable a digital payment method before adding an account.");
      return;
    }
    setAccountDraft({
      id: crypto.randomUUID(),
      restaurant_id: restaurantId,
      payment_method_id: method.id,
      provider_code: providerForMethod(method.method_code),
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

  function commitAccount() {
    if (!config || !accountDraft) return;
    if (!accountDraft.account_number?.trim() && !accountDraft.phone_number?.trim()) {
      setError("Add an account number or phone number.");
      return;
    }
    setConfig({
      ...config,
      accounts: [...config.accounts.filter((account) => account.id !== accountDraft.id), accountDraft],
    });
    setAccountDraft(null);
    setError(null);
  }

  async function deleteAccount(account: BusinessPaymentAccount) {
    try {
      await softDeletePaymentAccount(restaurantId, account.id);
      setConfig((current) => current ? {
        ...current,
        accounts: current.accounts.filter((item) => item.id !== account.id),
      } : current);
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
      <SectionHeader number="01" title="Payment Policy" detail="Choose when an order becomes eligible for kitchen preparation." />
      <div className="ppcc-policy-grid">{([
        { value: "pay_before_kitchen", title: "Customer Pays Before Kitchen", detail: "Payment is required before preparation starts." },
        { value: "kitchen_before_payment", title: "Waiter Payment Due", detail: "A waiter places the order and payment remains due." },
      ] as Array<{ value: PaymentPolicyCode; title: string; detail: string }>).map((policy) => <label className={config.paymentPolicy === policy.value ? "selected" : ""} key={policy.value}><input type="radio" name="payment-policy" checked={config.paymentPolicy === policy.value} onChange={() => setConfig({ ...config, paymentPolicy: policy.value })} /><strong>{policy.title}</strong><small>{policy.detail}</small></label>)}</div>
    </section>

    <section className="ppcc-section">
      <SectionHeader number="02" title="Payment Methods" detail="Enable the methods customers can use and choose one default." />
      <div className="ppcc-method-grid">{config.methods.map((method) => <article className={method.enabled ? "enabled" : ""} key={method.id}><div><span>{method.display_name.slice(0, 2).toUpperCase()}</span><div><strong>{method.display_name}</strong><small>{method.is_default ? "Default payment method" : method.enabled ? "Available at checkout" : "Disabled"}</small></div></div><input className="od-switch" type="checkbox" checked={method.enabled} aria-label={`Enable ${method.display_name}`} onChange={(event) => setConfig({ ...config, methods: config.methods.map((item) => item.id === method.id ? { ...item, enabled: event.target.checked, is_default: event.target.checked ? item.is_default : false } : item) })} />{method.enabled ? <button type="button" className={method.is_default ? "default" : ""} onClick={() => setDefaultMethod(method.id)}>{method.is_default ? "Default" : "Make default"}</button> : null}</article>)}</div>
    </section>

    <section className="ppcc-section" id="payment-accounts">
      <div className="ppcc-subhead"><div><h3>Payment Accounts</h3><p>Settlement details shown to customers when they choose a supported digital payment method.</p></div><SfButton variant="secondary" onClick={openNewAccount}>Add account</SfButton></div>
      {config.accounts.length === 0 ? <EmptySetup title="No payment accounts" detail="Add mobile-money or bank details for customer payment instructions." action="Add payment account" onClick={openNewAccount} /> : <div className="ppcc-account-grid">{config.accounts.map((account) => <article key={account.id}><div className="ppcc-account-head"><span>{methodById.get(account.payment_method_id)?.display_name ?? account.provider_code}</span><strong>{account.business_name || account.account_name || "Business account"}</strong><small>{account.status}</small></div><dl><div><dt>Account</dt><dd>{account.account_number || account.phone_number}</dd></div><div><dt>Instructions</dt><dd>{account.instructions || "No instructions"}</dd></div></dl><div className="ppcc-account-actions"><button type="button" onClick={() => setAccountDraft(account)}>Edit</button><button type="button" onClick={() => setConfig({ ...config, accounts: config.accounts.map((item) => item.id === account.id ? { ...item, status: item.status === "active" ? "inactive" : "active" } : item) })}>{account.status === "active" ? "Disable" : "Enable"}</button><button type="button" className="danger" onClick={() => void deleteAccount(account)}>Delete</button></div></article>)}</div>}
    </section>

    <section className="ppcc-section">
      <SectionHeader number="03" title="Order Charges" detail="Configure the percentage-based charges used by current order totals." />
      <div className="ppcc-financial-grid">
        <FinancialCard title="VAT" enabled={config.vatEnabled} onToggle={(enabled) => setConfig({ ...config, vatEnabled: enabled })}><Field label="Percentage"><input type="number" min="0" max="100" value={config.vatPercentage} disabled={!config.vatEnabled} onChange={(event) => setConfig({ ...config, vatPercentage: Number(event.target.value) })} /></Field></FinancialCard>
        <FinancialCard title="Service Charge" enabled={config.serviceChargeEnabled} onToggle={(enabled) => setConfig({ ...config, serviceChargeEnabled: enabled })}><Field label="Percentage"><input type="number" min="0" max="100" value={config.serviceChargePercentage} disabled={!config.serviceChargeEnabled} onChange={(event) => setConfig({ ...config, serviceChargePercentage: Number(event.target.value) })} /></Field></FinancialCard>
      </div>
      <PaymentPreview businessName={businessName} currencySymbol={currencySymbol} methods={enabledMethods.map((method) => method.display_name)} />
    </section>

    {dirty ? <div className="ppcc-actions" role="status"><span>Unsaved changes</span><div><SfButton variant="secondary" onClick={discard} disabled={saving}>Discard</SfButton><SfButton onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save changes"}</SfButton></div></div> : null}
    <SfDialog open={Boolean(accountDraft)} title={accountDraft?.id && config.accounts.some((account) => account.id === accountDraft.id) ? "Edit payment account" : "Add payment account"} onClose={() => setAccountDraft(null)}>{accountDraft ? <div className="ppcc-account-form"><Field label="Payment Method"><select value={accountDraft.payment_method_id} onChange={(event) => { const method = config.methods.find((item) => item.id === event.target.value); setAccountDraft({ ...accountDraft, payment_method_id: event.target.value, provider_code: providerForMethod(method?.method_code ?? "") }); }}>{config.methods.filter((method) => method.method_code !== "cash").map((method) => <option key={method.id} value={method.id}>{method.display_name}</option>)}</select></Field><Field label="Business Name"><input value={accountDraft.business_name ?? ""} onChange={(event) => setAccountDraft({ ...accountDraft, business_name: event.target.value })} /></Field><Field label="Account Name"><input value={accountDraft.account_name ?? ""} onChange={(event) => setAccountDraft({ ...accountDraft, account_name: event.target.value })} /></Field><Field label="Account Number"><input value={accountDraft.account_number ?? ""} onChange={(event) => setAccountDraft({ ...accountDraft, account_number: event.target.value })} /></Field><Field label="Phone Number"><input value={accountDraft.phone_number ?? ""} onChange={(event) => setAccountDraft({ ...accountDraft, phone_number: event.target.value })} /></Field><Field label="Instructions"><textarea rows={3} value={accountDraft.instructions ?? ""} onChange={(event) => setAccountDraft({ ...accountDraft, instructions: event.target.value })} /></Field><div className="ppcc-dialog-actions"><SfButton variant="secondary" onClick={() => setAccountDraft(null)}>Cancel</SfButton><SfButton onClick={commitAccount}>Save account</SfButton></div></div> : null}</SfDialog>
  </div>;
}

function SectionHeader({ number, title, detail }: { number: string; title: string; detail: string }) {
  return <header className="ppcc-section-head"><span>{number}</span><div><h2>{title}</h2><p>{detail}</p></div></header>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="ppcc-field"><span>{label}</span>{children}</label>;
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="ppcc-toggle"><strong>{label}</strong><input className="od-switch" type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /></label>;
}

function EmptySetup({ title, detail, action, onClick }: { title: string; detail: string; action: string; onClick: () => void }) {
  return <div className="ppcc-empty"><span>+</span><h3>{title}</h3><p>{detail}</p><SfButton variant="secondary" onClick={onClick}>{action}</SfButton></div>;
}

function FinancialCard({ title, enabled, onToggle, children }: { title: string; enabled: boolean; onToggle: (enabled: boolean) => void; children: React.ReactNode }) {
  return <article className={`ppcc-financial-card ${enabled ? "enabled" : ""}`}><ToggleRow label={title} checked={enabled} onChange={onToggle} /><div>{children}</div></article>;
}

function PaymentPreview({ businessName, currencySymbol, methods }: { businessName: string; currencySymbol: string; methods: string[] }) {
  return <aside className="ppcc-payment-preview"><span>Customer Payment Preview</span><div><small>Payment options</small><h3>Pay {businessName}</h3><strong>{currencySymbol} 560.00</strong><p>Choose a payment method</p>{methods.length ? methods.slice(0, 4).map((method, index) => <button type="button" key={method} className={index === 0 ? "selected" : ""}>{method}{index === 0 ? <em>Default</em> : null}</button>) : <div className="ppcc-no-method">No payment methods enabled</div>}<footer>Available methods and account instructions are shown at checkout.</footer></div></aside>;
}
