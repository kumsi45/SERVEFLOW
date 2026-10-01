import { useEffect, useState } from "react";
import { createSmartImagePublicUrl } from "../../../../core/presentation/smartImageDelivery";
import { supabase } from "../../../../core/database";
import { PrintingPaymentConfigurationCenter } from "./PrintingPaymentConfigurationCenter";

type JsonRecord = Record<string, unknown>;

export type OwnerSettingsConfig = {
  id: string;
  name: string;
  total_tables: number;
  profile: JsonRecord;
  business_hours: JsonRecord;
  branding: JsonRecord;
  currency_code: string;
  currency_symbol: string;
};

type Props = {
  restaurantId: string;
  fallbackRestaurantName: string;
  config: OwnerSettingsConfig | null;
  onSettingsChanged: () => Promise<void>;
};

type BusinessForm = {
  name: string;
  businessType: string;
  phone: string;
  email: string;
  address: string;
  description: string;
  timezone: string;
  currency: string;
  currencySymbol: string;
  opensAt: string;
  closesAt: string;
  closedDays: string[];
  logoUrl: string;
  coverUrl: string;
};

const BUSINESS_DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const CURRENCIES: Record<string, string> = { ETB: "Br", USD: "$", EUR: "€" };

function jsonString(value: JsonRecord, key: string, fallback = "") {
  return typeof value[key] === "string" ? String(value[key]) : fallback;
}

function jsonStringArray(value: JsonRecord, key: string) {
  return Array.isArray(value[key])
    ? value[key].filter((entry): entry is string => typeof entry === "string")
    : [];
}

function toBusinessForm(config: OwnerSettingsConfig | null, fallbackName: string): BusinessForm {
  return {
    name: config?.name ?? fallbackName,
    businessType: jsonString(config?.profile ?? {}, "restaurant_type", "Restaurant"),
    phone: jsonString(config?.profile ?? {}, "phone"),
    email: jsonString(config?.profile ?? {}, "email"),
    address: jsonString(config?.profile ?? {}, "address"),
    description: jsonString(config?.profile ?? {}, "description"),
    timezone: jsonString(config?.profile ?? {}, "timezone", "Africa/Nairobi"),
    currency: config?.currency_code ?? "ETB",
    currencySymbol: config?.currency_symbol ?? "Br",
    opensAt: jsonString(config?.business_hours ?? {}, "opens_at", "08:00"),
    closesAt: jsonString(config?.business_hours ?? {}, "closes_at", "22:00"),
    closedDays: jsonStringArray(config?.business_hours ?? {}, "closed_days"),
    logoUrl: jsonString(config?.branding ?? {}, "logo_url"),
    coverUrl: jsonString(config?.branding ?? {}, "cover_url"),
  };
}

function brandingAssetPath(restaurantId: string, assetType: "logo" | "cover") {
  return `${restaurantId}/branding/${assetType}`;
}

