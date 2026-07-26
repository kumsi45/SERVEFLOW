import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../../core/database";
import { AiMenuUploadStep } from "../components/AiMenuUploadStep";
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

const STEPS = [
  "Restaurant Info",
  "Branding",
  "Business Hours",
  "Payment Accounts",
  "AI Menu Builder",
  "Review & Publish",
  "Generate QR",
  "Finish",
] as const;

const FINAL_STEP = STEPS.length - 1;

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


export function RestaurantSetupWizardPage({ restaurantId, restaurantName, onFinished }: SetupWizardProps) {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [assetUploading, setAssetUploading] = useState<BrandingAssetType | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState("");
  const [coverPreviewUrl, setCoverPreviewUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [tables, setTables] = useState<ExistingTable[]>([]);
  const [importDraftCount, setImportDraftCount] = useState(0);
  const [importUploadBusy, setImportUploadBusy] = useState(false);
  const [restaurantInfo, setRestaurantInfo] = useState({
    restaurantName,
    restaurantType: "Mixed Restaurant" as RestaurantType,
    phone: "",
    address: "",
    description: "",
  });
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
  const progress = Math.round(((step + 1) / STEPS.length) * 100);
  const existingTables = tables.length > 0;
  const handleDraftCountChange = useCallback((count: number) => {
    setImportDraftCount(count);
  }, []);
  const handleImportBusyChange = useCallback((busy: boolean) => {
    setImportUploadBusy(busy);
  }, []);

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
          const draftTableCount = typeof draft.tableCount === "number" ? draft.tableCount : null;

          if (draftRestaurantInfo) setRestaurantInfo((previous) => ({ ...previous, ...draftRestaurantInfo }));
          if (draftBranding) {
            setBranding((previous) => ({ ...previous, ...draftBranding }));
            if (typeof draftBranding.logoUrl === "string") setLogoPreviewUrl(draftBranding.logoUrl);
            if (typeof draftBranding.coverUrl === "string") setCoverPreviewUrl(draftBranding.coverUrl);
          }
          if (draftHours) setHours((previous) => ({ ...previous, ...draftHours }));
          if (draftTableCount && Number.isInteger(draftTableCount)) setTableCount(draftTableCount);
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
    if (loading) return;

    window.localStorage.setItem(getDraftStorageKey(restaurantId), JSON.stringify({
      restaurantInfo,
      branding,
      tableCount,
      hours,
    }));
  }, [branding, hours, loading, restaurantId, restaurantInfo, tableCount]);

  function canContinue() {
    if (step === 0) return restaurantInfo.restaurantName.trim().length >= 2;
    if (step === 2) return Boolean(hours.opensAt && hours.closesAt);
    if (step === 6) return Number.isInteger(tableCount) && tableCount >= 1 && tableCount <= 500;
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

  function updateCustomTableCount(value: string) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) {
      setTableCount(1);
      return;
    }
    setTableCount(Math.max(1, Math.min(500, parsed)));
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
      const { error: setupError } = await supabase.rpc("complete_restaurant_setup", {
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
          mode: "single",
          skipped: true,
        },
        staff_invitations_payload: [],
        starter_template_keys: [],
      });
      if (setupError) throw new Error(setupError.message);
      window.localStorage.removeItem(getDraftStorageKey(restaurantId));
      onFinished();
    } catch (completeError) {
      setError(completeError instanceof Error ? completeError.message : "Could not finish setup.");
    } finally {
      setSubmitting(false);
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

          {step === 2 && (
            <div className="setup-stack">
              <div className="setup-step-copy">
                <h2>Set your regular opening hours</h2>
                <p>You can add special schedules from the Owner dashboard later.</p>
              </div>
              <div className="setup-grid">
                <label>Opening<input type="time" value={hours.opensAt} onChange={(event) => setHours({ ...hours, opensAt: event.target.value })} /></label>
                <label>Closing<input type="time" value={hours.closesAt} onChange={(event) => setHours({ ...hours, closesAt: event.target.value })} /></label>
              </div>
              <div className="setup-choice-row wrap">
                {WEEK_DAYS.map((day) => <button type="button" className={hours.closedDays.includes(day) ? "selected" : ""} onClick={() => toggleClosedDay(day)} key={day}>{day}</button>)}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="setup-phase-placeholder">
              <span aria-hidden="true">PA</span>
              <div>
                <p className="setup-import-kicker">Configure later</p>
                <h2>Payment accounts</h2>
                <p>No payment account is created or changed during this upload-foundation phase. Continue now and configure payment settings securely from the Owner dashboard.</p>
              </div>
            </div>
          )}

          {step === 4 && (
            <AiMenuUploadStep
              restaurantId={restaurantId}
              onDraftCountChange={handleDraftCountChange}
              onBusyChange={handleImportBusyChange}
            />
          )}

          {step === 5 && (
            <div className="setup-phase-placeholder review">
              <span aria-hidden="true">RP</span>
              <div>
                <p className="setup-import-kicker">Placeholder</p>
                <h2>Review &amp; Publish</h2>
                <p>{importDraftCount} import draft{importDraftCount === 1 ? " is" : "s are"} safely stored. Review, extraction, and publishing are not enabled in this phase, so no menu data will be created.</p>
                <div className="setup-draft-safety" role="status">
                  <strong>Nothing will be published</strong>
                  <span>Your uploaded files remain private import drafts.</span>
                </div>
              </div>
            </div>
          )}

          {step === 6 && (
            <div className="setup-stack">
              <div className="setup-step-copy">
                <h2>Prepare your table QR codes</h2>
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

          {step === 7 && (
            <div className="setup-finish">
              <h2>Ready to launch</h2>
              <div className="setup-summary">
                <span className="with-image">Logo<strong>{logoPreviewUrl ? <img src={logoPreviewUrl} alt="" /> : "Not added"}</strong></span>
                <span>Restaurant Name<strong>{restaurantInfo.restaurantName}</strong></span>
                <span>Import Drafts<strong>{importDraftCount}</strong></span>
                <span>Tables<strong>{tableCount}</strong></span>
                <span>Business Hours<strong>{hours.opensAt} - {hours.closesAt}</strong></span>
                <span>Menu Status<strong>Not published</strong></span>
              </div>
              <div className="setup-actions">
                <button className="setup-primary" type="button" onClick={() => void completeSetup()} disabled={submitting || assetUploading !== null}>{submitting ? "Launching..." : "Launch My Restaurant"}</button>
              </div>
            </div>
          )}
        </div>

        {step < FINAL_STEP && (
          <footer className="setup-actions">
            <button className="setup-secondary" type="button" onClick={back} disabled={step === 0 || submitting || assetUploading !== null || importUploadBusy}>Back</button>
            <button className="setup-primary" type="button" onClick={next} disabled={submitting || assetUploading !== null || importUploadBusy}>{assetUploading ? "Uploading..." : importUploadBusy ? "Uploading drafts..." : "Continue"}</button>
          </footer>
        )}
      </section>
    </main>
  );
}
