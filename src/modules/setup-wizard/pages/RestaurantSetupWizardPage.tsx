import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { supabase } from "../../../core/database";
import "./restaurantSetupWizard.css";

type RestaurantType =
  | "Ethiopian Restaurant"
  | "International Restaurant"
  | "Cafe"
  | "Hotel Restaurant"
  | "Fast Food"
  | "Bakery"
  | "Juice Bar"
  | "Fine Dining"
  | "Mixed Restaurant";
type KitchenMode = "single" | "advanced" | "skipped";
type InviteRole = "owner" | "cashier" | "kitchen" | "waiter" | "manager";

type SetupWizardProps = {
  restaurantId: string;
  restaurantName: string;
  onFinished: () => void;
};

type ExistingTable = {
  id: string;
  table_number: number;
  label: string;
  qr_path: string;
  qr_url: string | null;
  active: boolean;
};

type StarterTemplateItem = {
  name: string;
  description: string;
  ingredients?: string[] | null;
  allergens?: string[] | null;
  preparation_time_minutes: number;
  spice_level?: number | null;
  dietary_tags?: string[] | null;
  calories?: number | null;
  protein_g?: number | null;
  carbohydrates_g?: number | null;
  fat_g?: number | null;
  fiber_g?: number | null;
  sugar_g?: number | null;
  sodium_mg?: number | null;
  suggested_station: "main" | "beverage";
};

type StarterTemplateCategory = {
  name: string;
  description: string;
  hero_image_url?: string | null;
  items: StarterTemplateItem[];
};

type StarterTemplate = {
  template_key: string;
  restaurant_type: string;
  name: string;
  description: string;
  categories: StarterTemplateCategory[];
};

type InviteDraft = {
  name: string;
  email: string;
  role: InviteRole;
};

type BrandingAssetType = "logo" | "cover";

const RESTAURANT_TYPES: RestaurantType[] = [
  "Ethiopian Restaurant",
  "International Restaurant",
  "Cafe",
  "Hotel Restaurant",
  "Fast Food",
  "Bakery",
  "Juice Bar",
  "Fine Dining",
  "Mixed Restaurant",
];
const TABLE_PRESETS = [10, 20, 30, 40, 50] as const;
const CUSTOM_TABLES = [75, 120, 150] as const;
const WEEK_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const INVITE_ROLES: InviteRole[] = ["cashier", "kitchen", "waiter", "manager"];

const STEPS = [
  "Restaurant",
  "Starter Templates",
  "Branding",
  "Select Tables",
  "Hours",
  "Kitchen",
  "Staff",
  "Menu Publishing",
] as const;

const FINAL_STEP = STEPS.length - 1;

function getOrderingUrl(table: ExistingTable) {
  const qrUrl = table.qr_url?.trim() ?? "";
  if (!qrUrl) return "";
  try {
    const url = new URL(qrUrl);
    return `${url.origin}${url.pathname}${url.search}`;
  } catch {
    return "";
  }
}

function logSetupQrDiagnostic(stage: string, context: Record<string, unknown>) {
  const viteEnv = import.meta.env as unknown as { DEV?: boolean };
  if (!viteEnv.DEV) return;
  console.debug("[ServeFlow QR]", stage, context);
}

function safeFilename(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "serveflow";
}

function getDraftStorageKey(restaurantId: string) {
  return `serveflow:setup-wizard:${restaurantId}`;
}

function buildBrandingAssetPath(restaurantId: string, assetType: BrandingAssetType) {
  return `${restaurantId}/branding/${assetType}`;
}

