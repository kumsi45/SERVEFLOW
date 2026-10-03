import { useEffect, useMemo, useRef, useState } from "react";
import { createSmartImagePublicUrl } from "../../../../core/presentation/smartImageDelivery";
import { supabase } from "../../../../core/database";
import { PrintingPaymentConfigurationCenter } from "./PrintingPaymentConfigurationCenter";

type JsonRecord = Record<string, unknown>;
export type OwnerSettingsConfig = { id: string; name: string; total_tables: number; profile: JsonRecord; business_hours: JsonRecord; branding: JsonRecord; currency_code: string; currency_symbol: string };
type Props = { restaurantId: string; fallbackRestaurantName: string; config: OwnerSettingsConfig | null; onSettingsChanged: () => Promise<void> };
type BusinessForm = { name: string; businessType: string; phone: string; email: string; address: string; description: string; timezone: string; currency: string; currencySymbol: string; opensAt: string; closesAt: string; closedDays: string[]; logoUrl: string; coverUrl: string };
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const CURRENCIES: Record<string, string> = { ETB: "Br", USD: "$", EUR: "€" };
const string = (data: JsonRecord, key: string, fallback = "") => typeof data[key] === "string" ? String(data[key]) : fallback;
const strings = (data: JsonRecord, key: string) => Array.isArray(data[key]) ? data[key].filter((value): value is string => typeof value === "string") : [];
function toForm(config: OwnerSettingsConfig | null, fallbackName: string): BusinessForm {
  return { name: config?.name ?? fallbackName, businessType: string(config?.profile ?? {}, "restaurant_type"), phone: string(config?.profile ?? {}, "phone"), email: string(config?.profile ?? {}, "email"), address: string(config?.profile ?? {}, "address"), description: string(config?.profile ?? {}, "description"), timezone: string(config?.profile ?? {}, "timezone", "Africa/Nairobi"), currency: config?.currency_code ?? "ETB", currencySymbol: config?.currency_symbol ?? "Br", opensAt: string(config?.business_hours ?? {}, "opens_at", "08:00"), closesAt: string(config?.business_hours ?? {}, "closes_at", "22:00"), closedDays: strings(config?.business_hours ?? {}, "closed_days"), logoUrl: string(config?.branding ?? {}, "logo_url"), coverUrl: string(config?.branding ?? {}, "cover_url") };
}
const assetPath = (restaurantId: string, type: "logo" | "cover") => `${restaurantId}/branding/${type}`;

