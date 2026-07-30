import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../../core/database";
import { createSmartImagePublicUrl } from "../../../core/presentation/smartImageDelivery";
import type { MenuTheme } from "../../menu/theme-engine/ThemeTypes";
import { AiMenuReviewStudio } from "../components/AiMenuReviewStudio";
import { SmartMenuLibraryStep, type SmartMenuRestaurantType } from "../components/SmartMenuLibraryStep";
import { persistMenuPreviewTheme } from "../services/menuPublishService";
import { clearReviewStudioSession } from "../services/reviewStudioSessionService";
import "./restaurantSetupWizard.css";

type SetupWizardProps = {
  restaurantId: string;
  restaurantName: string;
  onFinished: () => void;
};

type BrandingAssetType = "logo" | "cover";

const RESTAURANT_TYPES: SmartMenuRestaurantType[] = [
  "Restaurant", "Hotel", "Cafe", "Fast Food", "Bar & Lounge", "Bakery",
];

const WEEK_DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

const LANGUAGES = [
  { id: "en", label: "English" },
  { id: "am", label: "Amharic" },
  { id: "om", label: "Afaan Oromoo" },
] as const;

const THEMES: Array<{ id: MenuTheme; label: string }> = [
  { id: "modern", label: "Modern" },
  { id: "luxury", label: "Premium" },
];