function readJsonRecord(value: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function buildQrPdf(tables: ExistingTable[], restaurantName: string) {
  const cards = await Promise.all(tables.map(async (table) => {
    const orderingUrl = getOrderingUrl(table);
    if (!orderingUrl) {
      throw new Error("QR base URL is not configured. Set the Application URL before generating QR codes.");
    }
    logSetupQrDiagnostic("setupWizard:generatedQrUrl", {
      generatedQrUrl: orderingUrl,
      currentAppUrl: new URL(orderingUrl).origin,
      tableNumber: table.table_number,
    });
    const qr = await QRCode.toDataURL(orderingUrl, { width: 220, margin: 1 });
    return `<section><h1>${restaurantName}</h1><h2>Table ${table.table_number}</h2><img src="${qr}" /><p>Scan to Order</p></section>`;
  }));
  const html = `<!doctype html><html><head><meta charset="utf-8" /><style>
body{font-family:Arial,sans-serif;margin:0;padding:24px;display:grid;grid-template-columns:repeat(2,1fr);gap:18px}
section{border:1px solid #d8dee8;border-radius:12px;padding:22px;text-align:center;break-inside:avoid}
h1{font-size:20px;margin:0 0 6px}h2{font-size:15px;color:#64748b;margin:0 0 14px}img{width:220px;height:220px}p{font-weight:800}
</style></head><body>${cards.join("")}</body></html>`;
  return new Blob([html], { type: "application/pdf" });
}

export function RestaurantSetupWizardPage({ restaurantId, restaurantName, onFinished }: SetupWizardProps) {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [assetUploading, setAssetUploading] = useState<BrandingAssetType | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState("");
  const [coverPreviewUrl, setCoverPreviewUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [tables, setTables] = useState<ExistingTable[]>([]);
  const [generatedTables, setGeneratedTables] = useState<ExistingTable[]>([]);
  const [restaurantInfo, setRestaurantInfo] = useState({
    restaurantName,
    restaurantType: "Mixed Restaurant" as RestaurantType,
    phone: "",
    address: "",
    description: "",
  });
  const [starterTemplates, setStarterTemplates] = useState<StarterTemplate[]>([]);
  const [selectedStarterTemplateKeys, setSelectedStarterTemplateKeys] = useState<string[]>([]);
  const [starterTemplatesLoading, setStarterTemplatesLoading] = useState(false);
  const [starterTemplateError, setStarterTemplateError] = useState<string | null>(null);
  const [branding, setBranding] = useState({
    logoUrl: "",
    coverUrl: "",
    phone: "",
    address: "",
    tinVat: "",
    receiptFooter: "Thank you for dining with us.",
    instagram: "",
    facebook: "",
    website: "",
  });
  const [tablesChoice, setTablesChoice] = useState<"preset" | "custom">("preset");
  const [tableCount, setTableCount] = useState(20);
  const [hours, setHours] = useState({
    opensAt: "08:00",
    closesAt: "22:00",
    closedDays: [] as string[],
  });
  const [kitchenMode, setKitchenMode] = useState<KitchenMode>("single");
  const [invites, setInvites] = useState<InviteDraft[]>([]);
  const [inviteDraft, setInviteDraft] = useState<InviteDraft>({ name: "", email: "", role: "cashier" });

  const activeTables = useMemo(() => (generatedTables.length > 0 ? generatedTables : tables).filter((table) => table.active), [generatedTables, tables]);
  const selectedStarterTemplates = useMemo(
    () => starterTemplates.filter((template) => selectedStarterTemplateKeys.includes(template.template_key)),
    [selectedStarterTemplateKeys, starterTemplates],
  );
  const selectedStarterCategoryCount = useMemo(
    () => selectedStarterTemplates.reduce((total, template) => total + template.categories.length, 0),
    [selectedStarterTemplates],
  );
  const selectedStarterItemCount = useMemo(
    () => selectedStarterTemplates.reduce((total, template) => total + template.categories.reduce((subtotal, category) => subtotal + category.items.length, 0), 0),
    [selectedStarterTemplates],
  );
  const progress = Math.round(((step + 1) / STEPS.length) * 100);
  const existingTables = tables.length > 0;

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const [{ data: restaurantData, error: restaurantError }, { data: tableData, error: tableError }] = await Promise.all([
          supabase
            .from("restaurants")
            .select("name,total_tables,profile,branding,business_hours,kitchen_settings")
            .eq("id", restaurantId)
            .maybeSingle(),
          supabase
            .from("restaurant_tables")
            .select("id,table_number,label,qr_path,qr_url,active")
            .eq("restaurant_id", restaurantId)
            .order("table_number", { ascending: true }),
        ]);
        if (restaurantError) throw new Error(restaurantError.message);
        if (tableError) throw new Error(tableError.message);
        if (!mounted) return;

        const profile = restaurantData?.profile && typeof restaurantData.profile === "object" ? restaurantData.profile as Record<string, unknown> : {};
        const brand = restaurantData?.branding && typeof restaurantData.branding === "object" ? restaurantData.branding as Record<string, unknown> : {};
        setRestaurantInfo({
          restaurantName: typeof restaurantData?.name === "string" ? restaurantData.name : restaurantName,
          restaurantType: RESTAURANT_TYPES.includes(profile.restaurant_type as RestaurantType) ? profile.restaurant_type as RestaurantType : "Mixed Restaurant",
          phone: typeof profile.phone === "string" ? profile.phone : "",
          address: typeof profile.address === "string" ? profile.address : "",
          description: typeof profile.description === "string" ? profile.description : "",
        });
        setBranding((previous) => ({
          ...previous,
          logoUrl: typeof brand.logo_url === "string" ? brand.logo_url : "",
          coverUrl: typeof brand.cover_url === "string" ? brand.cover_url : "",
          tinVat: typeof profile.tin_vat === "string" ? profile.tin_vat : "",
          receiptFooter: typeof profile.receipt_footer === "string" ? profile.receipt_footer : previous.receiptFooter,
        }));
        setLogoPreviewUrl(typeof brand.logo_url === "string" ? brand.logo_url : "");
        setCoverPreviewUrl(typeof brand.cover_url === "string" ? brand.cover_url : "");
        setTableCount(Number(restaurantData?.total_tables ?? 20));
        setTables((tableData ?? []).map((row) => ({
          id: String(row.id),
          table_number: Number(row.table_number),
          label: String(row.label),
          qr_path: String(row.qr_path ?? ""),
          qr_url: typeof row.qr_url === "string" ? row.qr_url : null,
          active: Boolean(row.active),
        })));

        const draft = readJsonRecord(window.localStorage.getItem(getDraftStorageKey(restaurantId)));
        if (draft) {
          const draftRestaurantInfo = draft.restaurantInfo && typeof draft.restaurantInfo === "object" ? draft.restaurantInfo as Partial<typeof restaurantInfo> : null;
          const draftBranding = draft.branding && typeof draft.branding === "object" ? draft.branding as Partial<typeof branding> : null;
          const draftHours = draft.hours && typeof draft.hours === "object" ? draft.hours as Partial<typeof hours> : null;
          const draftKitchenMode = typeof draft.kitchenMode === "string" ? draft.kitchenMode : "";
          const draftTableCount = typeof draft.tableCount === "number" ? draft.tableCount : null;
          const draftInvites = Array.isArray(draft.invites) ? draft.invites as InviteDraft[] : null;
          const draftStarterTemplateKeys = Array.isArray(draft.selectedStarterTemplateKeys) ? draft.selectedStarterTemplateKeys.filter((key): key is string => typeof key === "string") : null;

          if (draftRestaurantInfo) setRestaurantInfo((previous) => ({ ...previous, ...draftRestaurantInfo }));
          if (draftBranding) {
            setBranding((previous) => ({ ...previous, ...draftBranding }));
            if (typeof draftBranding.logoUrl === "string") setLogoPreviewUrl(draftBranding.logoUrl);
            if (typeof draftBranding.coverUrl === "string") setCoverPreviewUrl(draftBranding.coverUrl);
          }
          if (draftHours) setHours((previous) => ({ ...previous, ...draftHours }));
          if (draftKitchenMode === "single" || draftKitchenMode === "advanced" || draftKitchenMode === "skipped") setKitchenMode(draftKitchenMode);
          if (draftTableCount && Number.isInteger(draftTableCount)) setTableCount(draftTableCount);
          if (draftInvites) setInvites(draftInvites);
          if (draftStarterTemplateKeys) setSelectedStarterTemplateKeys(draftStarterTemplateKeys);
        }
      } catch (loadError) {
        if (mounted) setError(loadError instanceof Error ? loadError.message : "Could not load setup.");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void load();
    return () => { mounted = false; };
  }, [restaurantId, restaurantName]);

  useEffect(() => {
    let mounted = true;

    async function loadStarterTemplates() {
      try {
        setStarterTemplatesLoading(true);
        setStarterTemplateError(null);
        const { data, error: templateError } = await supabase.rpc("get_restaurant_starter_templates", {
          target_restaurant_type: restaurantInfo.restaurantType,
        });
        if (templateError) throw new Error(templateError.message);
        if (!mounted) return;

        const templates = Array.isArray(data) ? data as StarterTemplate[] : [];
        setStarterTemplates(templates);
        setSelectedStarterTemplateKeys((current) => {
          const availableKeys = templates.map((template) => template.template_key);
          const currentAvailable = current.filter((key) => availableKeys.includes(key));
          return currentAvailable.length > 0 ? currentAvailable : availableKeys;
        });
      } catch (loadError) {
        if (!mounted) return;
        setStarterTemplates([]);
        setStarterTemplateError(loadError instanceof Error ? loadError.message : "Could not load starter templates.");
      } finally {
        if (mounted) setStarterTemplatesLoading(false);
      }
    }

    void loadStarterTemplates();
    return () => { mounted = false; };
  }, [restaurantInfo.restaurantType]);

  useEffect(() => {
    if (loading) return;

    window.localStorage.setItem(getDraftStorageKey(restaurantId), JSON.stringify({
      restaurantInfo,
      branding,
      tableCount,
      hours,
      kitchenMode,
      invites,
      selectedStarterTemplateKeys,
    }));
  }, [branding, hours, invites, kitchenMode, loading, restaurantId, restaurantInfo, selectedStarterTemplateKeys, tableCount]);

  function canContinue() {
    if (step === 0) return restaurantInfo.restaurantName.trim().length >= 2;
    if (step === 3) return Number.isInteger(tableCount) && tableCount >= 1 && tableCount <= 500;
    if (step === 4) return Boolean(hours.opensAt && hours.closesAt);
    return true;
  }

  function next() {
    if (!canContinue()) {
      setError("Please complete this step before continuing.");
      return;
    }
    setError(null);
    setStep((current) => Math.min(current + 1, FINAL_STEP));
  }

  function back() {
    setError(null);
    setStep((current) => Math.max(current - 1, 0));
  }

  function toggleClosedDay(day: string) {
    setHours((previous) => ({
      ...previous,
      closedDays: previous.closedDays.includes(day)
        ? previous.closedDays.filter((entry) => entry !== day)
        : [...previous.closedDays, day],
    }));
  }

  function toggleStarterTemplate(templateKey: string) {
    setSelectedStarterTemplateKeys((current) => current.includes(templateKey)
      ? current.filter((key) => key !== templateKey)
      : [...current, templateKey]);
  }

  function updateCustomTableCount(value: string) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) {
      setTableCount(1);
      return;
    }
    setTableCount(Math.max(1, Math.min(500, parsed)));
  }

  function addInvite() {
    if (!inviteDraft.email.trim()) return;
    setInvites((previous) => [...previous, { ...inviteDraft, email: inviteDraft.email.trim().toLowerCase(), name: inviteDraft.name.trim() }]);
    setInviteDraft({ name: "", email: "", role: "cashier" });
  }

  async function uploadBrandingAsset(assetType: BrandingAssetType, file: File | null) {
    if (!file) return;
    const localPreviewUrl = URL.createObjectURL(file);

    try {
      setAssetUploading(assetType);
      setError(null);
      if (assetType === "logo") setLogoPreviewUrl(localPreviewUrl);
      if (assetType === "cover") setCoverPreviewUrl(localPreviewUrl);

      if (!file.type.startsWith("image/")) {
        throw new Error("Branding asset must be an image file.");
      }

      if (file.size > 5 * 1024 * 1024) {
        throw new Error("Branding asset must be 5 MB or smaller.");
      }

      const path = buildBrandingAssetPath(restaurantId, assetType);
      const { error: uploadError } = await supabase.storage.from("menu-photos").upload(path, file, {
        cacheControl: "0",
        upsert: true,
        contentType: file.type,
      });

      if (uploadError) throw new Error(uploadError.message);

      const { data } = supabase.storage.from("menu-photos").getPublicUrl(path);
      setBranding((previous) => assetType === "logo"
        ? { ...previous, logoUrl: data.publicUrl }
        : { ...previous, coverUrl: data.publicUrl });
      if (assetType === "logo") setLogoPreviewUrl(data.publicUrl);
      if (assetType === "cover") setCoverPreviewUrl(data.publicUrl);
    } catch (uploadError) {
      if (assetType === "logo") setLogoPreviewUrl(branding.logoUrl);
      if (assetType === "cover") setCoverPreviewUrl(branding.coverUrl);
      setError(uploadError instanceof Error ? uploadError.message : "Could not upload branding asset.");
    } finally {
      setAssetUploading(null);
      URL.revokeObjectURL(localPreviewUrl);
    }
  }

  async function completeSetup() {
    try {
      setSubmitting(true);
      setError(null);
      const { data, error: setupError } = await supabase.rpc("complete_restaurant_setup", {
        target_restaurant_id: restaurantId,
        restaurant_info_payload: {
          restaurant_name: restaurantInfo.restaurantName.trim(),
          restaurant_type: restaurantInfo.restaurantType,
          currency: "ETB",
          timezone: "Africa/Nairobi",
          phone: restaurantInfo.phone.trim(),
          address: restaurantInfo.address.trim(),
          description: restaurantInfo.description.trim(),
        },
        branding_payload: {
          logo_url: branding.logoUrl.trim(),
          cover_url: branding.coverUrl.trim(),
          tin_vat: branding.tinVat.trim(),
          receipt_footer: branding.receiptFooter.trim(),
          social_links: {
            instagram: branding.instagram.trim(),
            facebook: branding.facebook.trim(),
            website: branding.website.trim(),
          },
        },
        table_payload: {
          table_count: tableCount,
        },
        business_hours_payload: {
          opens_at: hours.opensAt,
          closes_at: hours.closesAt,
          closed_days: hours.closedDays,
        },
        kitchen_payload: {
          mode: kitchenMode === "advanced" ? "advanced" : "single",
          skipped: kitchenMode === "skipped",
        },
        staff_invitations_payload: invites,
        starter_template_keys: selectedStarterTemplateKeys,
      });
      if (setupError) throw new Error(setupError.message);
      const payload = data && typeof data === "object" ? data as { tables?: ExistingTable[] } : {};
      setGeneratedTables(Array.isArray(payload.tables) ? payload.tables : []);
      window.localStorage.removeItem(getDraftStorageKey(restaurantId));
      onFinished();
    } catch (completeError) {
      setError(completeError instanceof Error ? completeError.message : "Could not finish setup.");
    } finally {
      setSubmitting(false);
    }
  }

  async function printQrCodes() {
    const printableTables = activeTables;
    if (printableTables.length === 0) return;
    let cards: string[];
    try {
      cards = await Promise.all(printableTables.map(async (table) => {
        const orderingUrl = getOrderingUrl(table);
        if (!orderingUrl) {
          throw new Error("QR base URL is not configured. Set the Application URL before generating QR codes.");
        }
        logSetupQrDiagnostic("setupWizard:printQrUrl", {
          generatedQrUrl: orderingUrl,
          currentAppUrl: new URL(orderingUrl).origin,
          tableNumber: table.table_number,
        });
        const qr = await QRCode.toDataURL(orderingUrl, { width: 260, margin: 1 });
        return `<section><h1>${restaurantInfo.restaurantName}</h1><h2>Table ${table.table_number}</h2><img src="${qr}" /><p>Scan to Order</p></section>`;
      }));
    } catch (qrError) {
      setError(qrError instanceof Error ? qrError.message : "Could not generate QR codes.");
      return;
    }
    const printWindow = window.open("", "_blank", "width=900,height=700");
    if (!printWindow) {
      setError("Could not open print window. Please allow pop-ups for this site.");
      return;
    }
    printWindow.document.write(`<!doctype html><html><head><title>QR Codes</title><style>
body{font-family:Arial,sans-serif;margin:0;padding:24px;display:grid;grid-template-columns:repeat(2,1fr);gap:18px}
section{border:1px solid #d8dee8;border-radius:12px;padding:22px;text-align:center;break-inside:avoid}
h1{font-size:20px;margin:0 0 6px}h2{font-size:15px;color:#64748b;margin:0 0 14px}img{width:260px;height:260px}p{font-weight:800}@page{size:A4;margin:12mm}
</style></head><body>${cards.join("")}<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),100));<\/script></body></html>`);
    printWindow.document.close();
  }

  async function downloadQrPdf() {
    try {
      const pdf = await buildQrPdf(activeTables, restaurantInfo.restaurantName);
      downloadBlob(`${safeFilename(restaurantInfo.restaurantName)}-qr-codes.pdf`, pdf);
    } catch (qrError) {
      setError(qrError instanceof Error ? qrError.message : "Could not generate QR PDF.");
    }
  }

  if (loading) {
    return <main className="setup-page"><section className="setup-panel"><p>Preparing your setup...</p></section></main>;
  }

  return (
    <main className="setup-page">
      <section className="setup-panel">
        <header className="setup-header">
          <div>
            <p className="setup-eyebrow">Welcome to ServeFlow</p>
            <h1>{STEPS[step]}</h1>
          </div>
          <div className="setup-progress-label">Step {step + 1} of {STEPS.length}</div>
        </header>

        <div className="setup-progress"><span style={{ width: `${progress}%` }} /></div>
        <nav className="setup-steps" aria-label="Setup progress">
          {STEPS.map((label, index) => <span key={label} className={index <= step ? "active" : ""}>{index + 1}</span>)}
        </nav>

        {error && <div className="setup-error">{error}</div>}

        <div className="setup-body">
          {step === 0 && (
            <div className="setup-grid">
              <label>Restaurant Name<input value={restaurantInfo.restaurantName} onChange={(event) => setRestaurantInfo({ ...restaurantInfo, restaurantName: event.target.value })} /></label>
              <label>Restaurant Type<select value={restaurantInfo.restaurantType} onChange={(event) => setRestaurantInfo({ ...restaurantInfo, restaurantType: event.target.value as RestaurantType })}>{RESTAURANT_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label>
              <label>Phone<input value={restaurantInfo.phone} onChange={(event) => setRestaurantInfo({ ...restaurantInfo, phone: event.target.value })} /></label>
              <label className="wide">Address<input value={restaurantInfo.address} onChange={(event) => setRestaurantInfo({ ...restaurantInfo, address: event.target.value })} /></label>
              <label className="wide">Description<textarea value={restaurantInfo.description} onChange={(event) => setRestaurantInfo({ ...restaurantInfo, description: event.target.value })} /></label>
            </div>
          )}

          {step === 1 && (
            <div className="setup-template-layout">
              <div className="setup-template-list">
                {starterTemplatesLoading && <div className="setup-list">Loading starter templates...</div>}
                {starterTemplateError && <div className="setup-error">{starterTemplateError}</div>}
                {!starterTemplatesLoading && !starterTemplateError && starterTemplates.length === 0 && (
                  <div className="setup-list">No starter templates are available for this restaurant type.</div>
                )}
                {starterTemplates.map((template) => {
                  const selected = selectedStarterTemplateKeys.includes(template.template_key);
                  const sampleItems = template.categories.flatMap((category) => category.items.map((item) => item.name)).slice(0, 4);
                  return (
                    <button type="button" className={`setup-template-card${selected ? " selected" : ""}`} onClick={() => toggleStarterTemplate(template.template_key)} key={template.template_key}>
                      <span className="setup-template-check">{selected ? "Selected" : ""}</span>
                      <span>
                        <strong>{template.name}</strong>
                        <small>{template.description}</small>
                        <em>{sampleItems.join(" / ")}</em>
                      </span>
                    </button>
                  );
                })}
              </div>
              <aside className="setup-template-preview">
                <strong>Live Preview</strong>
                <span>{selectedStarterCategoryCount} categories / {selectedStarterItemCount} items</span>
                <div>
                  {selectedStarterTemplates.slice(0, 3).flatMap((template) => template.categories.slice(0, 2).map((category) => (
                    <section key={`${template.template_key}-${category.name}`}>
                      <h3>{category.name}</h3>
                      {category.items.slice(0, 3).map((item) => <p key={item.name}>{item.name}<span>ETB 0</span></p>)}
                    </section>
                  )))}
                  {selectedStarterTemplates.length === 0 && <p>No templates selected.</p>}
                </div>
              </aside>
            </div>
          )}

          {step === 2 && (
            <div className="setup-grid">
              <div className="setup-asset-field wide">
                <div className="setup-asset-preview logo">
                  {logoPreviewUrl ? <img src={logoPreviewUrl} alt="" /> : <span>No logo</span>}
                </div>
                <label className="setup-upload-button">
                  {assetUploading === "logo" ? "Uploading..." : "Upload Logo"}
                  <input type="file" accept="image/*" onChange={(event) => void uploadBrandingAsset("logo", event.target.files?.[0] ?? null)} disabled={assetUploading !== null} />
                </label>
                <label className="setup-asset-url-fallback">Paste URL fallback<input value={branding.logoUrl} onChange={(event) => { setBranding({ ...branding, logoUrl: event.target.value }); setLogoPreviewUrl(event.target.value); }} /></label>
              </div>
              <div className="setup-asset-field wide">
                <div className="setup-asset-preview cover">
                  {coverPreviewUrl ? <img src={coverPreviewUrl} alt="" /> : <span>No cover</span>}
                </div>
                <label className="setup-upload-button">
                  {assetUploading === "cover" ? "Uploading..." : "Upload Cover"}
                  <input type="file" accept="image/*" onChange={(event) => void uploadBrandingAsset("cover", event.target.files?.[0] ?? null)} disabled={assetUploading !== null} />
                </label>
                <label className="setup-asset-url-fallback">Paste URL fallback<input value={branding.coverUrl} onChange={(event) => { setBranding({ ...branding, coverUrl: event.target.value }); setCoverPreviewUrl(event.target.value); }} /></label>
              </div>
              <label>TIN/VAT<input value={branding.tinVat} onChange={(event) => setBranding({ ...branding, tinVat: event.target.value })} /></label>
              <label className="wide">Receipt Footer<input value={branding.receiptFooter} onChange={(event) => setBranding({ ...branding, receiptFooter: event.target.value })} /></label>
              <label>Instagram<input value={branding.instagram} onChange={(event) => setBranding({ ...branding, instagram: event.target.value })} /></label>
              <label>Facebook<input value={branding.facebook} onChange={(event) => setBranding({ ...branding, facebook: event.target.value })} /></label>
              <label>Website<input value={branding.website} onChange={(event) => setBranding({ ...branding, website: event.target.value })} /></label>
            </div>
          )}

          {step === 3 && (
            <div className="setup-stack">
              <div className="setup-step-copy">
                <h2>Select Tables</h2>
                <p>Choose how many table QR codes ServeFlow should create for this restaurant.</p>
              </div>
              {existingTables && (
                <div className="setup-notice">
                  <strong>{tables.length} table records already exist.</strong>
                  <span>Setup will save the configured table count and let the database keep table records idempotent.</span>
                </div>
              )}
              <div className="setup-choice-row">
                {TABLE_PRESETS.map((count) => <button type="button" className={tablesChoice === "preset" && tableCount === count ? "selected" : ""} onClick={() => { setTablesChoice("preset"); setTableCount(count); }} key={count}>{count}</button>)}
                <button type="button" className={tablesChoice === "custom" ? "selected" : ""} onClick={() => setTablesChoice("custom")}>Custom</button>
              </div>
              {tablesChoice === "custom" && (
                <div className="setup-custom-tables">
                  {CUSTOM_TABLES.map((count) => <button type="button" className={tableCount === count ? "selected" : ""} onClick={() => setTableCount(count)} key={count}>{count}</button>)}
                  <label>
                    Exact Table Count
                    <input type="number" min={1} max={500} value={tableCount} onChange={(event) => updateCustomTableCount(event.target.value)} />
                  </label>
                </div>
              )}
              <div className="setup-table-summary">
                <span>Selected tables</span>
                <strong>{tableCount}</strong>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="setup-stack">
              <div className="setup-grid">
                <label>Opening<input type="time" value={hours.opensAt} onChange={(event) => setHours({ ...hours, opensAt: event.target.value })} /></label>
                <label>Closing<input type="time" value={hours.closesAt} onChange={(event) => setHours({ ...hours, closesAt: event.target.value })} /></label>
              </div>
              <div className="setup-choice-row wrap">
                {WEEK_DAYS.map((day) => <button type="button" className={hours.closedDays.includes(day) ? "selected" : ""} onClick={() => toggleClosedDay(day)} key={day}>{day}</button>)}
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="setup-choice-column">
              <button type="button" className={kitchenMode === "single" ? "selected" : ""} onClick={() => setKitchenMode("single")}><strong>Single Kitchen</strong><span>Simple setup for one preparation area.</span></button>
              <button type="button" className={kitchenMode === "advanced" ? "selected" : ""} onClick={() => setKitchenMode("advanced")}><strong>Multiple Kitchen Stations</strong><span>Stores your preference for a future station workflow.</span></button>
              <button type="button" className={kitchenMode === "skipped" ? "selected" : ""} onClick={() => setKitchenMode("skipped")}><strong>Skip</strong><span>You can configure this later.</span></button>
            </div>
          )}

          {step === 6 && (
            <div className="setup-stack">
              <div className="setup-grid">
                <label>Name<input value={inviteDraft.name} onChange={(event) => setInviteDraft({ ...inviteDraft, name: event.target.value })} /></label>
                <label>Email<input value={inviteDraft.email} onChange={(event) => setInviteDraft({ ...inviteDraft, email: event.target.value })} /></label>
                <label>Role<select value={inviteDraft.role} onChange={(event) => setInviteDraft({ ...inviteDraft, role: event.target.value as InviteRole })}>{INVITE_ROLES.map((role) => <option value={role} key={role}>{role}</option>)}</select></label>
              </div>
              <button className="setup-secondary" type="button" onClick={addInvite}>Add Invitation</button>
              <div className="setup-list">{invites.length === 0 ? <span>No staff invitations yet. Skipping is fine.</span> : invites.map((invite, index) => <span key={`${invite.email}-${index}`}>{invite.email} - {invite.role}</span>)}</div>
            </div>
          )}

          {step === 7 && (
            <div className="setup-finish">
              <h2>Ready to launch</h2>
              <div className="setup-summary">
                <span className="with-image">Logo<strong>{logoPreviewUrl ? <img src={logoPreviewUrl} alt="" /> : "Not added"}</strong></span>
                <span>Restaurant Name<strong>{restaurantInfo.restaurantName}</strong></span>
                <span>Starter Templates<strong>{selectedStarterTemplates.length}</strong></span>
                <span>Tables<strong>{tableCount}</strong></span>
                <span>Business Hours<strong>{hours.opensAt} - {hours.closesAt}</strong></span>
                <span>Kitchen<strong>{kitchenMode === "skipped" ? "Skipped" : kitchenMode === "advanced" ? "Advanced preference saved" : "Single Kitchen"}</strong></span>
              </div>
              <div className="setup-actions">
                <button className="setup-secondary" type="button">Create Menu Manually</button>
                <button className="setup-primary" type="button" onClick={() => void completeSetup()} disabled={submitting || assetUploading !== null}>{submitting ? "Launching..." : "Launch My Restaurant"}</button>
              </div>
            </div>
          )}
        </div>

        {step < FINAL_STEP && (
          <footer className="setup-actions">
            <button className="setup-secondary" type="button" onClick={back} disabled={step === 0 || submitting || assetUploading !== null}>Back</button>
            {step === 6 && <button className="setup-secondary" type="button" onClick={next}>Skip</button>}
            <button className="setup-primary" type="button" onClick={next} disabled={submitting || assetUploading !== null}>{assetUploading ? "Uploading..." : "Continue"}</button>
          </footer>
        )}
      </section>
    </main>
  );
}