export function OwnerSettingsPage({ restaurantId, fallbackRestaurantName, config, onSettingsChanged }: Props) {
  const [workspace, setWorkspace] = useState<"business" | "payments">("business");
  const [paymentsMounted, setPaymentsMounted] = useState(false);
  const persisted = useMemo(() => toForm(config, fallbackRestaurantName), [config, fallbackRestaurantName]);
  const [form, setForm] = useState(persisted);
  const [working, setWorking] = useState(false);
  const [uploading, setUploading] = useState<"logo" | "cover" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const activeRestaurantId = useRef(restaurantId);
  activeRestaurantId.current = restaurantId;
  const dirty = JSON.stringify(form) !== JSON.stringify(persisted);
  const profileDirty = JSON.stringify([form.name, form.phone, form.email, form.address, form.description]) !== JSON.stringify([persisted.name, persisted.phone, persisted.email, persisted.address, persisted.description]);
  const brandingDirty = JSON.stringify([form.logoUrl, form.coverUrl]) !== JSON.stringify([persisted.logoUrl, persisted.coverUrl]);
  const hoursDirty = JSON.stringify([form.opensAt, form.closesAt, form.closedDays]) !== JSON.stringify([persisted.opensAt, persisted.closesAt, persisted.closedDays]);
  const regionalDirty = JSON.stringify([form.currency, form.currencySymbol, form.timezone]) !== JSON.stringify([persisted.currency, persisted.currencySymbol, persisted.timezone]);

  useEffect(() => { setForm(persisted); }, [persisted]);
  useEffect(() => { setWorkspace("business"); setPaymentsMounted(false); setUploading(null); setError(null); setNotice(null); }, [restaurantId]);
  const set = <K extends keyof BusinessForm>(key: K, value: BusinessForm[K]) => setForm((current) => ({ ...current, [key]: value }));
  const toggleDay = (day: string) => setForm((current) => ({ ...current, closedDays: current.closedDays.includes(day) ? current.closedDays.filter((item) => item !== day) : [...current.closedDays, day] }));

  async function upload(type: "logo" | "cover", file: File | null) {
    if (!file) return;
    const targetRestaurantId = restaurantId;
    try {
      setUploading(type); setError(null); setNotice(null);
      if (!file.type.startsWith("image/")) throw new Error("Branding asset must be an image file.");
      if (file.size > 5 * 1024 * 1024) throw new Error("Branding asset must be 5 MB or smaller.");
      const path = assetPath(targetRestaurantId, type);
      const { error: uploadError } = await supabase.storage.from("menu-photos").upload(path, file, { cacheControl: "0", upsert: true, contentType: file.type });
      if (uploadError) throw new Error(uploadError.message);
      if (activeRestaurantId.current !== targetRestaurantId) return;
      set(type === "logo" ? "logoUrl" : "coverUrl", createSmartImagePublicUrl("menu-photos", path));
    } catch (cause) {
      if (activeRestaurantId.current === targetRestaurantId) setError(cause instanceof Error ? cause.message : "Could not upload branding asset.");
    } finally { if (activeRestaurantId.current === targetRestaurantId) setUploading(null); }
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!config || !dirty) return;
    try {
      setWorking(true); setError(null); setNotice(null);
      const currencyCode = form.currency.trim().toUpperCase();
      if (!form.name.trim()) throw new Error("Business name is required.");
      if (!form.timezone.trim()) throw new Error("Timezone is required.");
      if (!/^[A-Z]{3}$/.test(currencyCode)) throw new Error("Currency code must be a 3-letter ISO code.");
      const { error: configurationError } = await supabase.rpc("update_restaurant_configuration", {
        target_restaurant_id: restaurantId, restaurant_name: form.name.trim(), requested_total_tables: config.total_tables,
        profile_payload: { phone: form.phone.trim(), email: form.email.trim(), address: form.address.trim(), description: form.description.trim(), timezone: form.timezone.trim(), currency: currencyCode },
        business_hours_payload: { version: 1, opens_at: form.opensAt, closes_at: form.closesAt, closed_days: form.closedDays, schedules: [{ name: "Default", opens_at: form.opensAt, closes_at: form.closesAt, closed_days: form.closedDays }] },
        kitchen_settings_payload: {}, ordering_settings_payload: {}, branding_payload: { logo_url: form.logoUrl.trim(), cover_url: form.coverUrl.trim() }, notification_settings_payload: {}, security_settings_payload: {},
      });
      if (configurationError) throw new Error(configurationError.message);
      const { error: regionalError } = await supabase.from("restaurants").update({ currency_code: currencyCode, currency_symbol: form.currencySymbol }).eq("id", restaurantId);
      if (regionalError) throw new Error(regionalError.message);
      await onSettingsChanged(); setNotice("Business settings saved.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save business settings."); } finally { setWorking(false); }
  }
  function discard() { setForm(persisted); setError(null); setNotice(null); }

  if (!config) return <div className="od-page od-config-page"><div className="od-card"><div className="od-empty compact">Loading settings...</div></div></div>;
  return <div className="od-page od-config-page">
    {(error || notice) ? <div className={error ? "od-error-inline" : "od-success-inline"} role={error ? "alert" : "status"}>{error || notice}</div> : null}
    <nav className="od-settings-workspaces" aria-label="Business settings areas">
      <Workspace active={workspace === "business"} letter="B" title="Business Settings" detail="Profile, hours and regional preferences" onClick={() => setWorkspace("business")} />
      <Workspace active={workspace === "payments"} letter="P" title="Payments" detail="Checkout methods, accounts and charges" onClick={() => { setPaymentsMounted(true); setWorkspace("payments"); }} />
    </nav>
    <form className={`od-config-center ${workspace !== "business" ? "workspace-hidden" : ""}`} onSubmit={save}>
      <div className="od-config-sections">
        <Section dirty={profileDirty} number="01" title="Business Profile" detail="The information customers and staff use to recognize your business." id="business-profile-title"><div className="od-settings-grid"><label>Business Name<input value={form.name} onChange={(event) => set("name", event.target.value)} disabled={working} /></label><ReadOnlyBusinessType value={form.businessType} /><label className="wide">Business Description<textarea value={form.description} onChange={(event) => set("description", event.target.value)} disabled={working} /></label><label className="wide">Address<input value={form.address} onChange={(event) => set("address", event.target.value)} disabled={working} /></label><label>Phone<input type="tel" value={form.phone} onChange={(event) => set("phone", event.target.value)} disabled={working} /></label><label>Email<input type="email" value={form.email} onChange={(event) => set("email", event.target.value)} disabled={working} /></label></div><DirtyActions dirty={profileDirty} working={working} onDiscard={discard} /></Section>
        <Section dirty={brandingDirty} number="02" title="Branding" detail="Use images customers can recognize at a glance." id="branding-title"><div className="od-config-media-grid"><Media type="logo" value={form.logoUrl} uploading={uploading === "logo"} disabled={working || uploading !== null} onChange={(file) => void upload("logo", file)} /><Media type="cover" value={form.coverUrl} uploading={uploading === "cover"} disabled={working || uploading !== null} onChange={(file) => void upload("cover", file)} /></div><DirtyActions dirty={brandingDirty} working={working} onDiscard={discard} /></Section>
        <Section dirty={hoursDirty} number="03" title="Business Hours" detail="Set the standard service window and closed days." id="business-hours-title"><div className="od-settings-grid compact"><label>Opening time<input type="time" value={form.opensAt} onChange={(event) => set("opensAt", event.target.value)} disabled={working} /></label><label>Closing time<input type="time" value={form.closesAt} onChange={(event) => set("closesAt", event.target.value)} disabled={working} /></label></div><fieldset className="od-day-fieldset"><legend>Operating days</legend><div className="od-day-pills">{DAYS.map((day) => <label key={day} className={form.closedDays.includes(day) ? "closed" : ""}><input type="checkbox" checked={form.closedDays.includes(day)} onChange={() => toggleDay(day)} disabled={working} /><span>{day.slice(0, 3)}</span><small>{form.closedDays.includes(day) ? "Closed" : "Open"}</small></label>)}</div></fieldset><DirtyActions dirty={hoursDirty} working={working} onDiscard={discard} /></Section>
        <Section dirty={regionalDirty} number="04" title="Regional Settings" detail="Choose the currency and time zone used for this business." id="regional-settings-title"><div className="od-settings-grid compact"><label>Currency<select value={form.currency} onChange={(event) => { const currency = event.target.value; setForm((current) => ({ ...current, currency, currencySymbol: CURRENCIES[currency] ?? current.currencySymbol })); }} disabled={working}><option value="ETB">ETB — Ethiopian Birr</option><option value="USD">USD — US Dollar</option><option value="EUR">EUR — Euro</option></select></label><label>Time Zone<input value={form.timezone} onChange={(event) => set("timezone", event.target.value)} disabled={working} /></label></div><DirtyActions dirty={regionalDirty} working={working} onDiscard={discard} /></Section>
      </div>
    </form>
    {paymentsMounted ? <div hidden={workspace !== "payments"}><PrintingPaymentConfigurationCenter key={restaurantId} restaurantId={restaurantId} businessName={form.name || fallbackRestaurantName} currencySymbol={form.currencySymbol} /></div> : null}
  </div>;
}
function Workspace({ active, letter, title, detail, onClick }: { active: boolean; letter: string; title: string; detail: string; onClick: () => void }) { return <button type="button" className={active ? "active" : ""} aria-current={active ? "page" : undefined} onClick={onClick}><span>{letter}</span><div><strong>{title}</strong><small>{detail}</small></div></button>; }
function Section({ dirty, number, title, detail, id, children }: { dirty: boolean; number: string; title: string; detail: string; id: string; children: React.ReactNode }) { return <section className={`od-config-section ${dirty ? "is-dirty" : ""}`} aria-labelledby={id}><div className="od-config-content"><div className="od-config-subhead"><span>{number}</span><div><h2 id={id}>{title}</h2><p>{detail}</p></div>{dirty ? <small className="od-dirty-indicator">Unsaved changes</small> : null}</div>{children}</div></section>; }
function DirtyActions({ dirty, working, onDiscard }: { dirty: boolean; working: boolean; onDiscard: () => void }) { return dirty ? <div className="od-config-actions"><button className="od-btn-ghost" type="button" onClick={onDiscard} disabled={working}>Discard</button><button className="od-btn-primary" type="submit" disabled={working}>{working ? "Saving…" : "Save changes"}</button></div> : null; }
function ReadOnlyBusinessType({ value }: { value: string }) { return <div className="od-readonly-field"><span>Business Type</span><strong>{value || "Not configured"}</strong><small>{value ? "Selected when your business was created." : "This business type was not provided during setup."}</small></div>; }
function Media({ type, value, uploading, disabled, onChange }: { type: "logo" | "cover"; value: string; uploading: boolean; disabled: boolean; onChange: (file: File | null) => void }) { const logo = type === "logo"; const label = logo ? "business logo" : "business cover image"; return <label className={`od-media-upload ${logo ? "" : "cover"}`}><span className={`od-media-preview ${logo ? "logo" : "cover"}`}>{value ? <img src={value} alt={`Current ${label}`} /> : <b aria-hidden="true">{logo ? "Logo" : "Cover image"}</b>}</span><span className="od-media-copy"><strong>{logo ? "Business logo" : "Cover image"}</strong><small>{logo ? "Square" : "Wide"} PNG, JPG or WebP, up to 5 MB</small></span><span className="od-media-action">{uploading ? "Uploading…" : value ? `Replace ${logo ? "logo" : "cover"}` : `Upload ${logo ? "logo" : "cover"}`}</span><input className="od-visually-hidden" type="file" accept="image/png,image/jpeg,image/webp" aria-label={`Upload ${label}`} onChange={(event) => onChange(event.target.files?.[0] ?? null)} disabled={disabled} /></label>; }