const STEPS = [
  {
    title: "Restaurant Basics",
    subtitle: "Tell us the essentials. You can refine everything later.",
  },
  {
    title: "Choose Restaurant Type",
    subtitle: "Start with a professionally curated ServeFlow Smart Menu.",
  },
  {
    title: "Edit Your Digital Menu",
    subtitle: "Review your menu before publishing. Change prices, photos, descriptions and categories anytime.",
  },
  {
    title: "Restaurant Branding",
    subtitle: "Make the customer experience feel unmistakably yours.",
  },
  {
    title: "Customer Preview",
    subtitle: "See exactly what customers will see, then publish when ready.",
  },
] as const;

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
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function RestaurantSetupWizardPage({
  restaurantId,
  restaurantName,
  onFinished,
}: SetupWizardProps) {
  const [step, setStep] = useState(0);
  const [sessionRestored, setSessionRestored] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [assetUploading, setAssetUploading] = useState<BrandingAssetType | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tableCount, setTableCount] = useState(20);
  const [restaurantInfo, setRestaurantInfo] = useState({
    restaurantName,
    restaurantType: "Restaurant" as SmartMenuRestaurantType,
    phone: "",
    address: "",
    description: "",
  });
  const [branding, setBranding] = useState({
    logoUrl: "",
    coverUrl: "",
    instagram: "",
    facebook: "",
    website: "",
    tinVat: "",
    receiptFooter: "Thank you for dining with us.",
    theme: "modern" as MenuTheme,
    languages: ["en"] as string[],
  });
  const [logoPreviewUrl, setLogoPreviewUrl] = useState("");
  const [coverPreviewUrl, setCoverPreviewUrl] = useState("");
  const [hours, setHours] = useState({
    opensAt: "08:00",
    closesAt: "22:00",
    closedDays: [] as string[],
  });

  const progress = useMemo(() => Math.round(((step + 1) / STEPS.length) * 100), [step]);
  const currentStep = STEPS[step];
  const handleImportBusyChange = useCallback((busy: boolean) => setImportBusy(busy), []);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        setLoading(true);
        const { data, error: loadError } = await supabase
          .from("restaurants")
          .select("name,total_tables,profile,branding,business_hours,menu_theme")
          .eq("id", restaurantId)
          .maybeSingle();
        if (loadError) throw new Error(loadError.message);
        if (!active) return;

        const profile = data?.profile && typeof data.profile === "object"
          ? data.profile as Record<string, unknown>
          : {};
        const brand = data?.branding && typeof data.branding === "object"
          ? data.branding as Record<string, unknown>
          : {};
        const social = profile.social_links && typeof profile.social_links === "object"
          ? profile.social_links as Record<string, unknown>
          : {};
        const businessHours = data?.business_hours && typeof data.business_hours === "object"
          ? data.business_hours as Record<string, unknown>
          : {};

        setRestaurantInfo({
          restaurantName: typeof data?.name === "string" ? data.name : restaurantName,
          restaurantType: RESTAURANT_TYPES.includes(profile.restaurant_type as SmartMenuRestaurantType)
            ? profile.restaurant_type as SmartMenuRestaurantType
            : "Restaurant",
          phone: typeof profile.phone === "string" ? profile.phone : "",
          address: typeof profile.address === "string" ? profile.address : "",
          description: typeof profile.description === "string" ? profile.description : "",
        });
        setBranding((previous) => ({
          ...previous,
          logoUrl: typeof brand.logo_url === "string" ? brand.logo_url : "",
          coverUrl: typeof brand.cover_url === "string" ? brand.cover_url : "",
          instagram: typeof social.instagram === "string" ? social.instagram : "",
          facebook: typeof social.facebook === "string" ? social.facebook : "",
          website: typeof social.website === "string" ? social.website : "",
          tinVat: typeof profile.tin_vat === "string" ? profile.tin_vat : "",
          receiptFooter: typeof profile.receipt_footer === "string"
            ? profile.receipt_footer
            : previous.receiptFooter,
          theme: data?.menu_theme === "luxury" ? "luxury" : "modern",
        }));
        setLogoPreviewUrl(typeof brand.logo_url === "string" ? brand.logo_url : "");
        setCoverPreviewUrl(typeof brand.cover_url === "string" ? brand.cover_url : "");
        setTableCount(Number(data?.total_tables ?? 20));
        setHours((previous) => ({
          opensAt: typeof businessHours.opens_at === "string" ? businessHours.opens_at : previous.opensAt,
          closesAt: typeof businessHours.closes_at === "string" ? businessHours.closes_at : previous.closesAt,
          closedDays: Array.isArray(businessHours.closed_days)
            ? businessHours.closed_days.filter((day): day is string => typeof day === "string")
            : previous.closedDays,
        }));

        const draft = readJsonRecord(window.localStorage.getItem(getDraftStorageKey(restaurantId)));
        const deepLinkedReview = window.location.pathname === "/setup/review";
        if (draft) {
          const savedStep = typeof draft.step === "number" ? Math.max(0, Math.min(STEPS.length - 1, Math.floor(draft.step))) : 0;
          setStep(deepLinkedReview ? 2 : savedStep);
          if (deepLinkedReview || savedStep > 0) setSessionRestored(true);
          if (draft.restaurantInfo && typeof draft.restaurantInfo === "object") {
            setRestaurantInfo((previous) => ({ ...previous, ...draft.restaurantInfo as Partial<typeof previous> }));
          }
          if (draft.branding && typeof draft.branding === "object") {
            setBranding((previous) => ({ ...previous, ...draft.branding as Partial<typeof previous> }));
          }
          if (draft.hours && typeof draft.hours === "object") {
            setHours((previous) => ({ ...previous, ...draft.hours as Partial<typeof previous> }));
          }
        }
        if (!draft && deepLinkedReview) {
          setStep(2);
          setSessionRestored(true);
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "Could not load setup.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [restaurantId, restaurantName]);

  useEffect(() => {
    if (loading) return;
    window.localStorage.setItem(getDraftStorageKey(restaurantId), JSON.stringify({
      step,
      restaurantInfo,
      branding,
      hours,
    }));
  }, [branding, hours, loading, restaurantId, restaurantInfo, step]);

  useEffect(() => {
    if (loading) return;
    const path = step === 2 ? "/setup/review" : "/owner/dashboard";
    if (window.location.pathname !== path) window.history.replaceState({}, "", path);
  }, [loading, step]);

  useEffect(() => {
    if (!sessionRestored) return;
    const timer = window.setTimeout(() => setSessionRestored(false), 3000);
    return () => window.clearTimeout(timer);
  }, [sessionRestored]);

  function toggleClosedDay(day: string) {
    setHours((previous) => ({
      ...previous,
      closedDays: previous.closedDays.includes(day)
        ? previous.closedDays.filter((entry) => entry !== day)
        : [...previous.closedDays, day],
    }));
  }

  function toggleLanguage(language: string) {
    setBranding((previous) => {
      const selected = previous.languages.includes(language);
      if (selected && previous.languages.length === 1) return previous;
      return {
        ...previous,
        languages: selected
          ? previous.languages.filter((entry) => entry !== language)
          : [...previous.languages, language],
      };
    });
  }

  async function uploadBrandingAsset(assetType: BrandingAssetType, file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Choose an image for your restaurant branding.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Branding images must be 5 MB or smaller.");
      return;
    }
    const localUrl = URL.createObjectURL(file);
    try {
      setAssetUploading(assetType);
      setError(null);
      if (assetType === "logo") setLogoPreviewUrl(localUrl);
      else setCoverPreviewUrl(localUrl);
      const path = buildBrandingAssetPath(restaurantId, assetType);
      const { error: uploadError } = await supabase.storage.from("menu-photos").upload(path, file, {
        cacheControl: "0",
        upsert: true,
        contentType: file.type,
      });
      if (uploadError) throw new Error(uploadError.message);
      const publicUrl = createSmartImagePublicUrl("menu-photos", path);
      setBranding((previous) => assetType === "logo"
        ? { ...previous, logoUrl: publicUrl }
        : { ...previous, coverUrl: publicUrl });
      if (assetType === "logo") setLogoPreviewUrl(publicUrl);
      else setCoverPreviewUrl(publicUrl);
    } catch (uploadError) {
      if (assetType === "logo") setLogoPreviewUrl(branding.logoUrl);
      else setCoverPreviewUrl(branding.coverUrl);
      setError(uploadError instanceof Error ? uploadError.message : "Could not upload the image.");
    } finally {
      setAssetUploading(null);
      URL.revokeObjectURL(localUrl);
    }
  }

  function canContinue() {
    if (step === 0) {
      return restaurantInfo.restaurantName.trim().length >= 2
        && restaurantInfo.phone.trim().length > 0
        && restaurantInfo.address.trim().length > 0;
    }
    if (step === 3) return Boolean(hours.opensAt && hours.closesAt && branding.languages.length);
    return true;
  }

  async function next() {
    if (!canContinue()) {
      setError("Complete the required fields before continuing.");
      return;
    }
    setError(null);
    if (step === 3) {
      try {
        setSubmitting(true);
        await persistMenuPreviewTheme(restaurantId, branding.theme);
      } catch (themeError) {
        setError(themeError instanceof Error ? themeError.message : "Could not save the selected theme.");
        return;
      } finally {
        setSubmitting(false);
      }
    }
    setStep((current) => Math.min(current + 1, STEPS.length - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function back() {
    setError(null);
    setStep((current) => Math.max(current - 1, 0));
    window.scrollTo({ top: 0, behavior: "smooth" });
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
          languages: branding.languages,
          social_links: {
            instagram: branding.instagram.trim(),
            facebook: branding.facebook.trim(),
            website: branding.website.trim(),
          },
        },
        table_payload: { table_count: tableCount },
        business_hours_payload: {
          opens_at: hours.opensAt,
          closes_at: hours.closesAt,
          closed_days: hours.closedDays,
        },
        kitchen_payload: { mode: "single", skipped: true },
        staff_invitations_payload: [],
        starter_template_keys: [],
      });
      if (setupError) throw new Error(setupError.message);
      window.localStorage.removeItem(getDraftStorageKey(restaurantId));
      clearReviewStudioSession(restaurantId);
      window.history.replaceState({}, "", "/owner/dashboard");
      onFinished();
    } catch (completeError) {
      setError(completeError instanceof Error ? completeError.message : "Could not finish setup.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <main className="setup-page"><section className="setup-panel setup-loading" aria-live="polite">Preparing your restaurant...</section></main>;
  }

  return (
    <main className="setup-page">
      <section className={`setup-panel setup-step-${step + 1}${step === 2 || step === 4 ? " review-studio-panel" : ""}`}>
        <header className="setup-header">
          <div className="setup-heading-copy">
            <p className="setup-eyebrow">ServeFlow setup</p>
            <h1>{currentStep.title}</h1>
            <p>{currentStep.subtitle}</p>
          </div>
          <div className="setup-progress-label" aria-label={`Step ${step + 1} of ${STEPS.length}, ${progress}% complete`}>
            <span>Step {step + 1} of {STEPS.length}</span>
            <strong>{progress}%</strong>
          </div>
        </header>
        <div className="setup-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label="Restaurant setup progress">
          <span style={{ width: `${progress}%` }} />
        </div>

        {error ? <div className="setup-error" role="alert">{error}</div> : null}
        {sessionRestored ? <div className="setup-session-restored" role="status" aria-live="polite"><strong>Welcome back.</strong><span>We've restored your unfinished menu.</span></div> : null}

        <div className="setup-body">
          {step === 0 ? (
            <div className="setup-grid setup-basics-form">
              <label>Restaurant Name<input autoFocus required autoComplete="organization" value={restaurantInfo.restaurantName} onChange={(event) => setRestaurantInfo({ ...restaurantInfo, restaurantName: event.target.value })} /></label>
              <label>Phone<input required inputMode="tel" autoComplete="tel" value={restaurantInfo.phone} onChange={(event) => setRestaurantInfo({ ...restaurantInfo, phone: event.target.value })} /></label>
              <label>Address<input required autoComplete="street-address" value={restaurantInfo.address} onChange={(event) => setRestaurantInfo({ ...restaurantInfo, address: event.target.value })} /></label>
              <label className="wide">Short Description<textarea maxLength={240} value={restaurantInfo.description} onChange={(event) => setRestaurantInfo({ ...restaurantInfo, description: event.target.value })} /><small>{restaurantInfo.description.length}/240</small></label>
            </div>
          ) : null}

          {step === 1 ? (
            <SmartMenuLibraryStep restaurantId={restaurantId} selectedType={restaurantInfo.restaurantType} onTypeChange={(restaurantType) => setRestaurantInfo({ ...restaurantInfo, restaurantType })} onBusyChange={handleImportBusyChange} onLoaded={() => void next()} />
          ) : null}

          {step === 2 ? (
            <AiMenuReviewStudio restaurantId={restaurantId} restaurantName={restaurantInfo.restaurantName} onBusyChange={handleImportBusyChange} mode="review" onBack={back} onContinue={() => void next()} smartLibraryOnly />
          ) : null}

          {step === 3 ? (
            <div className="setup-branding">
              <section className="setup-branding-assets" aria-label="Restaurant images">
                <label className="setup-asset-card logo">
                  <span>Logo</span>
                  <span className="setup-asset-preview">{logoPreviewUrl ? <img src={logoPreviewUrl} alt="Restaurant logo preview" /> : <span aria-hidden="true">Logo</span>}</span>
                  <span className="setup-upload-button">{assetUploading === "logo" ? "Uploading..." : "Choose Logo"}<input type="file" accept="image/*" disabled={assetUploading !== null} onChange={(event) => void uploadBrandingAsset("logo", event.target.files?.[0] ?? null)} /></span>
                </label>
                <label className="setup-asset-card cover">
                  <span>Cover Image</span>
                  <span className="setup-asset-preview cover">{coverPreviewUrl ? <img src={coverPreviewUrl} alt="Restaurant cover preview" /> : <span aria-hidden="true">Cover</span>}</span>
                  <span className="setup-upload-button">{assetUploading === "cover" ? "Uploading..." : "Choose Cover"}<input type="file" accept="image/*" disabled={assetUploading !== null} onChange={(event) => void uploadBrandingAsset("cover", event.target.files?.[0] ?? null)} /></span>
                </label>
              </section>

              <section className="setup-branding-section">
                <h2>Menu style</h2>
                <div className="setup-theme-options">{THEMES.map((theme) => <button type="button" aria-pressed={branding.theme === theme.id} className={branding.theme === theme.id ? "selected" : ""} onClick={() => setBranding({ ...branding, theme: theme.id })} key={theme.id}><span className={`setup-theme-swatch ${theme.id}`} />{theme.label}</button>)}</div>
              </section>

              <section className="setup-branding-section">
                <h2>Business hours</h2>
                <div className="setup-grid"><label>Opening<input type="time" value={hours.opensAt} onChange={(event) => setHours({ ...hours, opensAt: event.target.value })} /></label><label>Closing<input type="time" value={hours.closesAt} onChange={(event) => setHours({ ...hours, closesAt: event.target.value })} /></label></div>
                <div className="setup-choice-row wrap" aria-label="Closed days">{WEEK_DAYS.map((day) => <button type="button" aria-pressed={hours.closedDays.includes(day)} className={hours.closedDays.includes(day) ? "selected" : ""} onClick={() => toggleClosedDay(day)} key={day}>{day.slice(0, 3)}</button>)}</div>
              </section>

              <section className="setup-branding-section">
                <h2>Menu languages</h2>
                <div className="setup-choice-row">{LANGUAGES.map((language) => <button type="button" aria-pressed={branding.languages.includes(language.id)} className={branding.languages.includes(language.id) ? "selected" : ""} onClick={() => toggleLanguage(language.id)} key={language.id}>{language.label}</button>)}</div>
              </section>

              <section className="setup-grid setup-branding-details">
                <label>Instagram<input placeholder="@restaurant" value={branding.instagram} onChange={(event) => setBranding({ ...branding, instagram: event.target.value })} /></label>
                <label>Facebook<input placeholder="Page name or URL" value={branding.facebook} onChange={(event) => setBranding({ ...branding, facebook: event.target.value })} /></label>
                <label>Website<input inputMode="url" placeholder="https://" value={branding.website} onChange={(event) => setBranding({ ...branding, website: event.target.value })} /></label>
                <label>VAT / TIN<input value={branding.tinVat} onChange={(event) => setBranding({ ...branding, tinVat: event.target.value })} /></label>
                <label className="wide">Receipt Footer<input value={branding.receiptFooter} onChange={(event) => setBranding({ ...branding, receiptFooter: event.target.value })} /></label>
              </section>
            </div>
          ) : null}

          {step === 4 ? (
            <AiMenuReviewStudio restaurantId={restaurantId} restaurantName={restaurantInfo.restaurantName} onBusyChange={handleImportBusyChange} mode="preview" onBack={back} onFinishSetup={completeSetup} smartLibraryOnly />
          ) : null}
        </div>

        {step === 1 ? (
          <footer className="setup-actions">
            <button className="setup-secondary" type="button" onClick={back} disabled={importBusy}>Back</button>
          </footer>
        ) : step !== 2 && step !== 4 ? (
          <footer className="setup-actions">
            <button className="setup-secondary" type="button" onClick={back} disabled={step === 0 || submitting || assetUploading !== null || importBusy}>Back</button>
            <button className="setup-primary" type="button" onClick={() => void next()} disabled={submitting || assetUploading !== null || importBusy}>{submitting ? "Saving..." : importBusy ? "Please wait..." : "Continue"}</button>
          </footer>
        ) : null}
      </section>
    </main>
  );
}