export function OwnerSettingsPage({ restaurantId, fallbackRestaurantName, config, onSettingsChanged }: Props) {
  const [workspace, setWorkspace] = useState<"business" | "payments">("business");
  const [paymentsMounted, setPaymentsMounted] = useState(false);
  const [form, setForm] = useState(() => toBusinessForm(config, fallbackRestaurantName));
  const [working, setWorking] = useState(false);
  const [assetUploading, setAssetUploading] = useState<"logo" | "cover" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setForm(toBusinessForm(config, fallbackRestaurantName));
  }, [config, fallbackRestaurantName]);

  useEffect(() => {
    setWorkspace("business");
    setPaymentsMounted(false);
  }, [restaurantId]);

  function updateField<K extends keyof BusinessForm>(key: K, value: BusinessForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function toggleClosedDay(day: string) {
    setForm((current) => ({
      ...current,
      closedDays: current.closedDays.includes(day)
        ? current.closedDays.filter((entry) => entry !== day)
        : [...current.closedDays, day],
    }));
  }

  function openPayments() {
    setPaymentsMounted(true);
    setWorkspace("payments");
  }

  async function uploadBrandingAsset(assetType: "logo" | "cover", file: File | null) {
    if (!file) return;
    try {
      setAssetUploading(assetType);
      setError(null);
      setNotice(null);
      if (!file.type.startsWith("image/")) throw new Error("Branding asset must be an image file.");
      if (file.size > 5 * 1024 * 1024) throw new Error("Branding asset must be 5 MB or smaller.");
      const path = brandingAssetPath(restaurantId, assetType);
      const { error: uploadError } = await supabase.storage.from("menu-photos").upload(path, file, {
        cacheControl: "0",
        upsert: true,
        contentType: file.type,
      });
      if (uploadError) throw new Error(uploadError.message);
      updateField(assetType === "logo" ? "logoUrl" : "coverUrl", createSmartImagePublicUrl("menu-photos", path));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not upload branding asset.");
    } finally {
      setAssetUploading(null);
    }
  }

  async function saveBusiness(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!config) return;
    try {
      setWorking(true);
      setError(null);
      setNotice(null);
      const currencyCode = form.currency.trim().toUpperCase();
      if (!form.name.trim()) throw new Error("Business name is required.");
      if (!form.timezone.trim()) throw new Error("Timezone is required.");
      if (!/^[A-Z]{3}$/.test(currencyCode)) throw new Error("Currency code must be a 3-letter ISO code.");

      const { error: configurationError } = await supabase.rpc("update_restaurant_configuration", {
        target_restaurant_id: restaurantId,
        restaurant_name: form.name.trim(),
        requested_total_tables: config.total_tables,
        profile_payload: {
          phone: form.phone.trim(),
          email: form.email.trim(),
          address: form.address.trim(),
          description: form.description.trim(),
          restaurant_type: form.businessType,
          timezone: form.timezone.trim(),
          currency: currencyCode,
        },
        business_hours_payload: {
          version: 1,
          opens_at: form.opensAt,
          closes_at: form.closesAt,
          closed_days: form.closedDays,
          schedules: [{ name: "Default", opens_at: form.opensAt, closes_at: form.closesAt, closed_days: form.closedDays }],
        },
        kitchen_settings_payload: {},
        ordering_settings_payload: {},
        branding_payload: { logo_url: form.logoUrl.trim(), cover_url: form.coverUrl.trim() },
        notification_settings_payload: {},
        security_settings_payload: {},
      });
      if (configurationError) throw new Error(configurationError.message);

      const { error: regionalError } = await supabase.from("restaurants").update({
        currency_code: currencyCode,
        currency_symbol: form.currencySymbol,
      }).eq("id", restaurantId);
      if (regionalError) throw new Error(regionalError.message);

      await onSettingsChanged();
      setNotice("Business settings saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save business settings.");
    } finally {
      setWorking(false);
    }
  }

  function discardBusinessChanges() {
    setForm(toBusinessForm(config, fallbackRestaurantName));
    setError(null);
    setNotice(null);
  }

  return <div className="od-page od-config-page">
    <div className="od-page-header od-config-header"><div><span className="od-config-eyebrow">Owner settings</span><h1 className="od-page-title">Business Configuration Center</h1><p className="od-page-subtitle">Manage your business profile and customer payment options.</p></div></div>
    {!config ? <div className="od-card"><div className="od-empty compact">Loading settings...</div></div> : null}
    {(error || notice) ? <div className={error ? "od-error-inline" : "od-success-inline"}>{error || notice}</div> : null}

    <nav className="od-settings-workspaces" aria-label="Business settings areas">
      <button type="button" className={workspace === "business" ? "active" : ""} onClick={() => setWorkspace("business")}><span>B</span><div><strong>Business Settings</strong><small>Profile, hours and regional preferences</small></div></button>
      <button type="button" className={workspace === "payments" ? "active" : ""} onClick={openPayments}><span>P</span><div><strong>Payments</strong><small>Checkout methods, accounts and charges</small></div></button>
    </nav>

    <form className={`od-config-center ${workspace !== "business" ? "workspace-hidden" : ""}`} onSubmit={saveBusiness}>
      <div className="od-config-toolbar"><div><strong>Business essentials</strong><span>Profile, service hours and regional settings</span></div><div><button className="od-btn-ghost" type="button" onClick={discardBusinessChanges} disabled={working}>Discard</button><button className="od-btn-primary" type="submit" disabled={working || !config}>{working ? "Saving…" : "Save changes"}</button></div></div>
      <div className="od-config-sections">
        <details className="od-config-section" open>
          <summary><span className="od-config-icon" aria-hidden="true">B</span><div><strong>Business</strong><small>Identity, contact details, hours, branding and regional preferences</small></div><span className="od-config-chevron" aria-hidden="true">⌄</span></summary>
          <div className="od-config-content">
            <div className="od-config-subhead"><h3>Business profile</h3><p>The information customers and staff use to recognize your business.</p></div>
            <div className="od-settings-grid">
              <label>Business Name<input value={form.name} onChange={(event) => updateField("name", event.target.value)} disabled={working} /></label>
              <label>Business Type<select value={form.businessType} onChange={(event) => updateField("businessType", event.target.value)} disabled={working}>{["Cafe", "Restaurant", "Hotel", "Fast Food", "Bar", "Lounge", "Bakery", "Food Business"].map((type) => <option value={type} key={type}>{type}</option>)}</select></label>
              <label>Phone<input type="tel" value={form.phone} onChange={(event) => updateField("phone", event.target.value)} disabled={working} /></label>
              <label>Email<input type="email" value={form.email} onChange={(event) => updateField("email", event.target.value)} disabled={working} /></label>
              <label className="wide">Business Description<textarea value={form.description} onChange={(event) => updateField("description", event.target.value)} disabled={working} /></label>
              <label className="wide">Address<input value={form.address} onChange={(event) => updateField("address", event.target.value)} disabled={working} /></label>
            </div>
            <div className="od-config-media-grid">
              <label className="od-media-upload"><span>{form.logoUrl ? "Logo ready" : "Add business logo"}</span><small>Square image recommended</small><input type="file" accept="image/*" onChange={(event) => void uploadBrandingAsset("logo", event.target.files?.[0] ?? null)} disabled={working || assetUploading !== null} /></label>
              <label className="od-media-upload cover"><span>{form.coverUrl ? "Cover ready" : "Add cover image"}</span><small>Wide image recommended</small><input type="file" accept="image/*" onChange={(event) => void uploadBrandingAsset("cover", event.target.files?.[0] ?? null)} disabled={working || assetUploading !== null} /></label>
            </div>
            <div className="od-config-divider" />
            <div className="od-config-subhead"><h3>Business hours</h3><p>Set the standard service window and closed days.</p></div>
            <div className="od-settings-grid compact"><label>Opens At<input type="time" value={form.opensAt} onChange={(event) => updateField("opensAt", event.target.value)} disabled={working} /></label><label>Closes At<input type="time" value={form.closesAt} onChange={(event) => updateField("closesAt", event.target.value)} disabled={working} /></label></div>
            <div className="od-day-pills">{BUSINESS_DAYS.map((day) => <label key={day} className={form.closedDays.includes(day) ? "closed" : ""}><input type="checkbox" checked={form.closedDays.includes(day)} onChange={() => toggleClosedDay(day)} disabled={working} /><span>{day.slice(0, 3)}</span><small>{form.closedDays.includes(day) ? "Closed" : "Open"}</small></label>)}</div>
            <div className="od-config-divider" />
            <div className="od-settings-grid compact"><label>Currency<select value={form.currency} onChange={(event) => { const currency = event.target.value; setForm((current) => ({ ...current, currency, currencySymbol: CURRENCIES[currency] ?? current.currencySymbol })); }} disabled={working}><option value="ETB">ETB — Ethiopian Birr</option><option value="USD">USD — US Dollar</option><option value="EUR">EUR — Euro</option></select></label><label>Time Zone<input value={form.timezone} onChange={(event) => updateField("timezone", event.target.value)} disabled={working} /></label></div>
          </div>
        </details>
      </div>
    </form>

    {paymentsMounted ? <div hidden={workspace !== "payments"}><PrintingPaymentConfigurationCenter key={restaurantId} restaurantId={restaurantId} businessName={form.name || fallbackRestaurantName} currencySymbol={form.currencySymbol} /></div> : null}
  </div>;
}
